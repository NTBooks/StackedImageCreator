const express = require('express');
const exphbs = require('express-handlebars');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const DEFAULT_COLLECTION = process.env.COLLECTION || 'default_collection';

// Cache for layer data
const layerCache = new Map();

// Function to get layer information
const getLayers = async (collection) => {
    // Check cache first
    if (layerCache.has(collection)) {
        return layerCache.get(collection);
    }

    const assetsPath = path.join('assets', collection);
    const files = await fs.readdir(assetsPath);
    const layers = {};

    files.forEach(file => {
        if (file.endsWith('.png')) {
            const match = file.match(/L(\d+)_([^_]+)_(\d+)\.png/);
            if (match) {
                let [, level, name, number] = match;
                level = level.trim();
                name = name.trim();
                number = number.trim();
                if (!layers[level]) {
                    layers[level] = {
                        level: parseInt(level),
                        name: name,
                        images: []
                    };
                }
                layers[level].images.push({
                    number: parseInt(number),
                    path: `/assets/${collection}/L${level}_${name}_${number}.png`
                });
            }
        }
    });
    // Sort images in each layer by number
    Object.values(layers).forEach(layer => {
        layer.images.sort((a, b) => a.number - b.number);
    });
    const sortedLayers = Object.values(layers).sort((a, b) => a.level - b.level);

    // Store in cache
    layerCache.set(collection, sortedLayers);
    return sortedLayers;
};

// Initialize cache with all collections
const initializeCache = async () => {
    try {
        const assetsDir = path.join(__dirname, 'assets');
        const collections = await fs.readdir(assetsDir);

        // Load default collection first
        if (collections.includes(DEFAULT_COLLECTION)) {
            await getLayers(DEFAULT_COLLECTION);
        }

        // Load other collections
        for (const collection of collections) {
            if (collection !== DEFAULT_COLLECTION) {
                await getLayers(collection);
            }
        }

        console.log('Layer cache initialized with collections:', Array.from(layerCache.keys()));
    } catch (error) {
        console.error('Error initializing layer cache:', error);
    }
};

// Set up Handlebars
const hbs = exphbs.create({
    helpers: {
        subtract: (a, b) => a - b,
        json: (context) => JSON.stringify(context).replace(/</g, '\u003c'),
        contains: (str, substr) => typeof str === 'string' && str.includes(substr)
    },
    partialsDir: path.join(__dirname, 'views', 'partials')
});
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

// Serve static files
app.use(express.static('public'));
app.use('/assets', express.static(path.join('assets', "")));

// Utility function for XOR compositing
async function compositeLayersWithXOR(layers, imagesToComposite, collection) {
    let base = imagesToComposite[0];
    let overlays = [];
    let i = 1;
    while (i < imagesToComposite.length) {
        const currentLayer = layers[i];
        const prevLayer = layers[i - 1];
        if (prevLayer && prevLayer.name.endsWith('-XOR')) {
            // Apply mask: prevLayer is the mask, currentLayer is the image to mask
            const maskPath = imagesToComposite[i - 1];
            const imagePath = imagesToComposite[i];
            const [imageBuffer, maskBuffer] = await Promise.all([
                require('fs').promises.readFile(imagePath),
                require('fs').promises.readFile(maskPath)
            ]);
            const maskedBuffer = await sharp(imageBuffer)
                .joinChannel(
                    await sharp(maskBuffer).ensureAlpha().extractChannel('alpha').toBuffer()
                )
                .png()
                .toBuffer();
            overlays.push({ input: maskedBuffer });

            // Check for a matching -AND layer (same root name, same index)
            const xorRoot = prevLayer.name.replace('-XOR', '');
            const andLayer = layers.find(l => l.name === xorRoot + '-AND');
            if (andLayer) {
                // Use the index of the XOR mask (prevLayer) in its images array
                const xorIdx = prevLayer.images.findIndex(imgObj => path.basename(maskPath).includes(`_${imgObj.number}.png`));
                if (xorIdx !== -1 && andLayer.images[xorIdx]) {
                    const andPath = path.join(__dirname, 'assets', `${collection}/L${andLayer.level}_${andLayer.name}_${xorIdx + 1}.png`);
                    overlays.push({ input: andPath });
                }
            }
            i += 2;
        } else {
            overlays.push({ input: imagesToComposite[i] });
            i += 1;
        }
    }
    return sharp(base).composite(overlays).png().toBuffer();
}

// Utility to overlay engraving text using Sharp
async function addEngravingToBuffer(buffer, engraving) {
    if (!engraving) return buffer;
    const text = engraving.slice(0, 20);
    const width = 1080;
    const height = 1080;
    const boxWidth = Math.floor(width * 0.7);
    const boxHeight = 70;
    const boxX = Math.floor((width - boxWidth) / 2);
    const boxY = height - boxHeight - 40;
    // Create SVG overlay (centered, fixed-width, white text)
    const svg = `
    <svg width='${width}' height='${height}'>
      <rect x='${boxX}' y='${boxY}' width='${boxWidth}' height='${boxHeight}' fill='black' fill-opacity='0.5'/>
      <text
        x='${width / 2}'
        y='${boxY + boxHeight / 2}'
        font-family='Menlo,Consolas,Monaco,Liberation Mono,Courier,monospace'
        font-size='48'
        fill='white'
        text-anchor='middle'
        dominant-baseline='middle'
        font-weight='bold'
      >${text}</text>
    </svg>
    `;
    return await sharp(buffer)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();
}

// Utility to generate QR code and overlay it on the image
async function addQRCodeToBuffer(buffer, url) {
    if (!url) return buffer;

    try {
        // Generate QR code as SVG
        const qrSvg = await QRCode.toString(url, {
            type: 'svg',
            margin: 1,
            color: {
                dark: '#000000',
                light: '#00000000'
            }
        });

        // Convert SVG to buffer
        const qrBuffer = Buffer.from(qrSvg);

        // Get image dimensions
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width;
        const height = metadata.height;

        // Calculate QR code size (30% of the smaller dimension)
        const qrSize = Math.min(width, height) * 0.3;

        // Resize QR code
        const resizedQR = await sharp(qrBuffer)
            .resize(qrSize, qrSize)
            .toBuffer();

        // Calculate position to center the QR code
        const left = Math.floor((width - qrSize) / 2);
        const top = Math.floor((height - qrSize) / 2);

        // Create SVG overlay for opacity
        const svg = `
        <svg width='${width}' height='${height}'>
            <image x='${left}' y='${top}' width='${qrSize}' height='${qrSize}' href='data:image/png;base64,${resizedQR.toString('base64')}' opacity='0.5'/>
        </svg>
        `;

        // Composite QR code onto image with opacity
        return sharp(buffer)
            .composite([{
                input: Buffer.from(svg),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw error;
    }
}

// Main route
app.get('/', async (req, res) => {
    try {
        const collection = req.query.collection || DEFAULT_COLLECTION;
        const layers = await getLayers(collection);
        // Calculate max combinations
        const maxCombinations = layers.filter(layer => !layer.name.endsWith('-AND')).reduce((acc, layer) => acc * layer.images.length, 1);
        res.render('index', {
            layout: false,
            layers: layers,
            maxCombinations: maxCombinations,
            collection: collection
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error loading layers');
    }
});

// API: List all groups and item counts
app.get('/api/groups', async (req, res) => {
    try {
        const collection = req.query.collection || DEFAULT_COLLECTION;
        const layers = await getLayers(collection);
        const groups = layers.map(layer => ({
            name: layer.name,
            count: layer.images.length
        }));
        res.json({ status: 'success', groups });
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to get groups' });
    }
});

// API: Composite image from query string { groupname: number, ... }
app.get('/api/composite-image', async (req, res) => {
    try {
        const collection = req.query.collection || DEFAULT_COLLECTION;
        const layers = await getLayers(collection);
        // Create a case-insensitive map of query params
        const selections = {};
        for (const key in req.query) {
            if (key !== 'collection') {  // Skip collection parameter
                selections[key.toLowerCase()] = req.query[key];
            }
        }
        const imagesToComposite = [];
        for (const layer of layers) {
            // Skip emblem layer if QR code is provided
            if (layer.name === 'Emblem' && req.query.qrcode) {
                continue;
            }
            // Find matching param (case-insensitive)
            const idxStr = selections[layer.name.toLowerCase()];
            const idxNum = typeof idxStr !== 'undefined' ? parseInt(idxStr, 10) : undefined;
            if (typeof idxNum === 'number' && !isNaN(idxNum) && layer.images[idxNum]) {
                imagesToComposite.push(path.join(__dirname, 'assets', `${collection}/L${layer.level}_${layer.name}_${idxNum + 1}.png`));
            } else {
                // fallback to first image if not specified or invalid
                imagesToComposite.push(path.join(__dirname, 'assets', `${collection}/L${layer.level}_${layer.name}_1.png`));
            }
        }
        let buffer = await compositeLayersWithXOR(layers, imagesToComposite, collection);
        if (req.query.engraving) {
            buffer = await addEngravingToBuffer(buffer, req.query.engraving);
        }
        if (req.query.qrcode) {
            buffer = await addQRCodeToBuffer(buffer, req.query.qrcode);
        }
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        console.error('Error generating composite image:', error);
        res.status(500).json({ status: 'error', message: 'Failed to generate image' });
    }
});

// API: Generate random image from uuid
app.get('/api/random-image/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        const collection = req.query.collection || DEFAULT_COLLECTION;
        const layers = await getLayers(collection);
        // Hash the uuid to a deterministic random seed
        const hash = require('crypto').createHash('sha256').update(uuid).digest('hex');
        let hashIdx = 0;
        const imagesToComposite = [];
        for (const layer of layers) {
            // Use two hex chars per layer for more randomness
            const hex = hash.substr(hashIdx, 2);
            hashIdx += 2;
            const num = parseInt(hex, 16);
            const idx = num % layer.images.length;
            imagesToComposite.push(path.join(__dirname, 'assets', `${collection}/L${layer.level}_${layer.name}_${idx + 1}.png`));
        }
        let buffer = await compositeLayersWithXOR(layers, imagesToComposite, collection);
        if (req.query.engraving) {
            buffer = await addEngravingToBuffer(buffer, req.query.engraving);
        }
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to generate random image' });
    }
});

// API: Generate QR code
app.get('/api/qrcode', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ status: 'error', message: 'URL is required' });
        }

        // Generate QR code as SVG
        const qrSvg = await QRCode.toString(url, {
            type: 'svg',
            margin: 1,
            color: {
                dark: '#000000',
                light: '#00000000'
            }
        });

        // Convert SVG to PNG buffer
        const qrBuffer = await sharp(Buffer.from(qrSvg))
            .png()
            .toBuffer();

        res.set('Content-Type', 'image/png');
        res.send(qrBuffer);
    } catch (error) {
        console.error('Error generating QR code:', error);
        res.status(500).json({ status: 'error', message: 'Failed to generate QR code' });
    }
});

// Start the server after initializing cache
initializeCache().then(() => {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}); 
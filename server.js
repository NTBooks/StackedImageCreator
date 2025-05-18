const express = require('express');
const exphbs = require('express-handlebars');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = 3000;
const COLLECTION = process.env.COLLECTION || 'default_collection';

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

// Function to get layer information
const getLayers = async () => {
    const assetsPath = path.join('assets', COLLECTION);
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
                    path: `/assets/${COLLECTION}/L${level}_${name}_${number}.png`
                });
            }
        }
    });
    // Sort images in each layer by number
    Object.values(layers).forEach(layer => {
        layer.images.sort((a, b) => a.number - b.number);
    });
    return Object.values(layers).sort((a, b) => a.level - b.level);
};

// Utility function for XOR compositing
async function compositeLayersWithXOR(layers, imagesToComposite) {
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
                    const andPath = path.join(__dirname, 'assets', `${process.env.COLLECTION || 'default_collection'}/L${andLayer.level}_${andLayer.name}_${xorIdx + 1}.png`);
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

// Main route
app.get('/', async (req, res) => {
    try {
        const layers = await getLayers();
        // Calculate max combinations
        const maxCombinations = layers.filter(layer => !layer.name.endsWith('-AND')).reduce((acc, layer) => acc * layer.images.length, 1);
        res.render('index', {
            layout: false,
            layers: layers,
            maxCombinations: maxCombinations
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error loading layers');
    }
});

// API: List all groups and item counts
app.get('/api/groups', async (req, res) => {
    try {
        const layers = await getLayers();
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
        const layers = await getLayers();
        // Create a case-insensitive map of query params
        const selections = {};
        for (const key in req.query) {
            selections[key.toLowerCase()] = req.query[key];
        }
        const imagesToComposite = [];
        for (const layer of layers) {
            // Find matching param (case-insensitive)
            const idxStr = selections[layer.name.toLowerCase()];
            const idxNum = typeof idxStr !== 'undefined' ? parseInt(idxStr, 10) : undefined;
            if (typeof idxNum === 'number' && !isNaN(idxNum) && layer.images[idxNum]) {
                imagesToComposite.push(path.join(__dirname, 'assets', `${COLLECTION}/L${layer.level}_${layer.name}_${idxNum + 1}.png`));
            } else {
                // fallback to first image if not specified or invalid
                imagesToComposite.push(path.join(__dirname, 'assets', `${COLLECTION}/L${layer.level}_${layer.name}_1.png`));
            }
        }
        let buffer = await compositeLayersWithXOR(layers, imagesToComposite);
        if (req.query.engraving) {
            buffer = await addEngravingToBuffer(buffer, req.query.engraving);
        }
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to generate image' });
    }
});

// API: Generate random image from uuid
app.get('/api/random-image/:uuid', async (req, res) => {
    try {
        const { uuid } = req.params;
        const layers = await getLayers();
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
            imagesToComposite.push(path.join(__dirname, 'assets', `${COLLECTION}/L${layer.level}_${layer.name}_${idx + 1}.png`));
        }
        let buffer = await compositeLayersWithXOR(layers, imagesToComposite);
        if (req.query.engraving) {
            buffer = await addEngravingToBuffer(buffer, req.query.engraving);
        }
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to generate random image' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 
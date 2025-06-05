const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
const downloadBtn = document.getElementById('downloadBtn');
const sliders = document.querySelectorAll('.layer-slider');

// Store loaded images
const loadedImages = new Map();
let baseImage = null;

// Set canvas size based on first layer
const setCanvasSize = async () => {
    if (window.layerData && window.layerData.length > 0) {
        const firstLayer = window.layerData[0];
        const firstImage = new Image();
        firstImage.src = firstLayer.images[0].path;
        await new Promise((resolve) => {
            firstImage.onload = () => {
                canvas.width = firstImage.width;
                canvas.height = firstImage.height;
                resolve();
            };
        });
    }
};

// Load all images
const loadImages = async () => {
    const imagePromises = [];

    window.layerData.forEach(layer => {
        layer.images.forEach((imgData, i) => {
            const img = new Image();
            img.src = imgData.path;
            imagePromises.push(
                new Promise((resolve) => {
                    img.onload = () => {
                        loadedImages.set(`${layer.level}_${i}`, img);
                        resolve();
                    };
                })
            );
        });
    });

    await Promise.all(imagePromises);
};

// Draw engraving overlay
const drawEngraving = () => {
    const engravingInput = document.getElementById('engravingInput');
    if (!engravingInput) return;
    const text = engravingInput.value.slice(0, 20);
    if (!text) return;
    // Box dimensions
    const boxWidth = canvas.width * 0.7;
    const boxHeight = 70;
    const boxX = (canvas.width - boxWidth) / 2;
    const boxY = canvas.height - boxHeight - 40;
    // Draw semi-transparent black box
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.globalAlpha = 1.0;
    // Draw white fixed-width text
    ctx.font = 'bold 48px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, boxY + boxHeight / 2);
    ctx.restore();
};

// Draw QR code overlay
const drawQRCode = async () => {
    const qrcodeInput = document.getElementById('qrcodeInput');
    if (!qrcodeInput || !qrcodeInput.value) return;

    try {
        // Get QR code from server
        const response = await fetch(`/api/qrcode?url=${encodeURIComponent(qrcodeInput.value)}`);
        if (!response.ok) {
            throw new Error('Failed to generate QR code');
        }

        const blob = await response.blob();
        const qrImage = new Image();
        qrImage.src = URL.createObjectURL(blob);

        // Wait for image to load
        await new Promise((resolve) => {
            qrImage.onload = resolve;
        });

        // Calculate QR code size (30% of the smaller dimension)
        const qrSize = Math.min(canvas.width, canvas.height) * 0.3;

        // Calculate position to center the QR code
        const left = Math.floor((canvas.width - qrSize) / 2);
        const top = Math.floor((canvas.height - qrSize) / 2);

        // Save current context state
        ctx.save();

        // Set opacity to 50%
        ctx.globalAlpha = 0.5;

        // Disable image smoothing for pixel-perfect rendering
        ctx.imageSmoothingEnabled = false;

        // Draw QR code
        ctx.drawImage(qrImage, left, top, qrSize, qrSize);

        // Restore context state
        ctx.restore();

        // Clean up
        URL.revokeObjectURL(qrImage.src);
    } catch (error) {
        console.error('Error drawing QR code:', error);
    }
};

// Draw all layers
const drawLayers = async () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let i = 0;

    console.log(window.layerData);
    while (i < window.layerData.length) {
        const layer = window.layerData[i];
        if (layer.name.endsWith('-AND')) {
            i += 1;
            continue; // skip -AND layers in main loop
        }

        const slider = document.getElementById(`layer-${layer.level}`);
        const value = parseInt(slider.value);
        const img = loadedImages.get(`${layer.level}_${value}`);

        // Check if this is an XOR mask for the next layer
        if (layer.name.endsWith('-XOR') && i + 1 < window.layerData.length) {
            const nextLayer = window.layerData[i + 1];
            const nextSlider = document.getElementById(`layer-${nextLayer.level}`);
            const nextValue = parseInt(nextSlider.value);
            const nextImg = loadedImages.get(`${nextLayer.level}_${nextValue}`);

            // Draw next image to offscreen canvas
            const offCanvas = document.createElement('canvas');
            offCanvas.width = canvas.width;
            offCanvas.height = canvas.height;
            const offCtx = offCanvas.getContext('2d');
            offCtx.drawImage(nextImg, 0, 0, canvas.width, canvas.height);

            // Set mask
            offCtx.globalCompositeOperation = 'destination-in';
            offCtx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Draw result to main canvas
            ctx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);

            // Check for a matching -AND layer (same root name, same index)
            const xorRoot = layer.name.replace('-XOR', '');
            const andLayer = window.layerData.find(l => l.name === xorRoot + '-AND');
            if (andLayer) {
                const andImg = loadedImages.get(`${andLayer.level}_${value}`);
                if (andImg) ctx.drawImage(andImg, 0, 0, canvas.width, canvas.height);
            }

            i += 2; // Skip the mask and the masked layer
        } else {
            if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            i += 1;
        }
    }

    // Draw QR code instead of emblem if present
    const qrcodeInput = document.getElementById('qrcodeInput');
    if (qrcodeInput && qrcodeInput.value) {
        await drawQRCode();
    }

    drawEngraving();
};

// Update layer value display
const updateLayerValue = (slider) => {
    const valueDisplay = slider.nextElementSibling;
    valueDisplay.textContent = parseInt(slider.value) + 1;
};

// Initialize
const init = async () => {
    await setCanvasSize();
    await loadImages();
    drawLayers();

    // Add event listeners
    sliders.forEach(slider => {
        slider.addEventListener('input', () => {
            updateLayerValue(slider);
            drawLayers();
        });
    });

    const engravingInput = document.getElementById('engravingInput');
    if (engravingInput) {
        engravingInput.addEventListener('input', () => {
            console.log('Engraving input changed');
            drawLayers();
        });
    }

    const qrcodeInput = document.getElementById('qrcodeInput');
    if (qrcodeInput) {
        console.log('Adding QR code input listener');
        qrcodeInput.addEventListener('input', () => {
            console.log('QR code input changed:', qrcodeInput.value);
            drawLayers();
        });
    }

    downloadBtn.addEventListener('click', async () => {
        const engravingInput = document.getElementById('engravingInput');
        const qrcodeInput = document.getElementById('qrcodeInput');
        const engraving = engravingInput ? engravingInput.value.slice(0, 20) : '';
        const qrcode = qrcodeInput ? qrcodeInput.value : '';

        // Build query parameters
        const params = new URLSearchParams();
        window.layerData.forEach(layer => {
            if (!layer.name.endsWith('-AND')) {
                const slider = document.getElementById(`layer-${layer.level}`);
                if (slider) {
                    params.append(layer.name, slider.value);
                }
            }
        });
        if (engraving) params.append('engraving', engraving);
        if (qrcode) params.append('qrcode', qrcode);

        const collection = getCollection();
        if (collection) params.append('collection', collection);

        // Generate image with server
        const response = await fetch(`/api/composite-image?${params.toString()}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        // Download the image
        const link = document.createElement('a');
        link.download = 'layered-image.png';
        link.href = url;
        link.click();

        // Clean up
        URL.revokeObjectURL(url);
    });
};

// Get collection from URL query parameter
const getCollection = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('collection') || '';
};

// Start the application
init(); 
const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
const downloadBtn = document.getElementById('downloadBtn');
const sliders = document.querySelectorAll('.layer-slider');

// Store loaded images
const loadedImages = new Map();
let baseImage = null;

// Set canvas size (adjust as needed)
canvas.width = 800;
canvas.height = 800;

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

// Draw all layers
const drawLayers = () => {
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
    drawEngraving();
};

// Update layer value display
const updateLayerValue = (slider) => {
    const valueDisplay = slider.nextElementSibling;
    valueDisplay.textContent = parseInt(slider.value) + 1;
};

// Initialize
const init = async () => {
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
        engravingInput.addEventListener('input', drawLayers);
    }

    downloadBtn.addEventListener('click', () => {
        const engravingInput = document.getElementById('engravingInput');
        const engraving = engravingInput ? engravingInput.value.slice(0, 20) : '';
        const link = document.createElement('a');
        link.download = 'layered-image.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
};

// Start the application
init(); 
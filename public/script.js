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

    downloadBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'layered-image.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });
};

// Start the application
init(); 
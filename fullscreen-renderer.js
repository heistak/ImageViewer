
const { ipcRenderer } = require('electron');

const image = document.getElementById('image');
const fullscreenOverlay = document.getElementById('fullscreen-overlay');

ipcRenderer.on('load-image', (event, imagePath, imageCountText) => {
  console.log(`[fullscreen-renderer.js] Loading image: ${imagePath}, Text: ${imageCountText}`);
  if (imagePath === 'about:blank') {
    image.src = ''; // Clear the image source
    image.style.display = 'none'; // Hide the image element
    fullscreenOverlay.textContent = ''; // Clear overlay text
  } else {
    image.src = imagePath;
    image.style.display = 'block'; // Show the image element
    fullscreenOverlay.textContent = imageCountText;
  }
});

// Global keyboard events are handled by main.js and sent to the main window's renderer.
// This renderer only displays the image, it does not handle navigation.


const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const ExifReader = require('exif-reader');

const image = document.getElementById('image');
const imageCounter = document.getElementById('image-counter');
const openFileButton = document.getElementById('open-file');
const openInExplorerButton = document.getElementById('open-in-explorer');
const showExifButton = document.getElementById('show-exif');
const fullscreenButton = document.getElementById('fullscreen');
const exifModal = document.getElementById('exif-modal');
const exifModalClose = document.getElementById('exif-modal-close');
const exifComment = document.getElementById('exif-comment');
const toolbar = document.getElementById('toolbar');
const fullscreenOverlay = document.getElementById('fullscreen-overlay');

let images = [];
let currentImageIndex = 0;
let currentDirectory = '';

function loadFile(filePath) {
  console.log(`[renderer.js] Loading file: ${filePath}`);
  currentDirectory = path.dirname(filePath);
  fs.readdir(currentDirectory, (err, files) => {
    if (err) {
      console.error(err);
      return;
    }
    images = files.filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
    currentImageIndex = images.indexOf(path.basename(filePath));
    updateImage();
    // Send image list and current index to main process
    ipcRenderer.send('update-image-list', images, currentImageIndex, currentDirectory);
  });
}

document.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();

  const file = event.dataTransfer.files[0];
  if (file) {
    loadFile(file.path);
  }
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.stopPropagation();
});

function updateImage() {
  if (images.length > 0) {
    const imagePath = path.join(currentDirectory, images[currentImageIndex]);
    image.src = imagePath;
    const imageCountText = `${currentImageIndex + 1}/${images.length}`;
    imageCounter.textContent = imageCountText;
    document.title = `Image Viewer - ${images[currentImageIndex]}`;
    fullscreenOverlay.textContent = `[${imageCountText}] ${images[currentImageIndex]}`;

    // Get image dimensions after it loads in the DOM
    image.onload = () => {
      const imageWidth = image.naturalWidth;
      const imageHeight = image.naturalHeight;
      console.log(`[renderer.js] Image loaded: ${imagePath}, Dimensions: ${imageWidth}x${imageHeight}`);
      // Always notify main process about image change, it will decide if fullscreen display needs update
      ipcRenderer.send('update-fullscreen-display', imagePath, imageCountText, imageWidth, imageHeight);
    };
    image.onerror = (error) => {
      console.error(`[renderer.js] Error loading image: ${imagePath}`, error);
      // Send with 0 dimensions if error, main process will handle fallback
      ipcRenderer.send('update-fullscreen-display', imagePath, imageCountText, 0, 0);
    };
  }
}

document.addEventListener('keydown', (event) => {
  console.log(`[renderer.js] Keydown event: ${event.key}`);
  if (event.key === 'ArrowRight') {
    currentImageIndex = (currentImageIndex + 1) % images.length;
    updateImage();
  } else if (event.key === 'ArrowLeft') {
    currentImageIndex = (currentImageIndex - 1 + images.length) % images.length;
    updateImage();
  } else if (event.key === 'Escape') {
    ipcRenderer.send('exit-fullscreen');
  } else if (event.key === 'Enter') { // Handle Enter key for fullscreen
    // Only go fullscreen if no button is focused
    if (document.activeElement.tagName !== 'BUTTON') {
      if (images.length > 0) {
        const imagePath = path.join(currentDirectory, images[currentImageIndex]);
        const imageCountText = `${currentImageIndex + 1}/${images.length}`;
        // Send initial dimensions to main process
        const tempImage = new Image();
        tempImage.onload = () => {
          ipcRenderer.send('toggle-fullscreen', imagePath, imageCountText, tempImage.naturalWidth, tempImage.naturalHeight);
        };
        tempImage.onerror = () => {
          ipcRenderer.send('toggle-fullscreen', imagePath, imageCountText, 0, 0);
        };
        tempImage.src = imagePath;
      } else {
        ipcRenderer.send('toggle-fullscreen', null, null, 0, 0);
      }
    }
  } else if (event.key === 'F5') { // Handle F5 for rescan
    rescanFolder();
  }
});

openFileButton.addEventListener('click', () => {
  console.log('[renderer.js] Open File button clicked');
  ipcRenderer.send('open-file-dialog');
});

openInExplorerButton.addEventListener('click', () => {
  console.log('[renderer.js] Open in Explorer button clicked');
  if (images.length > 0) {
    const imagePath = path.join(currentDirectory, images[currentImageIndex]);
    ipcRenderer.send('open-in-explorer', imagePath);
  }
});

fullscreenButton.addEventListener('click', () => {
  console.log('[renderer.js] Fullscreen button clicked');
  if (images.length > 0) {
    const imagePath = path.join(currentDirectory, images[currentImageIndex]);
    const imageCountText = `${currentImageIndex + 1}/${images.length}`;
    // Send initial dimensions to main process
    const tempImage = new Image();
    tempImage.onload = () => {
      ipcRenderer.send('toggle-fullscreen', imagePath, imageCountText, tempImage.naturalWidth, tempImage.naturalHeight);
    };
    tempImage.onerror = () => {
      ipcRenderer.send('toggle-fullscreen', imagePath, imageCountText, 0, 0);
    };
    tempImage.src = imagePath;
  } else {
    ipcRenderer.send('toggle-fullscreen', null, null, 0, 0);
  }
});

showExifButton.addEventListener('click', () => {
  console.log('[renderer.js] Show EXIF button clicked');
  if (images.length > 0) {
    const imagePath = path.join(currentDirectory, images[currentImageIndex]);
    // Check if it's a WebP image
    if (imagePath.toLowerCase().endsWith('.webp')) {
      exifComment.textContent = 'EXIF data extraction for WebP images is not fully supported yet.';
      exifModal.style.display = 'block';
      return;
    }

    fs.readFile(imagePath, (err, data) => {
      if (err) {
        console.error(err);
        exifComment.textContent = 'Error reading image file for EXIF data.';
        exifModal.style.display = 'block';
        return;
      }
      try {
        const tags = ExifReader(data);
        exifComment.textContent = tags.exif.UserComment || 'No EXIF comment found.';
        exifModal.style.display = 'block';
      } catch (error) {
        exifComment.textContent = 'Error reading EXIF data.';
        exifModal.style.display = 'block';
      }
    });
  }
});

exifModalClose.addEventListener('click', () => {
  console.log('[renderer.js] EXIF modal close clicked');
  exifModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
  if (event.target == exifModal) {
    console.log('[renderer.js] Click outside EXIF modal');
    exifModal.style.display = 'none';
  }
});

ipcRenderer.on('selected-file', (event, filePath) => {
  console.log(`[renderer.js] Received selected-file: ${filePath}`);
  loadFile(filePath);
});

// Global keyboard events are now directly dispatched to the document
ipcRenderer.on('global-keydown', (event, key) => {
  console.log(`[renderer.js] Received global-keydown: ${key}`);
  const keyboardEvent = new KeyboardEvent('keydown', { key: key });
  document.dispatchEvent(keyboardEvent);
});

// New IPC listener for navigating images in fullscreen from main process
ipcRenderer.on('navigate-fullscreen', (event, direction) => {
  console.log(`[renderer.js] Received navigate-fullscreen: ${direction}`);
  // Simulate a keydown event to trigger the existing navigation logic
  const key = (direction === 'next') ? 'ArrowRight' : 'ArrowLeft';
  const keyboardEvent = new KeyboardEvent('keydown', { key: key });
  document.dispatchEvent(keyboardEvent);
});

// New IPC listener to update image from main process (after global shortcut navigation)
ipcRenderer.on('update-image-from-main', (event, imagePath, imageCountText) => {
  console.log('[renderer.js] Received update-image-from-main from main process.');
  // Update local state based on main process's current image
  const fileName = path.basename(imagePath);
  const newIndex = images.indexOf(fileName);
  if (newIndex !== -1) {
    currentImageIndex = newIndex;
  } else {
    // If image not found in current list, rescan and then update
    rescanFolder();
    return; // Exit to avoid immediate update with potentially wrong index
  }

  image.src = imagePath;
  imageCounter.textContent = imageCountText;
  document.title = `Image Viewer - ${fileName}`;
  fullscreenOverlay.textContent = `[${imageCountText}] ${fileName}`;

  // Get image dimensions after it loads in the DOM
  image.onload = () => {
    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    console.log(`[renderer.js] Image loaded: ${imagePath}, Dimensions: ${imageWidth}x${imageHeight}`);
    // Always notify main process about image change, it will decide if fullscreen display needs update
    ipcRenderer.send('update-fullscreen-display', imagePath, imageCountText, imageWidth, imageHeight);
  };
  image.onerror = (error) => {
    console.error(`[renderer.js] Error loading image: ${imagePath}`, error);
    // Send with 0 dimensions if error, main process will handle fallback
    ipcRenderer.send('update-fullscreen-display', imagePath, imageCountText, 0, 0);
  };
});

// New IPC listener for rescan folder from global shortcut
ipcRenderer.on('handle-rescan', () => {
  console.log('[renderer.js] Received handle-rescan IPC.');
  rescanFolder();
});

function rescanFolder() {
  console.log('[renderer.js] Rescanning folder...');
  const currentFileName = images[currentImageIndex];
  fs.readdir(currentDirectory, (err, files) => {
    if (err) {
      console.error(err);
      return;
    }
    images = files.filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
    const newIndex = images.indexOf(currentFileName);
    if (newIndex !== -1) {
      currentImageIndex = newIndex;
    } else {
      currentImageIndex = 0; // Reset to first image if current one is gone
    }
    updateImage();
    // Send updated image list and current index to main process
    ipcRenderer.send('update-image-list', images, currentImageIndex, currentDirectory);
  });
}

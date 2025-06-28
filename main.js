const { app, BrowserWindow, ipcMain, shell, dialog, Menu, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs'); // Import fs module

let mainWindow; // The main window for UI (toolbar, file dialog)
let displayWindows = new Map(); // Map to store windows for each display
let currentImageWindow = null; // Reference to the window currently showing the image
let currentImagePath = null; // Store the path of the currently displayed image
let currentImageCountText = ''; // Store the image count text
let isAppFullscreen = false; // Tracks the overall application fullscreen state

// Global variables for image list and index, accessible by main process
let images = [];
let currentImageIndex = 0;
let currentDirectory = '';

function registerGlobalShortcuts() {
  if (!globalShortcut.isRegistered('Right')) {
    globalShortcut.register('Right', () => {
      console.log('[main.js] Global shortcut triggered: ArrowRight');
      if (isAppFullscreen) {
        mainWindow.webContents.send('navigate-fullscreen', 'next');
      } else if (mainWindow) {
        mainWindow.webContents.send('global-keydown', 'ArrowRight');
      }
    });
    console.log(`[main.js] Global shortcut 'Right' registered: ${globalShortcut.isRegistered('Right')}`);
  }
  if (!globalShortcut.isRegistered('Left')) {
    globalShortcut.register('Left', () => {
      console.log('[main.js] Global shortcut triggered: ArrowLeft');
      if (isAppFullscreen) {
        mainWindow.webContents.send('navigate-fullscreen', 'prev');
      } else if (mainWindow) {
        mainWindow.webContents.send('global-keydown', 'ArrowLeft');
      }
    });
    console.log(`[main.js] Global shortcut 'Left' registered: ${globalShortcut.isRegistered('Left')}`);
  }
  if (!globalShortcut.isRegistered('Escape')) {
    globalShortcut.register('Escape', () => {
      console.log('[main.js] Global shortcut triggered: Escape');
      if (isAppFullscreen) {
        ipcMain.emit('toggle-fullscreen', null, null, null, null);
      } else if (mainWindow) {
        mainWindow.webContents.send('global-keydown', 'Escape');
      }
    });
    console.log(`[main.js] Global shortcut 'Escape' registered: ${globalShortcut.isRegistered('Escape')}`);
  }
  if (!globalShortcut.isRegistered('F12')) {
    globalShortcut.register('F12', () => {
      console.log('[main.js] Global shortcut triggered: F12');
      if (currentImageWindow) {
        currentImageWindow.webContents.toggleDevTools();
      } else if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
      }
    });
    console.log(`[main.js] Global shortcut 'F12' registered: ${globalShortcut.isRegistered('F12')}`);
  }
}

function unregisterGlobalShortcuts() {
  globalShortcut.unregister('Right');
  globalShortcut.unregister('Left');
  globalShortcut.unregister('Escape');
  globalShortcut.unregister('F12');
  console.log('[main.js] All global shortcuts unregistered.');
}

function createDisplayWindow(display) {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: true,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false
  });

  win.loadFile('fullscreen.html');

  win.on('closed', () => {
    displayWindows.delete(display.id);
    if (currentImageWindow === win) {
      currentImageWindow = null;
    }
  });

  return win;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    console.log('[main.js] Main window focused.');
    if (!isAppFullscreen) {
      console.log('[main.js] Registering global shortcuts due to main window focus.');
      registerGlobalShortcuts();
    }
  });

  mainWindow.on('blur', () => {
    console.log('[main.js] Main window blurred.');
    if (!isAppFullscreen) {
      console.log('[main.js] Unregistering global shortcuts due to main window blur.');
      unregisterGlobalShortcuts();
    }
  });

  // Open file from command line
  if (process.argv.length >= 2) {
    const filePath = process.argv[1];
    if (filePath) {
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('selected-file', filePath);
      });
    }
  }
}

const menuTemplate = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Open...',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          openFileDialog();
        }
      },
      {
        role: 'quit'
      }
    ]
  },
  {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Main Window Dev Tools',
        accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        click (item, focusedWindow) {
          if (mainWindow) mainWindow.webContents.toggleDevTools();
        }
      }
    ]
  }
];

function openFileDialog() {
  dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]
  }).then(result => {
    if (!result.canceled) {
      mainWindow.webContents.send('selected-file', result.filePaths[0]);
    }
  }).catch(err => {
    console.log(err);
  });
}

function updateImageOnDisplay(imagePath, imageCountText, imageWidth, imageHeight) {
  currentImagePath = imagePath;
  currentImageCountText = imageCountText;

  let imageAspectRatio = 0;
  let isImageLandscape = false;

  if (imageWidth > 0 && imageHeight > 0) {
    imageAspectRatio = imageWidth / imageHeight;
    isImageLandscape = imageAspectRatio > 1;
    console.log(`[main.js] Image: ${imagePath}, Dimensions: ${imageWidth}x${imageHeight}, Aspect Ratio: ${imageAspectRatio}, Is Landscape: ${isImageLandscape}`);
  } else {
    console.error(`[main.js] Received 0x0 dimensions for ${imagePath}. Assuming default aspect ratio.`);
    imageAspectRatio = 16 / 9; // Default to landscape
    isImageLandscape = true;
  }

  const displays = screen.getAllDisplays();
  let bestDisplay = null;
  let minAspectRatioDiff = Infinity;

  console.log('[main.js] Available Displays:');
  // First pass: find best matching orientation
  for (const display of displays) {
    const displayAspectRatio = display.bounds.width / display.bounds.height;
    const isDisplayLandscape = displayAspectRatio > 1;
    const aspectRatioDiff = Math.abs(displayAspectRatio - imageAspectRatio);
    console.log(`  Display ID: ${display.id}, Bounds: ${display.bounds.width}x${display.bounds.height}, Aspect Ratio: ${displayAspectRatio}, Is Landscape: ${isDisplayLandscape}, Diff: ${aspectRatioDiff}`);

    if (isImageLandscape === isDisplayLandscape) { // Matching orientation
      console.log(`    [main.js] Display ${display.id} matches orientation. Current best diff: ${minAspectRatioDiff}, This display diff: ${aspectRatioDiff}`);
      if (aspectRatioDiff < minAspectRatioDiff) {
        minAspectRatioDiff = aspectRatioDiff;
        bestDisplay = display;
        console.log(`    [main.js] Display ${display.id} is new best matching orientation.`);
      }
    }
  }

  // Second pass: if no matching orientation found, or if bestDisplay is still null (e.g., only one display)
  if (!bestDisplay) {
    console.log('[main.js] No display found matching orientation. Falling back to closest aspect ratio.');
    minAspectRatioDiff = Infinity; // Reset for fallback
    for (const display of displays) {
      const displayAspectRatio = display.bounds.width / display.bounds.height;
      const aspectRatioDiff = Math.abs(displayAspectRatio - imageAspectRatio);
      console.log(`    [main.js] Fallback: Display ID: ${display.id}, Diff: ${aspectRatioDiff}. Current best diff: ${minAspectRatioDiff}`);
      if (aspectRatioDiff < minAspectRatioDiff) {
        minAspectRatioDiff = aspectRatioDiff;
        bestDisplay = display;
        console.log(`    [main.js] Fallback: Display ${display.id} is new best overall.`);
      }
    }
  }

  console.log(`[main.js] Best Display ID: ${bestDisplay ? bestDisplay.id : 'None'}, Min Aspect Ratio Diff: ${minAspectRatioDiff}`);

  if (bestDisplay) {
    const targetWindow = displayWindows.get(bestDisplay.id);

    // Ensure all non-target display windows are black
    for (const [displayId, win] of displayWindows.entries()) {
      if (win !== targetWindow) {
        console.log(`[main.js] Clearing image from non-target window (ID: ${win.id})`);
        win.webContents.send('load-image', 'about:blank', ''); // Send clear signal
      }
    }

    if (currentImageWindow && currentImageWindow !== targetWindow) {
      console.log(`[main.js] Previous image window (ID: ${currentImageWindow.id}) is no longer active.`);
      // No need to hide, it's already cleared to black above
    }

    if (targetWindow) {
      console.log(`[main.js] Loading image into target window (ID: ${targetWindow.id})`);
      targetWindow.webContents.send('load-image', imagePath, imageCountText);
      targetWindow.show(); // Ensure it's visible
      currentImageWindow = targetWindow;
    }
  }
}

app.whenReady().then(() => {
  createMainWindow();

  // Create a fullscreen window for each display
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const win = createDisplayWindow(display);
    displayWindows.set(display.id, win);
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  // Register global shortcuts initially (for when main window is focused)
  // These will be managed by focus/blur events, or explicitly when fullscreen
  registerGlobalShortcuts();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts when the application is about to quit
  globalShortcut.unregisterAll();
});

ipcMain.on('open-in-explorer', (event, imagePath) => {
  console.log(`[main.js] Received open-in-explorer for: ${imagePath}`);
  shell.showItemInFolder(imagePath);
});

ipcMain.on('toggle-fullscreen', (event, imagePath, imageCountText, imageWidth, imageHeight) => {
  console.log(`[main.js] Received toggle-fullscreen. isAppFullscreen: ${isAppFullscreen}`);
  if (isAppFullscreen) {
    // Exiting fullscreen
    isAppFullscreen = false;
    mainWindow.setFullScreen(false);
    mainWindow.show();
    if (currentImageWindow) {
      console.log(`[main.js] Clearing image from currentImageWindow (ID: ${currentImageWindow.id})`);
      currentImageWindow.webContents.send('load-image', 'about:blank', '');
      currentImageWindow.hide();
      currentImageWindow = null;
    }
    // Hide all display windows
    for (const win of displayWindows.values()) {
      console.log(`[main.js] Hiding display window (ID: ${win.id})`);
      win.hide();
    }
    mainWindow.webContents.send('fullscreen-changed', false);
    // Re-register global shortcuts if main window is focused
    if (mainWindow.isFocused()) {
      registerGlobalShortcuts();
    }
  } else {
    // Entering fullscreen
    isAppFullscreen = true;
    mainWindow.hide();
    // Ensure global shortcuts are registered when entering fullscreen
    registerGlobalShortcuts();
    // Show all display windows and make them fullscreen
    for (const win of displayWindows.values()) {
      console.log(`[main.js] Showing and setting fullscreen for display window (ID: ${win.id})`);
      win.show();
      win.setFullScreen(true);
    }
    updateImageOnDisplay(imagePath, imageCountText, imageWidth, imageHeight);
    mainWindow.webContents.send('fullscreen-changed', true);
  }
});

ipcMain.on('exit-fullscreen', () => {
  console.log('[main.js] Received exit-fullscreen');
  if (isAppFullscreen) {
    // Trigger toggle-fullscreen to exit properly
    ipcMain.emit('toggle-fullscreen', null, null, null, null);
  }
});

ipcMain.on('open-file-dialog', () => {
  console.log('[main.js] Received open-file-dialog');
  openFileDialog();
});

ipcMain.on('update-fullscreen-display', (event, imagePath, imageCountText, imageWidth, imageHeight) => {
  console.log(`[main.js] Received update-fullscreen-display for: ${imagePath}. isAppFullscreen: ${isAppFullscreen}`);
  // This event is now triggered by the main window's renderer whenever the image changes.
  // We only need to update the display if we are currently in fullscreen mode.
  if (!isAppFullscreen) {
    // If not in fullscreen, do nothing. The main window is handling display.
    console.log('[main.js] Not in app fullscreen, ignoring update-fullscreen-display.');
    return;
  }
  updateImageOnDisplay(imagePath, imageCountText, imageWidth, imageHeight);
});

// IPC to receive image list and current index from renderer
ipcMain.on('update-image-list', (event, newImages, newCurrentImageIndex, newCurrentDirectory) => {
  images = newImages;
  currentImageIndex = newCurrentImageIndex;
  currentDirectory = newCurrentDirectory;
  console.log('[main.js] Updated image list and current index from renderer.');
});

// New IPC listener for navigating images in fullscreen from global shortcuts
ipcMain.on('navigate-fullscreen', (event, direction) => {
  console.log(`[main.js] Received navigate-fullscreen: ${direction}`);
  if (isAppFullscreen) {
    // Send a message to the main window's renderer to handle navigation
    mainWindow.webContents.send('handle-navigation', direction);
  }
});
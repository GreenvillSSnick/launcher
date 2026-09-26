import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { registerAuthHandlers } from './handlers/auth'
import { registerLauncherHandlers } from './handlers/launcher'
import { registerSettingsHandlers } from './handlers/settings'
import { registerNewsHandlers } from './handlers/news'
import { registerBackgroundHandlers } from './handlers/background'
import { registerMaintenanceHandlers } from './handlers/maintenance'
import { registerBootstrapHandlers } from './handlers/bootstraps'
import logger from 'electron-log/main'
import { registerSkinHandlers } from './handlers/skin'
import { startRichPresence, stopRichPresence } from './rpc'

const APP_TITLE = 'Factory 42'
const BG_COLOR = '#121212'

let mainWindow: BrowserWindow | null = null

if (process.env.VITE_DEV_SERVER_URL) {
  app.setName(APP_TITLE)
}

function createWindow() {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1000,
    minHeight: 700,
    title: APP_TITLE,
    autoHideMenuBar: true,
    backgroundColor: BG_COLOR,
    show: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // mainWindow.removeMenu()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function configureAppMenu() {
  app.setAboutPanelOptions({
    applicationName: APP_TITLE,
    applicationVersion: app.getVersion(),
    version: 'Build 2026.1',
    copyright: 'Copyright © 2026 Factory 42',
    credits: 'Developed by Factory 42',
    iconPath: path.join(__dirname, '../build/icon.png')
  })

  const template: any[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),

    {
      label: 'File',
      submenu: [{ role: 'close' }]
    },

    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },

    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  logger.initialize()
  configureAppMenu()
  createWindow()
  startRichPresence()

  if (mainWindow) {
    registerAuthHandlers(mainWindow)
    registerSkinHandlers()
    registerNewsHandlers()
    registerBackgroundHandlers()
    registerMaintenanceHandlers()
    registerBootstrapHandlers(mainWindow)
    registerLauncherHandlers(mainWindow)
    registerSettingsHandlers()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  stopRichPresence()
})


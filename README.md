# Factory 42

**Factory 42 is a modern, fast, and cross-platform Minecraft launcher.**

Built with Electron, Vite, and the Factory 42 server configuration.

![Factory 42](./.github/assets/screenshot.png)

[<img src="https://img.shields.io/badge/platforms-Windows,_macOS,_Linux-0077DA?style=for-the-badge&color=0077DA">](#platforms)
[<img src="https://img.shields.io/badge/version-1.2.0-orangered?style=for-the-badge&color=orangered">](package.json)</p>

---

## Introduction

**Factory 42** is a pre-configured **Electron + Vite** application designed to provide the best possible gaming experience on the Factory 42 server.

## Features

- **Next-gen performance**: Built on **Vite**, offering instant startup and Hot-Module-Replacement (HMR).
- **Microsoft authentication**: Full integration of the official authentication flow.
- **Asset management**: Smart downloading of game files (Java, libraries, assets, and mods) with hash validation.
- **Auto-update**: Automatic update support for distributed builds.
- **Skin & cape management**: View and equip skins and capes directly from the launcher.

## Installation & Development

### Prerequisites

Before starting, ensure you have installed:

- **Node.js** (v18 or higher recommended)
- **npm** (or Yarn/Pnpm)

### Setup

1.  Clone the repository:

    ```bash
    git clone <your-factory-42-repository-url>
    cd launcher
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

    _Note: This will automatically install the launcher dependencies and build tools._

3.  Start in Development mode:

    ```bash
    npm run dev
    ```

    An Electron window will open with hot-reloading enabled.

## Configuration

### Configure the server

Modify the configuration file (`electron/const.ts`) to point to the Factory 42 server configuration.

### Icon customization

To change the visual identity, replace the files in the `build/` folder:

- `icon.png`: Standard icon (512x512).
- `icon.ico`: For Windows.
- `icon.icns`: For macOS (Legacy & Liquid Glass fallback).
- `background.png`: DMG Installer background (macOS).

### Build (distribution)

To create the final executables for distribution:

| Platform | Command               | Output format               |
| -------- | --------------------- | --------------------------- |
| Windows  | `npm run release:win` | `.exe` (NSIS Installer)     |
| macOS    | `npm run release:mac` | `.dmg` (Disk Image)         |
| Linux    | `npm run release:lin` | `.AppImage`, `.deb`, `.rpm` |

Compiled files will be located in the `release/` folder.

## Contributing

Contributions are welcome! For major changes, please open an issue first to discuss what you would like to change.


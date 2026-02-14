# Web DS

Browser-based Nintendo DS emulator using [desmond](https://github.com/js-emulators/desmond), with local ROM hosting, persistent saves, and mobile touch controls.

## Setup

### 1. Split your ROM

```bash
chmod +x split-rom.sh
./split-rom.sh path/to/game.nds
```

This creates a `rom/` folder with numbered chunks (`00.bin`, `01.bin`, …) and a `manifest.json`. Each chunk is under 25 MB so it fits within GitHub's upload limit.

### 2. Deploy

Push the whole project to GitHub Pages (or any static host):

```
index.html
css/app.css
js/boot.js
js/desmond.min.js
split-rom.sh
rom/
  manifest.json
  00.bin
  01.bin
  ...
```

### Alternative: remote ROM URL

Instead of local chunks, you can pass a direct URL:

```
https://yoursite.github.io/nds-player/?rom=https://example.com/game.nds
```

The remote server must support CORS. Local chunks are preferred since they avoid CORS entirely.

## Controls

**Keyboard:** Arrow keys (D-Pad), Z (A), X (B), S (X), A (Y), Q (L), W (R), Enter (Start), Shift (Select)

**Mobile:** Virtual gamepad appears automatically on touch devices. Tap the bottom DS screen for stylus input.

## Saves

Battery saves persist to IndexedDB automatically. Use the **Saves** panel to export/import `.dsv` files or delete save data.

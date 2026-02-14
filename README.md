# Web DS

A lightweight browser-based Nintendo DS player wrapper around Desmond with a simple HUD, ROM download progress, local ROM caching, save management, and side-by-side dual-screen layout.

## Features

- Loads a `.nds` ROM from a configurable URL or from `?rom=<url>`.
- Streams ROM download with progress display.
- Caches downloaded ROMs in browser storage for faster reloads.
- Side-by-side DS screens (top screen left, bottom screen right).
- Save data status in the HUD with import/export/delete tools.
- Click-to-unmute overlay for reliable audio initialization.

## Project structure

- `index.html` – app shell, HUD, modal panels, and emulator element.
- `js/boot.js` – app boot logic, ROM fetching/caching, layout, and saves.
- `js/desmond.min.js` – bundled emulator runtime.
- `css/app.css` – UI and layout styling.

## Quick start

Because this app uses `fetch` for ROM loading, run it from a local web server (not `file://`).

```bash
# from repo root
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080`
- or with a custom ROM URL: `http://localhost:8080/?rom=https://example.com/game.nds`

## ROM configuration

Set the default ROM URL in `js/boot.js`:

```js
const DEFAULT_ROM_URL = "https://files.catbox.moe/35lx11.nds";
```

The `?rom=` query parameter overrides this value at runtime.

## Controls

Keyboard mapping:

- D-Pad: `↑ ↓ ← →`
- `A`: `Z`
- `B`: `X`
- `X`: `S`
- `Y`: `A`
- `L / R`: `Q / W`
- `Start`: `Enter`
- `Select`: `Shift`

Touch input: click/tap the right-hand screen (bottom DS screen).

## Saves

- Save files are stored in browser storage and restored on reload.
- Use **Saves** panel to:
  - Export save to `.dsv`
  - Import `.dsv`/`.sav`
  - Delete save data for current game

If the app runs inside an iframe with restricted storage, use import/export as a fallback.

## Notes

- ROM hosting must allow cross-origin requests (CORS) for remote URLs.
- First load may take longer; subsequent loads can come from cache.
- Audio starts after a user gesture due to browser autoplay policies.

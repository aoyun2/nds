# Web DS

A lightweight wrapper for [desmond](https://github.com/js-emulators/desmond), adding local ROM caching and save management.

## Features

- Loads a `.nds` ROM from `?rom=<url>` (ROM hosting must allow cross-origin requests (CORS) for remote URLs).
- Caches downloaded ROMs in browser storage for faster reloads.
- Save data with import/export/delete save tools.

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

Touch: click/tap the right-hand screen (bottom DS screen).

## Saves

- Save files are stored in browser storage and restored on reload.
- Use **Saves** panel to:
  - Export save to `.dsv`
  - Import `.dsv`/`.sav`
  - Delete save data for current game

If the app runs inside an iframe with restricted storage, use import/export as a fallback.

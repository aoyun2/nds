# NDS Player (DeSmuME-wasm wrapper)

This is a minimal static site for GitHub Pages that:
- loads a ROM from a URL (no file picker)
- runs DeSmuME-wasm (prebuilt core)
- autosaves to browser storage (IndexedDB via localForage)
- supports export/import of `.dsv` save files

## Configure the ROM
Edit `js/main.js` and change:

```js
const ROM_URL = "https://files.catbox.moe/35lx11.nds";
```

## Notes about embedding in Google Sites
Some embedded iframes can block persistent storage. If the top-right badge says `Save: blocked`, your browser is refusing IndexedDB in that embed.

Workarounds:
- open the GitHub Pages URL directly (not inside Sites)
- use `Export save` / `Import save` to manually back up
- move to a cloud save backend (not included here)

## Emulator core
The emulator core is loaded from jsDelivr:

- nds.js / nds.wasm from https://github.com/MajesticWafer/dsp (prebuilt DeSmuME-wasm)

If you want to self-host the core, update `js/emu-core.js` to point to your own `build/nds.js` + `build/nds.wasm`.

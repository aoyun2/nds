# pkplat_embed

This page now targets **desmume-wasm** (instead of Desmond).

## Runtime files

`index.html` first attempts to load:

- `./desmume/wasm-port/nds.js`
- and expects `nds.wasm` in the same folder.

If those local files are missing, it falls back to `https://ds.44670.org/nds.js` and its matching wasm path.

## Save behavior

The embed stores save-memory snapshots in `localStorage` under:

- `pkplat_embed.desmume_wasm.sav`

So save persistence is tied to this key in the browser profile.

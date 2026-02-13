# pkplat_embed

This page embeds the **desmume-wasm runtime** directly in your own site and boots a specific ROM (`https://files.catbox.moe/35lx11.nds`).

## Runtime files used by this embed

The frontend loads these local files from this repository:

- `desmume/wasm-port/nds.js`
- `desmume/wasm-port/nds.wasm`

Do **not** point your app at the official demo page (`https://ds.44670.org/`) if you want to stay inside your own UI.

## Save behavior

The embed stores save-memory snapshots in `localStorage` under:

- `pkplat_embed.desmume_wasm.sav`

So save persistence is tied to this key in the same browser profile + origin.

## Important: run via HTTP(S), not `file://`

Opening `index.html` directly from disk (`file://...`) causes CORS failures when the page tries to fetch runtime/ROM assets.

Run a local static server from the repo root instead:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

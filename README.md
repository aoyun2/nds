# pkplat_embed

This page integrates with **desmume-wasm** from the `desmume/wasm-port` runtime artifacts.

## Required runtime files

The frontend expects these files to exist locally:

- `desmume/wasm-port/nds.js`
- `desmume/wasm-port/nds.wasm`

The repo includes the desmume-wasm C++ source, but not prebuilt web runtime artifacts. Generate or fetch those files first.

### Quick setup

```bash
./scripts/fetch-desmume-wasm-runtime.sh
```

This downloads runtime files from `https://ds.44670.org/` into `desmume/wasm-port/`.

## Save behavior

The embed stores save-memory snapshots in `localStorage` under:

- `pkplat_embed.desmume_wasm.sav`

So save persistence is tied to this key in the browser profile.

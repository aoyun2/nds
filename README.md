# pkplat_embed

Single-page Pokemon Platinum embed using the Desmond web component.

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Save persistence fix

Desmond save persistence is keyed to the ROM URL. If you call `player.loadURL(blob:...)`, the blob URL changes every page load, so save data appears to "not persist."

This project keeps the progress UI but now boots the emulator with the stable `ROM_URL` directly:

- prefetch with progress bar for UX
- then `player.loadURL(ROM_URL, ...)` for stable save key

As long as you use the same browser profile + same site origin + same ROM URL, saves should persist.

#!/bin/bash
# split-rom.sh — Split a ROM file into GitHub-safe chunks (24 MB each)
# Usage: ./split-rom.sh path/to/game.nds
#
# Creates:
#   rom/00.bin, rom/01.bin, ...
#   rom/manifest.json  (chunk count + total bytes)

set -e

ROM="$1"
CHUNK_SIZE=$((24 * 1024 * 1024))  # 24 MB per chunk (under GitHub's 25 MB web-upload limit)
OUT_DIR="rom"

if [ -z "$ROM" ] || [ ! -f "$ROM" ]; then
  echo "Usage: $0 <rom-file.nds>"
  exit 1
fi

TOTAL=$(wc -c < "$ROM" | tr -d ' ')
CHUNKS=$(( (TOTAL + CHUNK_SIZE - 1) / CHUNK_SIZE ))

echo "ROM:    $ROM"
echo "Size:   $TOTAL bytes ($(echo "scale=1; $TOTAL/1048576" | bc) MB)"
echo "Chunks: $CHUNKS × $(echo "scale=0; $CHUNK_SIZE/1048576" | bc) MB"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Split
split -b "$CHUNK_SIZE" -d -a 2 "$ROM" "$OUT_DIR/"

# Rename to NN.bin
i=0
for f in "$OUT_DIR"/[0-9]*; do
  mv "$f" "$OUT_DIR/$(printf '%02d' $i).bin"
  i=$((i+1))
done

# Write manifest
cat > "$OUT_DIR/manifest.json" <<EOF
{
  "chunks": $CHUNKS,
  "totalBytes": $TOTAL
}
EOF

echo ""
echo "Done! Files in $OUT_DIR/:"
ls -lh "$OUT_DIR/"
echo ""
echo "Add the rom/ folder to your repo alongside index.html"

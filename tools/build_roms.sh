#!/usr/bin/env bash
# Build the Williams sound ROMs from source.
#
# Pipeline:
#   1. Run `williams_preproc.py` to bridge the Williams dialect → vasm-oldstyle.
#   2. Assemble with vasm (Motorola SREC output, which tolerates the harmless
#      vector/main section overlap in Robotron).
#   3. Parse the SREC into address→byte map and extract the canonical ROM range.
#
# Result: research/roms/{defender,stargate,robotron}_sound.bin
# (research/ is the private submodule holding the source + assembled ROMs.)
#
# Requires: tools/vasm6800_oldstyle, Python 3, the source at
# research/williams-soundroms/.

set -euo pipefail

cd "$(dirname "$0")/.."
PREPROC="tools/williams_preproc.py"
VASM="tools/vasm6800_oldstyle"

declare -a GAMES=(
  "VSNDRM1 0xF800 2048 defender_sound.bin"
  "VSNDRM2 0xF800 2048 stargate_sound.bin"
  "VSNDRM3 0xF000 4096 robotron_sound.bin"
)

mkdir -p tools/build research/roms
for entry in "${GAMES[@]}"; do
  read -r src base size out <<<"$entry"
  printf "%-9s " "$src"
  python3 "$PREPROC" "research/williams-soundroms/${src}.SRC" > "tools/build/${src}.s68"
  # vasm reports a fatal-ish warning on Robotron's 3-byte section overlap but
  # writes the SREC anyway.  We tolerate that error code and parse the result.
  "$VASM" -Fsrec -ast -unsshift -L "tools/build/${src}.lst" -o "tools/build/${src}.s19" "tools/build/${src}.s68" \
    2>"tools/build/${src}.log" >/dev/null || true
  if [ ! -s "tools/build/${src}.s19" ]; then
    echo "FAIL — no SREC output:"; tail -5 "tools/build/${src}.log"; exit 1
  fi
  python3 - "$src" "$base" "$size" "$out" <<'PYEOF'
import sys
src, base, size, out = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3]), sys.argv[4]
mem = {}
with open(f"tools/build/{src}.s19") as f:
    for line in f:
        line = line.strip()
        if not line.startswith("S"): continue
        t = line[1]
        if t == "1":   alen = 2
        elif t == "2": alen = 3
        elif t == "3": alen = 4
        else: continue
        addr = int(line[4:4+alen*2], 16)
        data = bytes.fromhex(line[4+alen*2:-2])
        for i, b in enumerate(data):
            mem[addr + i] = b
rom = bytes(mem.get(base + i, 0) for i in range(size))
open(f"research/roms/{out}", "wb").write(rom)
vecs = [(rom[-8] << 8) | rom[-7], (rom[-6] << 8) | rom[-5],
        (rom[-4] << 8) | rom[-3], (rom[-2] << 8) | rom[-1]]
ok = all(base <= v <= base + size - 1 for v in vecs)
print(f"→ research/roms/{out}  {size}B  IRQ=${vecs[0]:04X} RESET=${vecs[3]:04X}  {'OK' if ok else 'VECTORS OUT OF RANGE'}")
PYEOF
done

echo
echo "Done."
ls -la research/roms/*_sound.bin

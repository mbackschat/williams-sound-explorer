#!/usr/bin/env bash
# Re-render the bulk audio corpus into `out/corpus/{game}/{XX_ROUTINE}.wav`.
#
# Run after any change that could alter rendered output:
#   • `tools/build_roms.sh` produces different *_sound.bin (preprocessor
#     fix, source rev bump).  Check via `tools/verify_roms.sh`.
#   • Changes to explorer's runner / synth pipeline:
#       explorer/src/engine/* (runner.ts, realtimeRunner.ts, …)
#       explorer/src/node/runnerNode.ts
#       explorer/src/cpu/* (opcodes, ALU)
#       explorer/src/synth/* (DacSampler, lpf, wav)
#   • Changes to `tools/render_all.ts` itself (sample rate, cycle cap, sequence handling).
#   • New command entries in the glossary (catalogue + tools/build_glossary.py).
#
# The corpus is gitignored — this script just refreshes the local copy.
# Render takes ~30 seconds total across all three games (or pass one
# game name as an arg to refresh just that one).
#
# Usage:
#   tools/refresh_corpus.sh                  # all 3 games
#   tools/refresh_corpus.sh defender         # one game only
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npx >/dev/null 2>&1; then
  echo "FATAL: npx not found.  Install Node.js (the explorer dir uses it)." >&2
  exit 2
fi

echo "→ refreshing bulk audio corpus into out/corpus/"
exec npx tsx tools/render_all.ts "$@"

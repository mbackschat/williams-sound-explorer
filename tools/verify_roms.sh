#!/usr/bin/env bash
# Verify that the assembled-from-source sound ROMs match the production
# ROM dumps shipped by MAME.  Run after `tools/build_roms.sh`.
#
# Hard-coded reference SHA1s come from `mame -listroms <game>` (MAME 0.287)
# and are the canonical Williams sound ROMs.  See `docs/vasm_install_notes.md`
# for the audit that closed Robotron's 3812-byte mismatch.
#
# Exit codes:
#   0  → all match (or Defender shows its known 2-byte source-revision delta)
#   1  → at least one ROM doesn't match expectations

set -euo pipefail
cd "$(dirname "$0")/.."

declare -A EXPECTED=(
  [defender]=ceb0d18483f0691978c604db94417e6941ad7ff2
  [stargate]=9c4334ac3ff15d94001b22fc367af40f9deb7d57
  [robotron]=15afefef11bfc3ab78f61ab046701db78d160ec3
)

# Defender's cloned source contains a 2-byte revision delta against the
# production ROM (checksum byte at $F800 + one byte at $FDB6 inside ORGTAB).
# Documented in vasm_install_notes.md; not a tooling bug.
declare -A KNOWN_DELTA_BYTES=( [defender]=2 [stargate]=0 [robotron]=0 )

fail=0
for game in defender stargate robotron; do
  bin="research/roms/${game}_sound.bin"
  if [ ! -f "$bin" ]; then
    echo "  ✗ $game  $bin not found — run tools/build_roms.sh first"
    fail=1
    continue
  fi
  actual=$(shasum "$bin" | awk '{print $1}')
  expected=${EXPECTED[$game]}

  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $game  SHA1 matches production ROM ($expected)"
  else
    # SHA1 differs.  Try to extract MAME's bundled ROM (if MAME is installed)
    # and report the per-byte delta.
    mame_zip=$(mame -showconfig 2>/dev/null | awk '/^rompath/{print $2}' | cut -d';' -f1)/${game}.zip
    snd_name=$(case $game in defender) echo defend.snd;; stargate) echo sg.snd;; robotron) echo robotron.snd;; esac)
    delta="(MAME not available — can't compute byte delta)"
    if command -v unzip >/dev/null 2>&1 && [ -f "$mame_zip" ]; then
      tmp=$(mktemp -d)
      unzip -j "$mame_zip" "$snd_name" -d "$tmp" >/dev/null 2>&1 || true
      if [ -f "$tmp/$snd_name" ]; then
        # cmp -l exits non-zero when files differ — explicitly tolerate it.
        diff_bytes=$( { cmp -l "$bin" "$tmp/$snd_name" 2>/dev/null || true; } | wc -l | tr -d ' ')
        delta="$diff_bytes bytes differ"
      fi
      rm -rf "$tmp"
    fi

    known=${KNOWN_DELTA_BYTES[$game]}
    if [ "$known" -gt 0 ] && [[ "$delta" == "$known bytes differ" ]]; then
      echo "  ~ $game  SHA1 differs but byte delta matches known source revision (${known} bytes)"
    else
      echo "  ✗ $game  SHA1 differs from production — $delta"
      echo "       expected: $expected"
      echo "       actual:   $actual"
      fail=1
    fi
  fi
done

exit $fail

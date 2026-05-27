/**
 * Per-engine state extraction for snapshots (Steps 4.1 → 5.2).
 *
 * Each synthesis engine (LFSR / VARI / GWAVE / SCREAM / ORGAN) keeps its
 * working state in well-known zero-page RAM cells documented in the ROM
 * source (e.g. `LO EQU $0A`, `LFREQ EQU $19` in VSNDRM1.SRC).  When the CPU
 * sits inside a routine that uses an engine, this module reads the cells
 * and produces a structured snapshot.
 *
 * **Per-game specs.**  The same engine often lives at different absolute
 * addresses on Robotron vs Defender/Stargate (Robotron's source was rewritten
 * with its own zero-page layout), so this file holds one `Spec` per game per
 * engine.  Dispatch is by PC range — when the CPU's PC falls inside an
 * engine's code block, the matching spec's cells are read.
 *
 * **Why hardcoded, not from the label-map JSON.**  The worklet runs in the
 * audio thread, where `fetch` round-trips per snapshot tick are unacceptable.
 * The cell addresses are fixed at assembly time anyway, so hardcoding them
 * is no more brittle than embedding the JSON would be.
 */
import type { SoundBoard, GameKind } from "../board/soundboard.ts";

import type {
  LfsrState, VariState, GWaveState, ScreamState, FNoiseState, OrganState, EngineSlots,
} from "../data/protocol.ts";

// ─── Engine-state slot shapes (defined once in data/protocol.ts) ─────────
// Re-exported here so this module’s producers and existing importers keep a
// stable import site.
export type {
  LfsrState, VariState, GWaveState, ScreamState, FNoiseState, OrganState, EngineSlots,
};

// ─── Per-engine, per-game specs ───────────────────────────────────────────────

interface LfsrSpec {
  range: [number, number];
  /** RAM addresses for HI/LO/LFREQ/CYCNT — vary across games. */
  hi: number; lo: number; lfreq: number; cycnt: number;
}
interface VariSpec {
  range: [number, number];
  loper: number; hiper: number; lodt: number; hidt: number;
  hien: number; lomod: number; locnt: number; hicnt: number;
}
interface GWaveSpec {
  range: [number, number];
  /** WVDECA decay-loop range for `gwaveSkipDecay` toggle gating. */
  wvdeca: [number, number];
  echo: number; gccnt: number; gecdec: number; gdfinc: number; gdcnt: number;
  gwfrmLo: number; gwfrmHi: number; prdeca: number;
  gwfrqLo: number; gwfrqHi: number;
  gper: number; gecnt: number; fofset: number;
  gwtabBase: number; gwtabLength: number;
}
interface ScreamSpec {
  range: [number, number];
  /** STABLE base; layout = 4 × (freq, timer) consecutively. */
  stableBase: number;
  voices: number;
}
interface OrganSpec {
  range: [number, number];
  durLo: number; durHi: number;
  oscil: number;
  rdelayBase: number; rdelayLength: number;
}
interface FNoiseSpec {
  range: [number, number];
  fmax: number;
  fhi: number; flo: number;
  sampcLo: number; sampcHi: number;
  fdflg: number;
  dsflg: number;
}

const LFSR_SPECS: Partial<Record<GameKind, LfsrSpec>> = {
  defender: { range: [0xF88C, 0xF8DC], hi: 0x09, lo: 0x0A, lfreq: 0x19, cycnt: 0x15 },
  stargate: { range: [0xF88C, 0xF8DC], hi: 0x09, lo: 0x0A, lfreq: 0x19, cycnt: 0x15 },
  robotron: { range: [0xF55C, 0xF59D], hi: 0x05, lo: 0x06, lfreq: 0x18, cycnt: 0x14 },
};

const VARI_SPECS: Partial<Record<GameKind, VariSpec>> = {
  defender: {
    range: [0xF82A, 0xF88C],
    loper: 0x13, hiper: 0x14, lodt: 0x15, hidt: 0x16,
    hien: 0x17, lomod: 0x1A, locnt: 0x1C, hicnt: 0x1D,
  },
  stargate: {
    range: [0xF82A, 0xF88C],
    loper: 0x13, hiper: 0x14, lodt: 0x15, hidt: 0x16,
    hien: 0x17, lomod: 0x1A, locnt: 0x1C, hicnt: 0x1D,
  },
  robotron: {
    // Robotron's VARI block: VARILD F4F0 → LAUNCH F552.
    range: [0xF4F0, 0xF552],
    loper: 0x12, hiper: 0x13, lodt: 0x14, hidt: 0x15,
    hien: 0x16, lomod: 0x19, locnt: 0x1B, hicnt: 0x1C,
  },
};

const GWAVE_SPECS: Partial<Record<GameKind, GWaveSpec>> = {
  defender: {
    range: [0xFB81, 0xFCB6], wvdeca: [0xFC87, 0xFCB5],
    echo: 0x13, gccnt: 0x14, gecdec: 0x15, gdfinc: 0x16, gdcnt: 0x17,
    gwfrmLo: 0x18, gwfrmHi: 0x19, prdeca: 0x1A,
    gwfrqLo: 0x1B, gwfrqHi: 0x1C,
    gper: 0x21, gecnt: 0x22, fofset: 0x23,
    gwtabBase: 0x24, gwtabLength: 72,
  },
  stargate: {
    range: [0xFB57, 0xFC8C], wvdeca: [0xFC5D, 0xFC8B],
    echo: 0x13, gccnt: 0x14, gecdec: 0x15, gdfinc: 0x16, gdcnt: 0x17,
    gwfrmLo: 0x18, gwfrmHi: 0x19, prdeca: 0x1A,
    gwfrqLo: 0x1B, gwfrqHi: 0x1C,
    gper: 0x21, gecnt: 0x22, fofset: 0x23,
    gwtabBase: 0x24, gwtabLength: 72,
  },
  robotron: {
    // GWLD F9DE → IRQ FB13.  WVDECA FAE4 → WVDCX FB12.
    range: [0xF9DE, 0xFB13], wvdeca: [0xFAE4, 0xFB12],
    echo: 0x12, gccnt: 0x13, gecdec: 0x14, gdfinc: 0x15, gdcnt: 0x16,
    gwfrmLo: 0x17, gwfrmHi: 0x18, prdeca: 0x19,
    gwfrqLo: 0x1A, gwfrqHi: 0x1B,
    gper: 0x20, gecnt: 0x21, fofset: 0x22,
    gwtabBase: 0x23, gwtabLength: 72,
  },
};

const SCREAM_SPECS: Partial<Record<GameKind, ScreamSpec>> = {
  // SCREAM is shared by all three games (born on Defender; Robotron adds
  // voice-spawn detune).  4 voices × 2 bytes from STABLE.  D/S overlay STABLE
  // at $13 (one cell higher than Robotron's $12).
  // Defender/Stargate: SCREAM F9F3 → ORGANT FA44.
  defender: { range: [0xF9F3, 0xFA44], stableBase: 0x13, voices: 4 },
  stargate: { range: [0xF9F3, 0xFA44], stableBase: 0x13, voices: 4 },
  // Robotron: SCREAM F87A → ORGANT F8CB, STABLE=$12.
  robotron: { range: [0xF87A, 0xF8CB], stableBase: 0x12, voices: 4 },
};

const ORGAN_SPECS: Partial<Record<GameKind, OrganSpec>> = {
  // ORGAN ($1B ORGANT / $1C ORGANN) exists on all three games.  The DAC
  // playback loop is ORGAN1; the range spans ORGANT → TRANS so it brackets it.
  // D/S overlay one cell higher than Robotron: DUR=$13 (word), OSCIL=$15,
  // RDELAY=$16 × 60.  Defender ORGAN1 @ FADD, Stargate @ FAB2.
  defender: {
    range: [0xFA44, 0xFB0A],
    durLo: 0x13, durHi: 0x14,
    oscil: 0x15,
    rdelayBase: 0x16, rdelayLength: 60,
  },
  stargate: {
    range: [0xFA44, 0xFAE0],
    durLo: 0x13, durHi: 0x14,
    oscil: 0x15,
    rdelayBase: 0x16, rdelayLength: 60,
  },
  // Robotron: ORGANT F8CB → TRANS F967.  DUR=$12 (word), OSCIL=$14, RDELAY=$15.
  robotron: {
    range: [0xF8CB, 0xF967],
    durLo: 0x12, durHi: 0x13,
    oscil: 0x14,
    rdelayBase: 0x15, rdelayLength: 60,
  },
};

/**
 * FNOISE inner-loop ranges.  Just the FNOISE..FNOIS6 block — the setup
 * paths (BG1 / THRUST / CANNON / FNLOAD) are excluded so the slot only
 * shows up once the inner loop is actually generating audio.  Robotron's
 * zero-page layout has an extra LOFRQ cell at $15, so its SAMPC sits at
 * $16:$17 just like Defender/Stargate but the FMAX/FHI/FLO triplet is
 * shifted one cell lower.
 */
const FNOISE_SPECS: Partial<Record<GameKind, FNoiseSpec>> = {
  defender: {
    range: [0xF930, 0xF9A6],
    fmax: 0x13, fhi: 0x14, flo: 0x15,
    sampcLo: 0x16, sampcHi: 0x17,
    fdflg: 0x18, dsflg: 0x19,
  },
  stargate: {
    range: [0xF930, 0xF9A6],
    fmax: 0x13, fhi: 0x14, flo: 0x15,
    sampcLo: 0x16, sampcHi: 0x17,
    fdflg: 0x18, dsflg: 0x19,
  },
  robotron: {
    range: [0xF7B5, 0xF82D],
    fmax: 0x12, fhi: 0x13, flo: 0x14,
    sampcLo: 0x16, sampcHi: 0x17,
    fdflg: 0x18, dsflg: 0x19,
  },
};

/**
 * Per-game WVDECA address range exposed for the `gwaveSkipDecay` toggle.
 * Pulled from `GWAVE_SPECS` so all engine address-tables live in one place.
 */
export function wvdecaRange(game: GameKind): [number, number] | undefined {
  return GWAVE_SPECS[game]?.wvdeca;
}

const s8 = (v: number): number => (v & 0x80 ? v - 0x100 : v);
const popcount8 = (v: number): number => {
  let n = 0;
  for (let b = 1; b < 256; b <<= 1) if (v & b) n++;
  return n;
};

/**
 * Inspect the current CPU + RAM state and return whichever engine slot is
 * active.  Returns `{}` when PC is outside every known range.  Only reads
 * RAM (zero-page $00..$7F) — never triggers PIA read-clear side effects.
 * Safe to call from `snapshot()`.
 *
 * Optional `ramOverride` lets scrub mode feed in a historical RAM snapshot
 * captured at the head's cycle, so the engine slot's *values* time-travel
 * along with the audio.  Without an override, the live board RAM is read.
 */
export function engineStateForPc(
  pc: number,
  board: SoundBoard,
  x?: number,
  ramOverride?: Uint8Array,
): EngineSlots {
  const slots: EngineSlots = {};
  const game = board.game;
  const readRam = ramOverride !== undefined
    ? (addr: number) => ramOverride[addr & 0xFF]!
    : (addr: number) => board.read(addr);

  const lfsr = LFSR_SPECS[game];
  if (lfsr && pc >= lfsr.range[0] && pc < lfsr.range[1]) {
    const lo = readRam(lfsr.lo);
    const hi = readRam(lfsr.hi);
    slots.lfsr = {
      state: ((hi << 8) | lo) & 0xFFFF,
      bitOut: (lo & 1) as 0 | 1,
      lfreq: readRam(lfsr.lfreq),
      cycnt: readRam(lfsr.cycnt),
    };
  }

  const vari = VARI_SPECS[game];
  if (vari && pc >= vari.range[0] && pc < vari.range[1]) {
    slots.vari = {
      loper: readRam(vari.loper),
      hiper: readRam(vari.hiper),
      lodt: s8(readRam(vari.lodt)),
      hidt: s8(readRam(vari.hidt)),
      hien: readRam(vari.hien),
      lomod: s8(readRam(vari.lomod)),
      locnt: readRam(vari.locnt),
      hicnt: readRam(vari.hicnt),
    };
  }

  const gw = GWAVE_SPECS[game];
  if (gw && pc >= gw.range[0] && pc < gw.range[1]) {
    const waveTable = new Uint8Array(gw.gwtabLength);
    for (let i = 0; i < gw.gwtabLength; i++) {
      waveTable[i] = readRam(gw.gwtabBase + i);
    }
    const cursor = x !== undefined ? (x & 0xFFFF) - gw.gwtabBase : -1;
    slots.gwave = {
      echo: readRam(gw.echo),
      gccnt: readRam(gw.gccnt),
      gecdec: readRam(gw.gecdec),
      gdfinc: s8(readRam(gw.gdfinc)),
      gdcnt: readRam(gw.gdcnt),
      gwfrm: ((readRam(gw.gwfrmHi) << 8) | readRam(gw.gwfrmLo)) & 0xFFFF,
      prdeca: readRam(gw.prdeca),
      gwfrq: ((readRam(gw.gwfrqHi) << 8) | readRam(gw.gwfrqLo)) & 0xFFFF,
      gper: readRam(gw.gper),
      gecnt: readRam(gw.gecnt),
      fofset: s8(readRam(gw.fofset)),
      waveTable,
      sampleIndex: cursor >= 0 && cursor < gw.gwtabLength ? cursor : -1,
    };
  }

  const sc = SCREAM_SPECS[game];
  if (sc && pc >= sc.range[0] && pc < sc.range[1]) {
    const voices: { freq: number; timer: number }[] = [];
    for (let v = 0; v < sc.voices; v++) {
      voices.push({
        freq: readRam(sc.stableBase + v * 2 + 0),
        timer: readRam(sc.stableBase + v * 2 + 1),
      });
    }
    slots.scream = { voices };
  }

  const fn = FNOISE_SPECS[game];
  if (fn && pc >= fn.range[0] && pc < fn.range[1]) {
    slots.fnoise = {
      fmax: readRam(fn.fmax),
      freq: ((readRam(fn.fhi) << 8) | readRam(fn.flo)) & 0xFFFF,
      sampc: ((readRam(fn.sampcHi) << 8) | readRam(fn.sampcLo)) & 0xFFFF,
      fdflg: readRam(fn.fdflg),
      dsflg: readRam(fn.dsflg),
    };
  }

  const org = ORGAN_SPECS[game];
  if (org && pc >= org.range[0] && pc < org.range[1]) {
    const rdelay = new Uint8Array(org.rdelayLength);
    for (let i = 0; i < org.rdelayLength; i++) {
      rdelay[i] = readRam(org.rdelayBase + i);
    }
    const oscil = readRam(org.oscil);
    slots.organ = {
      dur: ((readRam(org.durHi) << 8) | readRam(org.durLo)) & 0xFFFF,
      oscil,
      oscilCount: popcount8(oscil),
      rdelay,
    };
  }

  return slots;
}

/**
 * Minimal Motorola 6800 disassembler.
 *
 * Produces a human-readable rendering of the instruction at a given PC.
 * Knows about every opcode implemented in `instructions.ts` (~160); for any
 * other opcode it returns `mnemonic: "???"` with a 1-byte length so the
 * caller can still advance past it.
 *
 * Pure function: reads from the bus without side effects (the Williams PIA
 * has read-clears semantics on Port B, but `disassemble` only reads from
 * addresses determined by the *instruction operand bytes*, not from
 * runtime-resolved data — so it never touches the PIA).
 *
 * Output shape is plain data so it can be transferred across the
 * AudioWorklet boundary via postMessage.
 */
import type { Bus } from "./types.ts";

/** Addressing-mode kinds recognised by the disassembler. */
export type AddrMode =
  | "inh"   // inherent — no operand
  | "imm8"  // 1-byte immediate (`#$NN`)
  | "imm16" // 2-byte immediate (`#$NNNN`)
  | "dir"   // 1-byte direct (`$NN`)
  | "ext"   // 2-byte extended (`$NNNN`)
  | "idx"   // 1-byte indexed (`$NN,X`)
  | "rel";  // 1-byte signed relative branch

interface OpcodeInfo {
  mnemonic: string;
  mode: AddrMode;
}

/** Per-opcode mnemonic + addressing mode.  Length is derived from `mode`. */
export const MNEMONICS: (OpcodeInfo | undefined)[] = new Array(256);

// --- 0x00 ----------------------------------------------------------------
MNEMONICS[0x01] = { mnemonic: "NOP",  mode: "inh" };
MNEMONICS[0x06] = { mnemonic: "TAP",  mode: "inh" };
MNEMONICS[0x07] = { mnemonic: "TPA",  mode: "inh" };
MNEMONICS[0x08] = { mnemonic: "INX",  mode: "inh" };
MNEMONICS[0x09] = { mnemonic: "DEX",  mode: "inh" };
MNEMONICS[0x0A] = { mnemonic: "CLV",  mode: "inh" };
MNEMONICS[0x0B] = { mnemonic: "SEV",  mode: "inh" };
MNEMONICS[0x0C] = { mnemonic: "CLC",  mode: "inh" };
MNEMONICS[0x0D] = { mnemonic: "SEC",  mode: "inh" };
MNEMONICS[0x0E] = { mnemonic: "CLI",  mode: "inh" };
MNEMONICS[0x0F] = { mnemonic: "SEI",  mode: "inh" };
// --- 0x10 ----------------------------------------------------------------
MNEMONICS[0x10] = { mnemonic: "SBA",  mode: "inh" };
MNEMONICS[0x11] = { mnemonic: "CBA",  mode: "inh" };
MNEMONICS[0x16] = { mnemonic: "TAB",  mode: "inh" };
MNEMONICS[0x17] = { mnemonic: "TBA",  mode: "inh" };
MNEMONICS[0x1B] = { mnemonic: "ABA",  mode: "inh" };
// --- 0x20 — branches (relative) -----------------------------------------
MNEMONICS[0x20] = { mnemonic: "BRA",  mode: "rel" };
MNEMONICS[0x22] = { mnemonic: "BHI",  mode: "rel" };
MNEMONICS[0x23] = { mnemonic: "BLS",  mode: "rel" };
MNEMONICS[0x24] = { mnemonic: "BCC",  mode: "rel" };
MNEMONICS[0x25] = { mnemonic: "BCS",  mode: "rel" };
MNEMONICS[0x26] = { mnemonic: "BNE",  mode: "rel" };
MNEMONICS[0x27] = { mnemonic: "BEQ",  mode: "rel" };
MNEMONICS[0x28] = { mnemonic: "BVC",  mode: "rel" };
MNEMONICS[0x29] = { mnemonic: "BVS",  mode: "rel" };
MNEMONICS[0x2A] = { mnemonic: "BPL",  mode: "rel" };
MNEMONICS[0x2B] = { mnemonic: "BMI",  mode: "rel" };
MNEMONICS[0x2C] = { mnemonic: "BGE",  mode: "rel" };
MNEMONICS[0x2D] = { mnemonic: "BLT",  mode: "rel" };
MNEMONICS[0x2E] = { mnemonic: "BGT",  mode: "rel" };
MNEMONICS[0x2F] = { mnemonic: "BLE",  mode: "rel" };
// --- 0x30 — stack/return -------------------------------------------------
MNEMONICS[0x30] = { mnemonic: "TSX",  mode: "inh" };
MNEMONICS[0x31] = { mnemonic: "INS",  mode: "inh" };
MNEMONICS[0x32] = { mnemonic: "PULA", mode: "inh" };
MNEMONICS[0x33] = { mnemonic: "PULB", mode: "inh" };
MNEMONICS[0x34] = { mnemonic: "DES",  mode: "inh" };
MNEMONICS[0x35] = { mnemonic: "TXS",  mode: "inh" };
MNEMONICS[0x36] = { mnemonic: "PSHA", mode: "inh" };
MNEMONICS[0x37] = { mnemonic: "PSHB", mode: "inh" };
MNEMONICS[0x39] = { mnemonic: "RTS",  mode: "inh" };
MNEMONICS[0x3B] = { mnemonic: "RTI",  mode: "inh" };
MNEMONICS[0x3E] = { mnemonic: "WAI",  mode: "inh" };
// --- 0x40 — inherent A ---------------------------------------------------
MNEMONICS[0x40] = { mnemonic: "NEGA", mode: "inh" };
MNEMONICS[0x43] = { mnemonic: "COMA", mode: "inh" };
MNEMONICS[0x44] = { mnemonic: "LSRA", mode: "inh" };
MNEMONICS[0x46] = { mnemonic: "RORA", mode: "inh" };
MNEMONICS[0x47] = { mnemonic: "ASRA", mode: "inh" };
MNEMONICS[0x48] = { mnemonic: "ASLA", mode: "inh" };
MNEMONICS[0x49] = { mnemonic: "ROLA", mode: "inh" };
MNEMONICS[0x4A] = { mnemonic: "DECA", mode: "inh" };
MNEMONICS[0x4C] = { mnemonic: "INCA", mode: "inh" };
MNEMONICS[0x4D] = { mnemonic: "TSTA", mode: "inh" };
MNEMONICS[0x4F] = { mnemonic: "CLRA", mode: "inh" };
// --- 0x50 — inherent B ---------------------------------------------------
MNEMONICS[0x50] = { mnemonic: "NEGB", mode: "inh" };
MNEMONICS[0x53] = { mnemonic: "COMB", mode: "inh" };
MNEMONICS[0x54] = { mnemonic: "LSRB", mode: "inh" };
MNEMONICS[0x56] = { mnemonic: "RORB", mode: "inh" };
MNEMONICS[0x57] = { mnemonic: "ASRB", mode: "inh" };
MNEMONICS[0x58] = { mnemonic: "ASLB", mode: "inh" };
MNEMONICS[0x59] = { mnemonic: "ROLB", mode: "inh" };
MNEMONICS[0x5A] = { mnemonic: "DECB", mode: "inh" };
MNEMONICS[0x5C] = { mnemonic: "INCB", mode: "inh" };
MNEMONICS[0x5D] = { mnemonic: "TSTB", mode: "inh" };
MNEMONICS[0x5F] = { mnemonic: "CLRB", mode: "inh" };
// --- 0x60 — indexed RMW + JMP/CLR ---------------------------------------
MNEMONICS[0x60] = { mnemonic: "NEG",  mode: "idx" };
MNEMONICS[0x63] = { mnemonic: "COM",  mode: "idx" };
MNEMONICS[0x64] = { mnemonic: "LSR",  mode: "idx" };
MNEMONICS[0x66] = { mnemonic: "ROR",  mode: "idx" };
MNEMONICS[0x67] = { mnemonic: "ASR",  mode: "idx" };
MNEMONICS[0x68] = { mnemonic: "ASL",  mode: "idx" };
MNEMONICS[0x69] = { mnemonic: "ROL",  mode: "idx" };
MNEMONICS[0x6A] = { mnemonic: "DEC",  mode: "idx" };
MNEMONICS[0x6C] = { mnemonic: "INC",  mode: "idx" };
MNEMONICS[0x6D] = { mnemonic: "TST",  mode: "idx" };
MNEMONICS[0x6E] = { mnemonic: "JMP",  mode: "idx" };
MNEMONICS[0x6F] = { mnemonic: "CLR",  mode: "idx" };
// --- 0x70 — extended RMW + JMP/CLR --------------------------------------
MNEMONICS[0x70] = { mnemonic: "NEG",  mode: "ext" };
MNEMONICS[0x73] = { mnemonic: "COM",  mode: "ext" };
MNEMONICS[0x74] = { mnemonic: "LSR",  mode: "ext" };
MNEMONICS[0x76] = { mnemonic: "ROR",  mode: "ext" };
MNEMONICS[0x77] = { mnemonic: "ASR",  mode: "ext" };
MNEMONICS[0x78] = { mnemonic: "ASL",  mode: "ext" };
MNEMONICS[0x79] = { mnemonic: "ROL",  mode: "ext" };
MNEMONICS[0x7A] = { mnemonic: "DEC",  mode: "ext" };
MNEMONICS[0x7C] = { mnemonic: "INC",  mode: "ext" };
MNEMONICS[0x7D] = { mnemonic: "TST",  mode: "ext" };
MNEMONICS[0x7E] = { mnemonic: "JMP",  mode: "ext" };
MNEMONICS[0x7F] = { mnemonic: "CLR",  mode: "ext" };
// --- 0x80 — A immediate --------------------------------------------------
MNEMONICS[0x80] = { mnemonic: "SUBA", mode: "imm8" };
MNEMONICS[0x81] = { mnemonic: "CMPA", mode: "imm8" };
MNEMONICS[0x82] = { mnemonic: "SBCA", mode: "imm8" };
MNEMONICS[0x84] = { mnemonic: "ANDA", mode: "imm8" };
MNEMONICS[0x85] = { mnemonic: "BITA", mode: "imm8" };
MNEMONICS[0x86] = { mnemonic: "LDAA", mode: "imm8" };
MNEMONICS[0x88] = { mnemonic: "EORA", mode: "imm8" };
MNEMONICS[0x89] = { mnemonic: "ADCA", mode: "imm8" };
MNEMONICS[0x8A] = { mnemonic: "ORAA", mode: "imm8" };
MNEMONICS[0x8B] = { mnemonic: "ADDA", mode: "imm8" };
MNEMONICS[0x8C] = { mnemonic: "CPX",  mode: "imm16" };
MNEMONICS[0x8D] = { mnemonic: "BSR",  mode: "rel" };
MNEMONICS[0x8E] = { mnemonic: "LDS",  mode: "imm16" };
// --- 0x90 — A direct -----------------------------------------------------
MNEMONICS[0x90] = { mnemonic: "SUBA", mode: "dir" };
MNEMONICS[0x91] = { mnemonic: "CMPA", mode: "dir" };
MNEMONICS[0x92] = { mnemonic: "SBCA", mode: "dir" };
MNEMONICS[0x94] = { mnemonic: "ANDA", mode: "dir" };
MNEMONICS[0x95] = { mnemonic: "BITA", mode: "dir" };
MNEMONICS[0x96] = { mnemonic: "LDAA", mode: "dir" };
MNEMONICS[0x97] = { mnemonic: "STAA", mode: "dir" };
MNEMONICS[0x98] = { mnemonic: "EORA", mode: "dir" };
MNEMONICS[0x99] = { mnemonic: "ADCA", mode: "dir" };
MNEMONICS[0x9A] = { mnemonic: "ORAA", mode: "dir" };
MNEMONICS[0x9B] = { mnemonic: "ADDA", mode: "dir" };
MNEMONICS[0x9C] = { mnemonic: "CPX",  mode: "dir" };
MNEMONICS[0x9E] = { mnemonic: "LDS",  mode: "dir" };
MNEMONICS[0x9F] = { mnemonic: "STS",  mode: "dir" };
// --- 0xA0 — A indexed ----------------------------------------------------
MNEMONICS[0xA0] = { mnemonic: "SUBA", mode: "idx" };
MNEMONICS[0xA1] = { mnemonic: "CMPA", mode: "idx" };
MNEMONICS[0xA2] = { mnemonic: "SBCA", mode: "idx" };
MNEMONICS[0xA4] = { mnemonic: "ANDA", mode: "idx" };
MNEMONICS[0xA5] = { mnemonic: "BITA", mode: "idx" };
MNEMONICS[0xA6] = { mnemonic: "LDAA", mode: "idx" };
MNEMONICS[0xA7] = { mnemonic: "STAA", mode: "idx" };
MNEMONICS[0xA8] = { mnemonic: "EORA", mode: "idx" };
MNEMONICS[0xA9] = { mnemonic: "ADCA", mode: "idx" };
MNEMONICS[0xAA] = { mnemonic: "ORAA", mode: "idx" };
MNEMONICS[0xAB] = { mnemonic: "ADDA", mode: "idx" };
MNEMONICS[0xAC] = { mnemonic: "CPX",  mode: "idx" };
MNEMONICS[0xAD] = { mnemonic: "JSR",  mode: "idx" };
MNEMONICS[0xAE] = { mnemonic: "LDS",  mode: "idx" };
MNEMONICS[0xAF] = { mnemonic: "STS",  mode: "idx" };
// --- 0xB0 — A extended ---------------------------------------------------
MNEMONICS[0xB0] = { mnemonic: "SUBA", mode: "ext" };
MNEMONICS[0xB1] = { mnemonic: "CMPA", mode: "ext" };
MNEMONICS[0xB2] = { mnemonic: "SBCA", mode: "ext" };
MNEMONICS[0xB4] = { mnemonic: "ANDA", mode: "ext" };
MNEMONICS[0xB5] = { mnemonic: "BITA", mode: "ext" };
MNEMONICS[0xB6] = { mnemonic: "LDAA", mode: "ext" };
MNEMONICS[0xB7] = { mnemonic: "STAA", mode: "ext" };
MNEMONICS[0xB8] = { mnemonic: "EORA", mode: "ext" };
MNEMONICS[0xB9] = { mnemonic: "ADCA", mode: "ext" };
MNEMONICS[0xBA] = { mnemonic: "ORAA", mode: "ext" };
MNEMONICS[0xBB] = { mnemonic: "ADDA", mode: "ext" };
MNEMONICS[0xBC] = { mnemonic: "CPX",  mode: "ext" };
MNEMONICS[0xBD] = { mnemonic: "JSR",  mode: "ext" };
MNEMONICS[0xBE] = { mnemonic: "LDS",  mode: "ext" };
MNEMONICS[0xBF] = { mnemonic: "STS",  mode: "ext" };
// --- 0xC0 — B immediate --------------------------------------------------
MNEMONICS[0xC0] = { mnemonic: "SUBB", mode: "imm8" };
MNEMONICS[0xC1] = { mnemonic: "CMPB", mode: "imm8" };
MNEMONICS[0xC2] = { mnemonic: "SBCB", mode: "imm8" };
MNEMONICS[0xC4] = { mnemonic: "ANDB", mode: "imm8" };
MNEMONICS[0xC5] = { mnemonic: "BITB", mode: "imm8" };
MNEMONICS[0xC6] = { mnemonic: "LDAB", mode: "imm8" };
MNEMONICS[0xC8] = { mnemonic: "EORB", mode: "imm8" };
MNEMONICS[0xC9] = { mnemonic: "ADCB", mode: "imm8" };
MNEMONICS[0xCA] = { mnemonic: "ORAB", mode: "imm8" };
MNEMONICS[0xCB] = { mnemonic: "ADDB", mode: "imm8" };
MNEMONICS[0xCE] = { mnemonic: "LDX",  mode: "imm16" };
// --- 0xD0 — B direct -----------------------------------------------------
MNEMONICS[0xD0] = { mnemonic: "SUBB", mode: "dir" };
MNEMONICS[0xD1] = { mnemonic: "CMPB", mode: "dir" };
MNEMONICS[0xD2] = { mnemonic: "SBCB", mode: "dir" };
MNEMONICS[0xD4] = { mnemonic: "ANDB", mode: "dir" };
MNEMONICS[0xD5] = { mnemonic: "BITB", mode: "dir" };
MNEMONICS[0xD6] = { mnemonic: "LDAB", mode: "dir" };
MNEMONICS[0xD7] = { mnemonic: "STAB", mode: "dir" };
MNEMONICS[0xD8] = { mnemonic: "EORB", mode: "dir" };
MNEMONICS[0xD9] = { mnemonic: "ADCB", mode: "dir" };
MNEMONICS[0xDA] = { mnemonic: "ORAB", mode: "dir" };
MNEMONICS[0xDB] = { mnemonic: "ADDB", mode: "dir" };
MNEMONICS[0xDE] = { mnemonic: "LDX",  mode: "dir" };
MNEMONICS[0xDF] = { mnemonic: "STX",  mode: "dir" };
// --- 0xE0 — B indexed ----------------------------------------------------
MNEMONICS[0xE0] = { mnemonic: "SUBB", mode: "idx" };
MNEMONICS[0xE1] = { mnemonic: "CMPB", mode: "idx" };
MNEMONICS[0xE2] = { mnemonic: "SBCB", mode: "idx" };
MNEMONICS[0xE4] = { mnemonic: "ANDB", mode: "idx" };
MNEMONICS[0xE5] = { mnemonic: "BITB", mode: "idx" };
MNEMONICS[0xE6] = { mnemonic: "LDAB", mode: "idx" };
MNEMONICS[0xE7] = { mnemonic: "STAB", mode: "idx" };
MNEMONICS[0xE8] = { mnemonic: "EORB", mode: "idx" };
MNEMONICS[0xE9] = { mnemonic: "ADCB", mode: "idx" };
MNEMONICS[0xEA] = { mnemonic: "ORAB", mode: "idx" };
MNEMONICS[0xEB] = { mnemonic: "ADDB", mode: "idx" };
MNEMONICS[0xEE] = { mnemonic: "LDX",  mode: "idx" };
MNEMONICS[0xEF] = { mnemonic: "STX",  mode: "idx" };
// --- 0xF0 — B extended ---------------------------------------------------
MNEMONICS[0xF0] = { mnemonic: "SUBB", mode: "ext" };
MNEMONICS[0xF1] = { mnemonic: "CMPB", mode: "ext" };
MNEMONICS[0xF2] = { mnemonic: "SBCB", mode: "ext" };
MNEMONICS[0xF4] = { mnemonic: "ANDB", mode: "ext" };
MNEMONICS[0xF5] = { mnemonic: "BITB", mode: "ext" };
MNEMONICS[0xF6] = { mnemonic: "LDAB", mode: "ext" };
MNEMONICS[0xF7] = { mnemonic: "STAB", mode: "ext" };
MNEMONICS[0xF8] = { mnemonic: "EORB", mode: "ext" };
MNEMONICS[0xF9] = { mnemonic: "ADCB", mode: "ext" };
MNEMONICS[0xFA] = { mnemonic: "ORAB", mode: "ext" };
MNEMONICS[0xFB] = { mnemonic: "ADDB", mode: "ext" };
MNEMONICS[0xFE] = { mnemonic: "LDX",  mode: "ext" };
MNEMONICS[0xFF] = { mnemonic: "STX",  mode: "ext" };

/** Result of a single disassembly. */
export interface Disassembly {
  /** Absolute PC where the instruction starts. */
  address: number;
  /** Bytes consumed by the instruction (1..3). */
  bytes: number[];
  /** Mnemonic in canonical form, e.g. "LDAA", "BRA", "STAA", "???". */
  mnemonic: string;
  /** Already-formatted operand string (e.g. "#$007F", "$F800", "$05,X"). */
  operand: string;
  /** Number of bytes the instruction occupies. */
  length: number;
  /** PC that would follow this instruction (sequentially — not jump target). */
  nextPc: number;
  /** For branches/jumps with a static target, the resolved address. */
  target?: number | undefined;
}

const hex = (n: number, w: number): string => n.toString(16).toUpperCase().padStart(w, "0");

/** Disassemble the instruction at `pc`.  Pure read-only over `bus`. */
export function disassemble(bus: Bus, pc: number): Disassembly {
  const addr = pc & 0xFFFF;
  const op = bus.read(addr);
  const info = MNEMONICS[op];

  if (!info) {
    return {
      address: addr,
      bytes: [op],
      mnemonic: "???",
      operand: `$${hex(op, 2)}`,
      length: 1,
      nextPc: (addr + 1) & 0xFFFF,
      target: undefined,
    };
  }

  switch (info.mode) {
    case "inh": {
      return {
        address: addr, bytes: [op], mnemonic: info.mnemonic, operand: "",
        length: 1, nextPc: (addr + 1) & 0xFFFF, target: undefined,
      };
    }
    case "imm8": {
      const v = bus.read((addr + 1) & 0xFFFF);
      return {
        address: addr, bytes: [op, v], mnemonic: info.mnemonic,
        operand: `#$${hex(v, 2)}`, length: 2,
        nextPc: (addr + 2) & 0xFFFF, target: undefined,
      };
    }
    case "imm16": {
      const hi = bus.read((addr + 1) & 0xFFFF);
      const lo = bus.read((addr + 2) & 0xFFFF);
      const v = (hi << 8) | lo;
      return {
        address: addr, bytes: [op, hi, lo], mnemonic: info.mnemonic,
        operand: `#$${hex(v, 4)}`, length: 3,
        nextPc: (addr + 3) & 0xFFFF, target: undefined,
      };
    }
    case "dir": {
      const a = bus.read((addr + 1) & 0xFFFF);
      return {
        address: addr, bytes: [op, a], mnemonic: info.mnemonic,
        operand: `$${hex(a, 2)}`, length: 2,
        nextPc: (addr + 2) & 0xFFFF, target: a,
      };
    }
    case "ext": {
      const hi = bus.read((addr + 1) & 0xFFFF);
      const lo = bus.read((addr + 2) & 0xFFFF);
      const a = (hi << 8) | lo;
      return {
        address: addr, bytes: [op, hi, lo], mnemonic: info.mnemonic,
        operand: `$${hex(a, 4)}`, length: 3,
        nextPc: (addr + 3) & 0xFFFF, target: a,
      };
    }
    case "idx": {
      const off = bus.read((addr + 1) & 0xFFFF);
      return {
        address: addr, bytes: [op, off], mnemonic: info.mnemonic,
        operand: `$${hex(off, 2)},X`, length: 2,
        nextPc: (addr + 2) & 0xFFFF, target: undefined,
      };
    }
    case "rel": {
      const off = bus.read((addr + 1) & 0xFFFF);
      const signed = off < 0x80 ? off : off - 0x100;
      const target = (addr + 2 + signed) & 0xFFFF;
      return {
        address: addr, bytes: [op, off], mnemonic: info.mnemonic,
        operand: `$${hex(target, 4)}`, length: 2,
        nextPc: (addr + 2) & 0xFFFF, target,
      };
    }
  }
}

/** Format a disassembly result as a single line "F800  8E 00 7F   LDS  #$007F". */
export function formatDisassembly(d: Disassembly): string {
  const bytesCol = d.bytes.map((b) => hex(b, 2)).join(" ").padEnd(8, " ");
  const operand = d.operand;
  const mnem = d.mnemonic.padEnd(4, " ");
  return `${hex(d.address, 4)}  ${bytesCol}  ${mnem}${operand ? " " + operand : ""}`.trimEnd();
}

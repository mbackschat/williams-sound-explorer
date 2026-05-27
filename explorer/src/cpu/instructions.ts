/**
 * 6800 opcode dispatch table.
 *
 * `OPCODES[N]` (N = 0x00..0xFF) is either a handler `(cpu, bus) => cycles`
 * or `undefined` if unimplemented.  Unimplemented opcodes throw from
 * `step()` so gaps are visible immediately.
 *
 * The 6800 encoding is regular enough that addressing mode = low 4 bits and
 * operation family = high 4 bits — but with enough exceptions that a flat
 * table is simpler than any decoder ladder.  Cycle counts come from the
 * Motorola 6800 datasheet.
 *
 * Implementation strategy: shared addressing-mode helpers + the ALU
 * primitives in `alu.ts` keep each opcode handler down to 3–5 lines.
 */
import type { Bus, CPUState } from "./types.ts";
import { readWord, writeWord } from "./types.ts";
import { CCR_BITS, ccrHas, ccrSet, setNZ8, setNZ16 } from "./flags.ts";
import {
  aluAdd, aluAnd, aluAsl, aluAsr, aluCom, aluDec, aluEor, aluInc,
  aluLsr, aluNeg, aluOr, aluRol, aluRor, aluSub, aluTst,
} from "./alu.ts";

export type OpHandler = (cpu: CPUState, bus: Bus) => number;

/** All 256 slots; gaps are intentionally undefined. */
export const OPCODES: (OpHandler | undefined)[] = new Array(256);

// --- addressing-mode helpers ----------------------------------------------

function fetchImm8(cpu: CPUState, bus: Bus): number {
  const v = bus.read(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xFFFF;
  return v;
}

function fetchImm16(cpu: CPUState, bus: Bus): number {
  const hi = bus.read(cpu.pc);
  const lo = bus.read((cpu.pc + 1) & 0xFFFF);
  cpu.pc = (cpu.pc + 2) & 0xFFFF;
  return (hi << 8) | lo;
}

function addrDirect(cpu: CPUState, bus: Bus): number { return fetchImm8(cpu, bus); }
function addrExtended(cpu: CPUState, bus: Bus): number { return fetchImm16(cpu, bus); }
function addrIndexed(cpu: CPUState, bus: Bus): number {
  const off = fetchImm8(cpu, bus);
  return (cpu.x + off) & 0xFFFF;
}

/** Signed 8-bit branch offset, applied to PC AFTER the offset byte was consumed. */
function relBranch(cpu: CPUState, bus: Bus, taken: boolean): number {
  const off = fetchImm8(cpu, bus);
  if (taken) {
    const signed = off < 0x80 ? off : off - 0x100;
    cpu.pc = (cpu.pc + signed) & 0xFFFF;
  }
  return 4; // all relative branches are 4 cycles on the 6800
}

// --- helpers for register-target opcodes ----------------------------------

/** Apply an ALU result to accumulator A. */
function applyToA(cpu: CPUState, r: { result: number; ccr: number }): void {
  cpu.a = r.result; cpu.ccr = r.ccr;
}
/** Apply an ALU result to accumulator B. */
function applyToB(cpu: CPUState, r: { result: number; ccr: number }): void {
  cpu.b = r.result; cpu.ccr = r.ccr;
}

/** Read–modify–write at a memory address with an ALU helper that takes (m, ccr). */
function rmw(
  cpu: CPUState,
  bus: Bus,
  addr: number,
  op: (m: number, ccr: number) => { result: number; ccr: number },
): void {
  const v = bus.read(addr);
  const r = op(v, cpu.ccr);
  bus.write(addr, r.result);
  cpu.ccr = r.ccr;
}

// =================================================================
// 0x00-block — INX, DEX, CLR family, etc.
// =================================================================

OPCODES[0x01] = () => 2; // NOP

/** TAP: A → CCR (preserving reserved bits) */
OPCODES[0x06] = (cpu) => {
  cpu.ccr = (cpu.a & 0x3F) | 0xC0;
  return 2;
};

/** TPA: CCR → A */
OPCODES[0x07] = (cpu) => {
  cpu.a = cpu.ccr & 0xFF;
  return 2;
};

/** INX: X = X + 1; Z set, others unchanged */
OPCODES[0x08] = (cpu) => {
  cpu.x = (cpu.x + 1) & 0xFFFF;
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.Z, cpu.x === 0);
  return 4;
};

/** DEX: X = X - 1; Z set */
OPCODES[0x09] = (cpu) => {
  cpu.x = (cpu.x - 1) & 0xFFFF;
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.Z, cpu.x === 0);
  return 4;
};

OPCODES[0x0A] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false); return 2; }; // CLV
OPCODES[0x0B] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, true);  return 2; }; // SEV
OPCODES[0x0C] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, false); return 2; }; // CLC
OPCODES[0x0D] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, true);  return 2; }; // SEC
OPCODES[0x0E] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.I, false); return 2; }; // CLI
OPCODES[0x0F] = (cpu) => { cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.I, true);  return 2; }; // SEI

/** SBA: A = A - B */
OPCODES[0x10] = (cpu) => { applyToA(cpu, aluSub(cpu.a, cpu.b, 0, cpu.ccr)); return 2; };
/** CBA: A - B, discard result */
OPCODES[0x11] = (cpu) => { cpu.ccr = aluSub(cpu.a, cpu.b, 0, cpu.ccr).ccr; return 2; };
/** TAB: B = A */
OPCODES[0x16] = (cpu) => {
  cpu.b = cpu.a;
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 2;
};
/** TBA: A = B */
OPCODES[0x17] = (cpu) => {
  cpu.a = cpu.b;
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 2;
};
/** ABA: A = A + B */
OPCODES[0x1B] = (cpu) => { applyToA(cpu, aluAdd(cpu.a, cpu.b, 0, cpu.ccr)); return 2; };

// =================================================================
// 0x20-block — branches (relative, all 4 cycles, signed 8-bit offset)
// =================================================================

OPCODES[0x20] = (c, b) => relBranch(c, b, true);                         // BRA
OPCODES[0x22] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.C) && !ccrHas(c.ccr, CCR_BITS.Z)); // BHI: C=0 & Z=0
OPCODES[0x23] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.C) ||  ccrHas(c.ccr, CCR_BITS.Z)); // BLS: C=1 | Z=1
OPCODES[0x24] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.C));   // BCC
OPCODES[0x25] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.C));   // BCS
OPCODES[0x26] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.Z));   // BNE
OPCODES[0x27] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.Z));   // BEQ
OPCODES[0x28] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.V));   // BVC
OPCODES[0x29] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.V));   // BVS
OPCODES[0x2A] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.N));   // BPL
OPCODES[0x2B] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.N));   // BMI
OPCODES[0x2C] = (c, b) => relBranch(c, b, ccrHas(c.ccr, CCR_BITS.N) === ccrHas(c.ccr, CCR_BITS.V)); // BGE
OPCODES[0x2D] = (c, b) => relBranch(c, b, ccrHas(c.ccr, CCR_BITS.N) !== ccrHas(c.ccr, CCR_BITS.V)); // BLT
OPCODES[0x2E] = (c, b) => relBranch(c, b, !ccrHas(c.ccr, CCR_BITS.Z) && (ccrHas(c.ccr, CCR_BITS.N) === ccrHas(c.ccr, CCR_BITS.V))); // BGT
OPCODES[0x2F] = (c, b) => relBranch(c, b,  ccrHas(c.ccr, CCR_BITS.Z) || (ccrHas(c.ccr, CCR_BITS.N) !== ccrHas(c.ccr, CCR_BITS.V))); // BLE

// =================================================================
// 0x30-block — TSX/INS/PSH/PUL/DES/TXS/RTS/RTI/WAI/SWI
// =================================================================

OPCODES[0x30] = (cpu) => { cpu.x = (cpu.sp + 1) & 0xFFFF; return 4; }; // TSX
OPCODES[0x31] = (cpu) => { cpu.sp = (cpu.sp + 1) & 0xFFFF; return 4; }; // INS
OPCODES[0x32] = (cpu, bus) => { // PULA
  cpu.sp = (cpu.sp + 1) & 0xFFFF;
  cpu.a = bus.read(cpu.sp);
  return 4;
};
OPCODES[0x33] = (cpu, bus) => { // PULB
  cpu.sp = (cpu.sp + 1) & 0xFFFF;
  cpu.b = bus.read(cpu.sp);
  return 4;
};
OPCODES[0x34] = (cpu) => { cpu.sp = (cpu.sp - 1) & 0xFFFF; return 4; }; // DES
OPCODES[0x35] = (cpu) => { cpu.sp = (cpu.x - 1) & 0xFFFF; return 4; }; // TXS
OPCODES[0x36] = (cpu, bus) => { // PSHA
  bus.write(cpu.sp, cpu.a);
  cpu.sp = (cpu.sp - 1) & 0xFFFF;
  return 4;
};
OPCODES[0x37] = (cpu, bus) => { // PSHB
  bus.write(cpu.sp, cpu.b);
  cpu.sp = (cpu.sp - 1) & 0xFFFF;
  return 4;
};
OPCODES[0x39] = (cpu, bus) => { // RTS
  cpu.sp = (cpu.sp + 1) & 0xFFFF;
  const hi = bus.read(cpu.sp);
  cpu.sp = (cpu.sp + 1) & 0xFFFF;
  const lo = bus.read(cpu.sp);
  cpu.pc = (hi << 8) | lo;
  return 5;
};
/** RTI: pop CCR, B, A, X, PC (reverse of interrupt push order) */
OPCODES[0x3B] = (cpu, bus) => {
  cpu.sp = (cpu.sp + 1) & 0xFFFF; cpu.ccr = bus.read(cpu.sp) | 0xC0;
  cpu.sp = (cpu.sp + 1) & 0xFFFF; cpu.b = bus.read(cpu.sp);
  cpu.sp = (cpu.sp + 1) & 0xFFFF; cpu.a = bus.read(cpu.sp);
  cpu.sp = (cpu.sp + 1) & 0xFFFF; const xh = bus.read(cpu.sp);
  cpu.sp = (cpu.sp + 1) & 0xFFFF; const xl = bus.read(cpu.sp);
  cpu.x = (xh << 8) | xl;
  cpu.sp = (cpu.sp + 1) & 0xFFFF; const ph = bus.read(cpu.sp);
  cpu.sp = (cpu.sp + 1) & 0xFFFF; const pl = bus.read(cpu.sp);
  cpu.pc = (ph << 8) | pl;
  return 10;
};
/** WAI: stack registers and halt until interrupt */
OPCODES[0x3E] = (cpu, bus) => {
  // Push PC, X, A, B, CCR (same as IRQ vectoring, but no PC fetch)
  bus.write(cpu.sp, cpu.pc & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, (cpu.pc >>> 8) & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, cpu.x & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, (cpu.x >>> 8) & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, cpu.a); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, cpu.b); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, cpu.ccr); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  cpu.waiting = true;
  return 9;
};

// =================================================================
// 0x40-block — Inherent A ops + accumulator-modify
// =================================================================

OPCODES[0x40] = (cpu) => { applyToA(cpu, aluNeg(cpu.a, cpu.ccr)); return 2; }; // NEGA
OPCODES[0x43] = (cpu) => { applyToA(cpu, aluCom(cpu.a, cpu.ccr)); return 2; }; // COMA
OPCODES[0x44] = (cpu) => { applyToA(cpu, aluLsr(cpu.a, cpu.ccr)); return 2; }; // LSRA
OPCODES[0x46] = (cpu) => { applyToA(cpu, aluRor(cpu.a, cpu.ccr)); return 2; }; // RORA
OPCODES[0x47] = (cpu) => { applyToA(cpu, aluAsr(cpu.a, cpu.ccr)); return 2; }; // ASRA
OPCODES[0x48] = (cpu) => { applyToA(cpu, aluAsl(cpu.a, cpu.ccr)); return 2; }; // ASLA
OPCODES[0x49] = (cpu) => { applyToA(cpu, aluRol(cpu.a, cpu.ccr)); return 2; }; // ROLA
OPCODES[0x4A] = (cpu) => { applyToA(cpu, aluDec(cpu.a, cpu.ccr)); return 2; }; // DECA
OPCODES[0x4C] = (cpu) => { applyToA(cpu, aluInc(cpu.a, cpu.ccr)); return 2; }; // INCA
OPCODES[0x4D] = (cpu) => { cpu.ccr = aluTst(cpu.a, cpu.ccr); return 2; };       // TSTA
OPCODES[0x4F] = (cpu) => {
  cpu.a = 0;
  cpu.ccr = setNZ8(cpu.ccr, 0);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, false);
  return 2;
}; // CLRA

// =================================================================
// 0x50-block — Inherent B ops
// =================================================================

OPCODES[0x50] = (cpu) => { applyToB(cpu, aluNeg(cpu.b, cpu.ccr)); return 2; }; // NEGB
OPCODES[0x53] = (cpu) => { applyToB(cpu, aluCom(cpu.b, cpu.ccr)); return 2; }; // COMB
OPCODES[0x54] = (cpu) => { applyToB(cpu, aluLsr(cpu.b, cpu.ccr)); return 2; }; // LSRB
OPCODES[0x56] = (cpu) => { applyToB(cpu, aluRor(cpu.b, cpu.ccr)); return 2; }; // RORB
OPCODES[0x57] = (cpu) => { applyToB(cpu, aluAsr(cpu.b, cpu.ccr)); return 2; }; // ASRB
OPCODES[0x58] = (cpu) => { applyToB(cpu, aluAsl(cpu.b, cpu.ccr)); return 2; }; // ASLB
OPCODES[0x59] = (cpu) => { applyToB(cpu, aluRol(cpu.b, cpu.ccr)); return 2; }; // ROLB
OPCODES[0x5A] = (cpu) => { applyToB(cpu, aluDec(cpu.b, cpu.ccr)); return 2; }; // DECB
OPCODES[0x5C] = (cpu) => { applyToB(cpu, aluInc(cpu.b, cpu.ccr)); return 2; }; // INCB
OPCODES[0x5D] = (cpu) => { cpu.ccr = aluTst(cpu.b, cpu.ccr); return 2; };       // TSTB
OPCODES[0x5F] = (cpu) => {
  cpu.b = 0;
  cpu.ccr = setNZ8(cpu.ccr, 0);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, false);
  return 2;
}; // CLRB

// =================================================================
// 0x60-block — Indexed (mem,X) RMW family
// =================================================================

OPCODES[0x60] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluNeg); return 7; }; // NEG ,X
OPCODES[0x63] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluCom); return 7; }; // COM ,X
OPCODES[0x64] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluLsr); return 7; }; // LSR ,X
OPCODES[0x66] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluRor); return 7; }; // ROR ,X
OPCODES[0x67] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluAsr); return 7; }; // ASR ,X
OPCODES[0x68] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluAsl); return 7; }; // ASL ,X
OPCODES[0x69] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluRol); return 7; }; // ROL ,X
OPCODES[0x6A] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluDec); return 7; }; // DEC ,X
OPCODES[0x6C] = (cpu, bus) => { rmw(cpu, bus, addrIndexed(cpu, bus), aluInc); return 7; }; // INC ,X
OPCODES[0x6D] = (cpu, bus) => { cpu.ccr = aluTst(bus.read(addrIndexed(cpu, bus)), cpu.ccr); return 7; }; // TST ,X
OPCODES[0x6E] = (cpu, bus) => { cpu.pc = addrIndexed(cpu, bus); return 4; }; // JMP ,X
OPCODES[0x6F] = (cpu, bus) => { // CLR ,X
  bus.write(addrIndexed(cpu, bus), 0);
  cpu.ccr = setNZ8(cpu.ccr, 0);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, false);
  return 7;
};

// =================================================================
// 0x70-block — Extended RMW family
// =================================================================

OPCODES[0x70] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluNeg); return 6; }; // NEG ext
OPCODES[0x73] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluCom); return 6; }; // COM ext
OPCODES[0x74] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluLsr); return 6; }; // LSR ext
OPCODES[0x76] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluRor); return 6; }; // ROR ext
OPCODES[0x77] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluAsr); return 6; }; // ASR ext
OPCODES[0x78] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluAsl); return 6; }; // ASL ext
OPCODES[0x79] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluRol); return 6; }; // ROL ext
OPCODES[0x7A] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluDec); return 6; }; // DEC ext
OPCODES[0x7C] = (cpu, bus) => { rmw(cpu, bus, addrExtended(cpu, bus), aluInc); return 6; }; // INC ext
OPCODES[0x7D] = (cpu, bus) => { cpu.ccr = aluTst(bus.read(addrExtended(cpu, bus)), cpu.ccr); return 6; }; // TST ext
OPCODES[0x7E] = (cpu, bus) => { cpu.pc = fetchImm16(cpu, bus); return 3; }; // JMP ext
OPCODES[0x7F] = (cpu, bus) => { // CLR ext
  bus.write(addrExtended(cpu, bus), 0);
  cpu.ccr = setNZ8(cpu.ccr, 0);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.C, false);
  return 6;
};

// =================================================================
// A-accumulator family: 0x80-0xBB
// imm / dir / ext / ind for: SUBA CMPA SBCA ANDA BITA LDAA STAA EORA ADCA ORAA ADDA
// (CMPA and BITA are "no-store" — they affect CCR but not A.)
// =================================================================

// 0x80-block — immediate A
OPCODES[0x80] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, fetchImm8(cpu, bus), 0, cpu.ccr)); return 2; }; // SUBA #
OPCODES[0x81] = (cpu, bus) => { cpu.ccr = aluSub(cpu.a, fetchImm8(cpu, bus), 0, cpu.ccr).ccr; return 2; };   // CMPA #
OPCODES[0x82] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, fetchImm8(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 2; }; // SBCA #
OPCODES[0x84] = (cpu, bus) => { applyToA(cpu, aluAnd(cpu.a, fetchImm8(cpu, bus), cpu.ccr)); return 2; };     // ANDA #
OPCODES[0x85] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.a, fetchImm8(cpu, bus), cpu.ccr).ccr; return 2; };       // BITA #
OPCODES[0x86] = (cpu, bus) => { // LDAA #
  cpu.a = fetchImm8(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 2;
};
OPCODES[0x88] = (cpu, bus) => { applyToA(cpu, aluEor(cpu.a, fetchImm8(cpu, bus), cpu.ccr)); return 2; }; // EORA #
OPCODES[0x89] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, fetchImm8(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 2; }; // ADCA #
OPCODES[0x8A] = (cpu, bus) => { applyToA(cpu, aluOr(cpu.a, fetchImm8(cpu, bus), cpu.ccr)); return 2; };  // ORAA #
OPCODES[0x8B] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, fetchImm8(cpu, bus), 0, cpu.ccr)); return 2; }; // ADDA #
OPCODES[0x8C] = (cpu, bus) => { // CPX #
  const v = fetchImm16(cpu, bus);
  const diff = (cpu.x - v) & 0xFFFF;
  cpu.ccr = setNZ16(cpu.ccr, diff);
  // V is set on signed overflow for 16-bit subtract
  const xs = (cpu.x ^ v) & 0x8000;
  const overflow = xs !== 0 && (((cpu.x ^ diff) & 0x8000) !== 0);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, overflow);
  return 3;
};
OPCODES[0x8D] = (cpu, bus) => { // BSR
  const off = fetchImm8(cpu, bus);
  const signed = off < 0x80 ? off : off - 0x100;
  // push return-PC (low then high — same as JSR)
  bus.write(cpu.sp, cpu.pc & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, (cpu.pc >>> 8) & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  cpu.pc = (cpu.pc + signed) & 0xFFFF;
  return 8;
};
OPCODES[0x8E] = (cpu, bus) => { // LDS #
  cpu.sp = fetchImm16(cpu, bus);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 3;
};

// 0x90-block — direct A
function aDir(cpu: CPUState, bus: Bus): number { return bus.read(addrDirect(cpu, bus)); }
OPCODES[0x90] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aDir(cpu, bus), 0, cpu.ccr)); return 3; };
OPCODES[0x91] = (cpu, bus) => { cpu.ccr = aluSub(cpu.a, aDir(cpu, bus), 0, cpu.ccr).ccr; return 3; };
OPCODES[0x92] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aDir(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 3; };
OPCODES[0x94] = (cpu, bus) => { applyToA(cpu, aluAnd(cpu.a, aDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0x95] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.a, aDir(cpu, bus), cpu.ccr).ccr; return 3; };
OPCODES[0x96] = (cpu, bus) => {
  cpu.a = aDir(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 3;
};
OPCODES[0x97] = (cpu, bus) => { // STAA direct
  bus.write(addrDirect(cpu, bus), cpu.a);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0x98] = (cpu, bus) => { applyToA(cpu, aluEor(cpu.a, aDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0x99] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aDir(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 3; };
OPCODES[0x9A] = (cpu, bus) => { applyToA(cpu, aluOr(cpu.a, aDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0x9B] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aDir(cpu, bus), 0, cpu.ccr)); return 3; };
OPCODES[0x9C] = (cpu, bus) => { // CPX direct
  const addr = addrDirect(cpu, bus);
  const v = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  const diff = (cpu.x - v) & 0xFFFF;
  cpu.ccr = setNZ16(cpu.ccr, diff);
  return 4;
};
OPCODES[0x9E] = (cpu, bus) => { // LDS direct
  const addr = addrDirect(cpu, bus);
  cpu.sp = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0x9F] = (cpu, bus) => { // STS direct
  writeWord(bus, addrDirect(cpu, bus), cpu.sp);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};

// 0xA0-block — indexed A
function aInd(cpu: CPUState, bus: Bus): number { return bus.read(addrIndexed(cpu, bus)); }
OPCODES[0xA0] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aInd(cpu, bus), 0, cpu.ccr)); return 5; };
OPCODES[0xA1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.a, aInd(cpu, bus), 0, cpu.ccr).ccr; return 5; };
OPCODES[0xA2] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aInd(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 5; };
OPCODES[0xA4] = (cpu, bus) => { applyToA(cpu, aluAnd(cpu.a, aInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xA5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.a, aInd(cpu, bus), cpu.ccr).ccr; return 5; };
OPCODES[0xA6] = (cpu, bus) => {
  cpu.a = aInd(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xA7] = (cpu, bus) => { // STAA indexed
  bus.write(addrIndexed(cpu, bus), cpu.a);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};
OPCODES[0xA8] = (cpu, bus) => { applyToA(cpu, aluEor(cpu.a, aInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xA9] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aInd(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 5; };
OPCODES[0xAA] = (cpu, bus) => { applyToA(cpu, aluOr(cpu.a, aInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xAB] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aInd(cpu, bus), 0, cpu.ccr)); return 5; };
OPCODES[0xAC] = (cpu, bus) => { // CPX indexed
  const addr = addrIndexed(cpu, bus);
  const v = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  const diff = (cpu.x - v) & 0xFFFF;
  cpu.ccr = setNZ16(cpu.ccr, diff);
  return 6;
};
OPCODES[0xAD] = (cpu, bus) => { // JSR ,X
  const target = addrIndexed(cpu, bus);
  bus.write(cpu.sp, cpu.pc & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, (cpu.pc >>> 8) & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  cpu.pc = target;
  return 8;
};
OPCODES[0xAE] = (cpu, bus) => { // LDS indexed
  const addr = addrIndexed(cpu, bus);
  cpu.sp = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};
OPCODES[0xAF] = (cpu, bus) => { // STS indexed
  writeWord(bus, addrIndexed(cpu, bus), cpu.sp);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 7;
};

// 0xB0-block — extended A
function aExt(cpu: CPUState, bus: Bus): number { return bus.read(addrExtended(cpu, bus)); }
OPCODES[0xB0] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aExt(cpu, bus), 0, cpu.ccr)); return 4; };
OPCODES[0xB1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.a, aExt(cpu, bus), 0, cpu.ccr).ccr; return 4; };
OPCODES[0xB2] = (cpu, bus) => { applyToA(cpu, aluSub(cpu.a, aExt(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 4; };
OPCODES[0xB4] = (cpu, bus) => { applyToA(cpu, aluAnd(cpu.a, aExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xB5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.a, aExt(cpu, bus), cpu.ccr).ccr; return 4; };
OPCODES[0xB6] = (cpu, bus) => {
  cpu.a = aExt(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0xB7] = (cpu, bus) => { // STAA ext
  bus.write(addrExtended(cpu, bus), cpu.a);
  cpu.ccr = setNZ8(cpu.ccr, cpu.a);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xB8] = (cpu, bus) => { applyToA(cpu, aluEor(cpu.a, aExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xB9] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aExt(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 4; };
OPCODES[0xBA] = (cpu, bus) => { applyToA(cpu, aluOr(cpu.a, aExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xBB] = (cpu, bus) => { applyToA(cpu, aluAdd(cpu.a, aExt(cpu, bus), 0, cpu.ccr)); return 4; };
OPCODES[0xBC] = (cpu, bus) => { // CPX ext
  const addr = addrExtended(cpu, bus);
  const v = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  const diff = (cpu.x - v) & 0xFFFF;
  cpu.ccr = setNZ16(cpu.ccr, diff);
  return 5;
};
OPCODES[0xBD] = (cpu, bus) => { // JSR ext
  const target = fetchImm16(cpu, bus);
  bus.write(cpu.sp, cpu.pc & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  bus.write(cpu.sp, (cpu.pc >>> 8) & 0xFF); cpu.sp = (cpu.sp - 1) & 0xFFFF;
  cpu.pc = target;
  return 9;
};
OPCODES[0xBE] = (cpu, bus) => { // LDS ext
  const addr = addrExtended(cpu, bus);
  cpu.sp = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xBF] = (cpu, bus) => { // STS ext
  writeWord(bus, addrExtended(cpu, bus), cpu.sp);
  cpu.ccr = setNZ16(cpu.ccr, cpu.sp);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};

// =================================================================
// B-accumulator family: 0xC0-0xFF (same as A-family with B target and X-loads)
// =================================================================

// 0xC0-block — immediate B
OPCODES[0xC0] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, fetchImm8(cpu, bus), 0, cpu.ccr)); return 2; };
OPCODES[0xC1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.b, fetchImm8(cpu, bus), 0, cpu.ccr).ccr; return 2; };
OPCODES[0xC2] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, fetchImm8(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 2; };
OPCODES[0xC4] = (cpu, bus) => { applyToB(cpu, aluAnd(cpu.b, fetchImm8(cpu, bus), cpu.ccr)); return 2; };
OPCODES[0xC5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.b, fetchImm8(cpu, bus), cpu.ccr).ccr; return 2; };
OPCODES[0xC6] = (cpu, bus) => {
  cpu.b = fetchImm8(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 2;
};
OPCODES[0xC8] = (cpu, bus) => { applyToB(cpu, aluEor(cpu.b, fetchImm8(cpu, bus), cpu.ccr)); return 2; };
OPCODES[0xC9] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, fetchImm8(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 2; };
OPCODES[0xCA] = (cpu, bus) => { applyToB(cpu, aluOr(cpu.b, fetchImm8(cpu, bus), cpu.ccr)); return 2; };
OPCODES[0xCB] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, fetchImm8(cpu, bus), 0, cpu.ccr)); return 2; };
OPCODES[0xCE] = (cpu, bus) => { // LDX #
  cpu.x = fetchImm16(cpu, bus);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 3;
};

// 0xD0-block — direct B
function bDir(cpu: CPUState, bus: Bus): number { return bus.read(addrDirect(cpu, bus)); }
OPCODES[0xD0] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bDir(cpu, bus), 0, cpu.ccr)); return 3; };
OPCODES[0xD1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.b, bDir(cpu, bus), 0, cpu.ccr).ccr; return 3; };
OPCODES[0xD2] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bDir(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 3; };
OPCODES[0xD4] = (cpu, bus) => { applyToB(cpu, aluAnd(cpu.b, bDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0xD5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.b, bDir(cpu, bus), cpu.ccr).ccr; return 3; };
OPCODES[0xD6] = (cpu, bus) => {
  cpu.b = bDir(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 3;
};
OPCODES[0xD7] = (cpu, bus) => { // STAB direct
  bus.write(addrDirect(cpu, bus), cpu.b);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0xD8] = (cpu, bus) => { applyToB(cpu, aluEor(cpu.b, bDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0xD9] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bDir(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 3; };
OPCODES[0xDA] = (cpu, bus) => { applyToB(cpu, aluOr(cpu.b, bDir(cpu, bus), cpu.ccr)); return 3; };
OPCODES[0xDB] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bDir(cpu, bus), 0, cpu.ccr)); return 3; };
OPCODES[0xDE] = (cpu, bus) => { // LDX direct
  const addr = addrDirect(cpu, bus);
  cpu.x = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0xDF] = (cpu, bus) => { // STX direct
  writeWord(bus, addrDirect(cpu, bus), cpu.x);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};

// 0xE0-block — indexed B
function bInd(cpu: CPUState, bus: Bus): number { return bus.read(addrIndexed(cpu, bus)); }
OPCODES[0xE0] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bInd(cpu, bus), 0, cpu.ccr)); return 5; };
OPCODES[0xE1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.b, bInd(cpu, bus), 0, cpu.ccr).ccr; return 5; };
OPCODES[0xE2] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bInd(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 5; };
OPCODES[0xE4] = (cpu, bus) => { applyToB(cpu, aluAnd(cpu.b, bInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xE5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.b, bInd(cpu, bus), cpu.ccr).ccr; return 5; };
OPCODES[0xE6] = (cpu, bus) => {
  cpu.b = bInd(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xE7] = (cpu, bus) => { // STAB indexed
  bus.write(addrIndexed(cpu, bus), cpu.b);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};
OPCODES[0xE8] = (cpu, bus) => { applyToB(cpu, aluEor(cpu.b, bInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xE9] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bInd(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 5; };
OPCODES[0xEA] = (cpu, bus) => { applyToB(cpu, aluOr(cpu.b, bInd(cpu, bus), cpu.ccr)); return 5; };
OPCODES[0xEB] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bInd(cpu, bus), 0, cpu.ccr)); return 5; };
OPCODES[0xEE] = (cpu, bus) => { // LDX indexed
  const addr = addrIndexed(cpu, bus);
  cpu.x = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};
OPCODES[0xEF] = (cpu, bus) => { // STX indexed
  writeWord(bus, addrIndexed(cpu, bus), cpu.x);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 7;
};

// 0xF0-block — extended B
function bExt(cpu: CPUState, bus: Bus): number { return bus.read(addrExtended(cpu, bus)); }
OPCODES[0xF0] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bExt(cpu, bus), 0, cpu.ccr)); return 4; };
OPCODES[0xF1] = (cpu, bus) => { cpu.ccr = aluSub(cpu.b, bExt(cpu, bus), 0, cpu.ccr).ccr; return 4; };
OPCODES[0xF2] = (cpu, bus) => { applyToB(cpu, aluSub(cpu.b, bExt(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 4; };
OPCODES[0xF4] = (cpu, bus) => { applyToB(cpu, aluAnd(cpu.b, bExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xF5] = (cpu, bus) => { cpu.ccr = aluAnd(cpu.b, bExt(cpu, bus), cpu.ccr).ccr; return 4; };
OPCODES[0xF6] = (cpu, bus) => {
  cpu.b = bExt(cpu, bus);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 4;
};
OPCODES[0xF7] = (cpu, bus) => { // STAB ext
  bus.write(addrExtended(cpu, bus), cpu.b);
  cpu.ccr = setNZ8(cpu.ccr, cpu.b);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xF8] = (cpu, bus) => { applyToB(cpu, aluEor(cpu.b, bExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xF9] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bExt(cpu, bus), ccrHas(cpu.ccr, CCR_BITS.C) ? 1 : 0, cpu.ccr)); return 4; };
OPCODES[0xFA] = (cpu, bus) => { applyToB(cpu, aluOr(cpu.b, bExt(cpu, bus), cpu.ccr)); return 4; };
OPCODES[0xFB] = (cpu, bus) => { applyToB(cpu, aluAdd(cpu.b, bExt(cpu, bus), 0, cpu.ccr)); return 4; };
OPCODES[0xFE] = (cpu, bus) => { // LDX ext
  const addr = addrExtended(cpu, bus);
  cpu.x = (bus.read(addr) << 8) | bus.read((addr + 1) & 0xFFFF);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 5;
};
OPCODES[0xFF] = (cpu, bus) => { // STX ext
  writeWord(bus, addrExtended(cpu, bus), cpu.x);
  cpu.ccr = setNZ16(cpu.ccr, cpu.x);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.V, false);
  return 6;
};

export { readWord, writeWord };

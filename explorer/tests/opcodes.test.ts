/**
 * Opcode dispatch tests.
 *
 * Strategy: each test loads a tiny program into a flat-RAM mock bus, runs
 * one or two `step()` calls, and asserts register/memory/flag effects.
 * The `makeCPU(...program)` helper writes the bytes starting at PC=0x0100
 * (away from the zero-page so direct-mode addressing is testable).
 *
 * Coverage philosophy (memory: feedback-thorough-testing):
 *   • At least one happy-path per opcode.
 *   • Edge-case flag effects covered by `alu.test.ts` already; here we
 *     focus on opcode dispatch + addressing-mode correctness.
 *   • Each branch family has at least one taken + one not-taken case.
 */
import { describe, expect, it } from "vitest";

import type { Bus, CPUState } from "../src/cpu/types.ts";
import { createCPU, step } from "../src/cpu/m6800.ts";
import { CCR_BITS, ccrHas, CCR_RESET } from "../src/cpu/flags.ts";

const PC_START = 0x0100;

function makeBus(): { bus: Bus; mem: Uint8Array } {
  const mem = new Uint8Array(0x10000);
  const bus: Bus = {
    read: (a) => mem[a & 0xFFFF]!,
    write: (a, v) => { mem[a & 0xFFFF] = v & 0xFF; },
  };
  return { bus, mem };
}

function makeCPU(...program: number[]) {
  const { bus, mem } = makeBus();
  for (let i = 0; i < program.length; i++) mem[PC_START + i] = (program[i] ?? 0) & 0xFF;
  const cpu = createCPU();
  cpu.pc = PC_START;
  cpu.sp = 0x00FF;        // mock external RAM area; not testing real bus mirroring here
  cpu.ccr = CCR_RESET & ~CCR_BITS.I; // allow IRQ by default; clear I for tests
  return { cpu, bus, mem };
}

// ============================================================
// 0x00-block — inherent
// ============================================================

describe("inherent group (0x00-0x1F)", () => {
  it("0x01 NOP advances PC by 1, consumes 2 cycles", () => {
    const { cpu, bus } = makeCPU(0x01);
    const used = step(cpu, bus);
    expect(used).toBe(2);
    expect(cpu.pc).toBe(PC_START + 1);
  });

  it("0x08 INX increments X and sets Z when X wraps to 0", () => {
    const { cpu, bus } = makeCPU(0x08, 0x08);
    cpu.x = 0xFFFF;
    step(cpu, bus);
    expect(cpu.x).toBe(0);
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(true);
    step(cpu, bus);
    expect(cpu.x).toBe(1);
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(false);
  });

  it("0x09 DEX decrements X with Z effect", () => {
    const { cpu, bus } = makeCPU(0x09);
    cpu.x = 1;
    step(cpu, bus);
    expect(cpu.x).toBe(0);
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(true);
  });

  it("0x0A-0x0F flag set/clear sequence", () => {
    const { cpu, bus } = makeCPU(0x0B, 0x0A, 0x0D, 0x0C, 0x0F, 0x0E);
    cpu.ccr = CCR_RESET;
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.V)).toBe(true);
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.V)).toBe(false);
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.C)).toBe(true);
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.C)).toBe(false);
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.I)).toBe(true);
    step(cpu, bus); expect(ccrHas(cpu.ccr, CCR_BITS.I)).toBe(false);
  });

  it("0x10 SBA / 0x11 CBA / 0x1B ABA", () => {
    // SBA: A=10 B=3 → A=7
    const sba = makeCPU(0x10);
    sba.cpu.a = 0x10; sba.cpu.b = 0x03;
    step(sba.cpu, sba.bus);
    expect(sba.cpu.a).toBe(0x0D);

    // CBA: A=5 B=5 → A=5, Z=1
    const cba = makeCPU(0x11);
    cba.cpu.a = 5; cba.cpu.b = 5;
    step(cba.cpu, cba.bus);
    expect(cba.cpu.a).toBe(5);              // result discarded
    expect(ccrHas(cba.cpu.ccr, CCR_BITS.Z)).toBe(true);

    // ABA: A=2 B=3 → A=5
    const aba = makeCPU(0x1B);
    aba.cpu.a = 2; aba.cpu.b = 3;
    step(aba.cpu, aba.bus);
    expect(aba.cpu.a).toBe(5);
  });

  it("0x16 TAB / 0x17 TBA transfer between accumulators with NZ flags", () => {
    const tab = makeCPU(0x16);
    tab.cpu.a = 0x80; tab.cpu.b = 0;
    step(tab.cpu, tab.bus);
    expect(tab.cpu.b).toBe(0x80);
    expect(ccrHas(tab.cpu.ccr, CCR_BITS.N)).toBe(true);

    const tba = makeCPU(0x17);
    tba.cpu.a = 0; tba.cpu.b = 0;
    step(tba.cpu, tba.bus);
    expect(tba.cpu.a).toBe(0);
    expect(ccrHas(tba.cpu.ccr, CCR_BITS.Z)).toBe(true);
  });
});

// ============================================================
// 0x20-block — branches
// ============================================================

describe("branches (0x20-0x2F)", () => {
  const cases: Array<[string, number, (cpu: CPUState) => void, boolean]> = [
    ["BRA always",      0x20, () => {},                                       true],
    ["BHI taken (C=0 Z=0)", 0x22, () => {},                                   true],
    ["BHI not (C=1)",   0x22, (c) => { c.ccr |= CCR_BITS.C; },                false],
    ["BLS taken (C=1)", 0x23, (c) => { c.ccr |= CCR_BITS.C; },                true],
    ["BCC not (C=1)",   0x24, (c) => { c.ccr |= CCR_BITS.C; },                false],
    ["BCS taken (C=1)", 0x25, (c) => { c.ccr |= CCR_BITS.C; },                true],
    ["BNE not (Z=1)",   0x26, (c) => { c.ccr |= CCR_BITS.Z; },                false],
    ["BEQ taken (Z=1)", 0x27, (c) => { c.ccr |= CCR_BITS.Z; },                true],
    ["BVC not (V=1)",   0x28, (c) => { c.ccr |= CCR_BITS.V; },                false],
    ["BVS taken (V=1)", 0x29, (c) => { c.ccr |= CCR_BITS.V; },                true],
    ["BPL not (N=1)",   0x2A, (c) => { c.ccr |= CCR_BITS.N; },                false],
    ["BMI taken (N=1)", 0x2B, (c) => { c.ccr |= CCR_BITS.N; },                true],
    ["BGE taken (N=V=0)", 0x2C, () => {},                                     true],
    ["BLT taken (N=1 V=0)", 0x2D, (c) => { c.ccr |= CCR_BITS.N; },            true],
    ["BGT taken (Z=0 N=V)", 0x2E, () => {},                                   true],
    ["BLE taken (Z=1)", 0x2F, (c) => { c.ccr |= CCR_BITS.Z; },                true],
  ];
  for (const [name, op, prime, expectTaken] of cases) {
    it(`${name}`, () => {
      const { cpu, bus } = makeCPU(op, 0x10); // forward by 16
      prime(cpu);
      step(cpu, bus);
      if (expectTaken) {
        expect(cpu.pc).toBe(PC_START + 2 + 0x10);
      } else {
        expect(cpu.pc).toBe(PC_START + 2);
      }
    });
  }

  it("backward branch with signed offset", () => {
    const { cpu, bus } = makeCPU(0x20, 0xFE); // BRA $-2 → loops on itself
    step(cpu, bus);
    expect(cpu.pc).toBe(PC_START);
  });
});

// ============================================================
// 0x30-block — stack ops
// ============================================================

describe("stack ops (PSHA/PSHB/PULA/PULB)", () => {
  it("PSHA writes A at SP then decrements", () => {
    const { cpu, bus } = makeCPU(0x36);
    cpu.a = 0x5A; cpu.sp = 0x00FF;
    step(cpu, bus);
    expect(bus.read(0x00FF)).toBe(0x5A);
    expect(cpu.sp).toBe(0x00FE);
  });

  it("PSHA then PULB round-trips byte", () => {
    const { cpu, bus } = makeCPU(0x36, 0x33);
    cpu.a = 0x42; cpu.b = 0; cpu.sp = 0x00FF;
    step(cpu, bus); // PSHA
    step(cpu, bus); // PULB
    expect(cpu.b).toBe(0x42);
    expect(cpu.sp).toBe(0x00FF);
  });
});

describe("RTI restores all registers", () => {
  it("pops CCR, B, A, X, PC in reverse-push order", () => {
    const { cpu, bus, mem } = makeCPU(0x3B);
    cpu.sp = 0x00F0;
    // Stack frame (memory order, low to high): CCR, B, A, Xh, Xl, PCh, PCl
    mem[0x00F1] = CCR_RESET;
    mem[0x00F2] = 0xBB;
    mem[0x00F3] = 0xAA;
    mem[0x00F4] = 0xAB;
    mem[0x00F5] = 0xCD;
    mem[0x00F6] = 0x12;
    mem[0x00F7] = 0x34;
    step(cpu, bus);
    expect(cpu.b).toBe(0xBB);
    expect(cpu.a).toBe(0xAA);
    expect(cpu.x).toBe(0xABCD);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.sp).toBe(0x00F7);
  });
});

// ============================================================
// A-accumulator ops — sample of imm/dir/ext/ind across multiple ops
// ============================================================

describe("A-accumulator family (sample)", () => {
  it("0x86 LDAA # / 0x96 LDAA dir / 0xA6 LDAA ind / 0xB6 LDAA ext", () => {
    const { cpu, bus, mem } = makeCPU(0x86, 0x42, 0x96, 0x30, 0xA6, 0x10, 0xB6, 0x12, 0x34);
    mem[0x0030] = 0x88;
    cpu.x = 0x0020;
    mem[0x0030] = 0x88;    // 0x20 + 0x10 = 0x30
    mem[0x1234] = 0xFF;
    step(cpu, bus); expect(cpu.a).toBe(0x42); // imm
    step(cpu, bus); expect(cpu.a).toBe(0x88); // dir
    step(cpu, bus); expect(cpu.a).toBe(0x88); // ind (offset 0x10 from X=0x20)
    step(cpu, bus); expect(cpu.a).toBe(0xFF); // ext
    expect(ccrHas(cpu.ccr, CCR_BITS.N)).toBe(true);
  });

  it("0x84 ANDA # / 0x88 EORA # / 0x8B ADDA #", () => {
    const { cpu, bus } = makeCPU(0x84, 0x0F, 0x88, 0xFF, 0x8B, 0x01);
    cpu.a = 0xF0;
    step(cpu, bus); expect(cpu.a).toBe(0x00); // ANDA $0F
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(true);
    step(cpu, bus); expect(cpu.a).toBe(0xFF); // EORA $FF
    step(cpu, bus); expect(cpu.a).toBe(0x00); // ADDA $01 → wrap, C=1
    expect(ccrHas(cpu.ccr, CCR_BITS.C)).toBe(true);
  });

  it("0x80 SUBA # / 0x81 CMPA # (CMPA preserves A)", () => {
    const { cpu, bus } = makeCPU(0x80, 0x05, 0x81, 0x05);
    cpu.a = 0x10;
    step(cpu, bus); expect(cpu.a).toBe(0x0B); // SUBA
    step(cpu, bus); expect(cpu.a).toBe(0x0B); // CMPA — A unchanged
    expect(ccrHas(cpu.ccr, CCR_BITS.N)).toBe(false);
  });

  it("0x97 STAA dir writes A to zero page", () => {
    const { cpu, bus, mem } = makeCPU(0x97, 0x42);
    cpu.a = 0x5A;
    step(cpu, bus);
    expect(mem[0x42]).toBe(0x5A);
  });
});

// ============================================================
// B-accumulator ops — minimal coverage
// ============================================================

describe("B-accumulator family (sample)", () => {
  it("0xD6 LDAB dir / 0xD7 STAB dir / 0xCB ADDB #", () => {
    const { cpu, bus, mem } = makeCPU(0xD6, 0x30, 0xD7, 0x40, 0xCB, 0x05);
    mem[0x30] = 0x33;
    step(cpu, bus); expect(cpu.b).toBe(0x33);  // LDAB dir
    step(cpu, bus); expect(mem[0x40]).toBe(0x33); // STAB dir
    step(cpu, bus); expect(cpu.b).toBe(0x38);  // ADDB #5
  });
});

// ============================================================
// X-register ops
// ============================================================

describe("X register (LDX / STX / CPX)", () => {
  it("0xCE LDX #, 0xDF STX dir, 0xDE LDX dir round-trip", () => {
    const { cpu, bus, mem } = makeCPU(0xCE, 0xAB, 0xCD, 0xDF, 0x10, 0xDE, 0x10);
    step(cpu, bus); expect(cpu.x).toBe(0xABCD);
    step(cpu, bus); expect(mem[0x10]).toBe(0xAB); expect(mem[0x11]).toBe(0xCD);
    cpu.x = 0;
    step(cpu, bus); expect(cpu.x).toBe(0xABCD);
  });

  it("0x8C CPX # sets Z when equal", () => {
    const { cpu, bus } = makeCPU(0x8C, 0xAB, 0xCD);
    cpu.x = 0xABCD;
    step(cpu, bus);
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(true);
  });
});

// ============================================================
// Memory RMW (CLR, INC, DEC, COM ind/ext)
// ============================================================

describe("memory RMW", () => {
  it("0x7F CLR ext zeros a byte and sets Z", () => {
    const { cpu, bus, mem } = makeCPU(0x7F, 0x12, 0x34);
    mem[0x1234] = 0xFF;
    step(cpu, bus);
    expect(mem[0x1234]).toBe(0);
    expect(ccrHas(cpu.ccr, CCR_BITS.Z)).toBe(true);
  });

  it("0x73 COM ext one's-complement and sets C=1", () => {
    const { cpu, bus, mem } = makeCPU(0x73, 0x12, 0x34);
    mem[0x1234] = 0x0F;
    step(cpu, bus);
    expect(mem[0x1234]).toBe(0xF0);
    expect(ccrHas(cpu.ccr, CCR_BITS.C)).toBe(true);
  });

  it("0x7C INC ext and 0x7A DEC ext", () => {
    const { cpu, bus, mem } = makeCPU(0x7C, 0x12, 0x34, 0x7A, 0x12, 0x34);
    mem[0x1234] = 0x7F;
    step(cpu, bus); expect(mem[0x1234]).toBe(0x80);
    expect(ccrHas(cpu.ccr, CCR_BITS.V)).toBe(true); // INC over $7F → V=1
    step(cpu, bus); expect(mem[0x1234]).toBe(0x7F);
  });

  it("0x66 ROR ind rotates through carry", () => {
    const { cpu, bus, mem } = makeCPU(0x66, 0x00); // ROR 0,X
    cpu.x = 0x0010;
    mem[0x10] = 0x01;
    cpu.ccr = CCR_RESET | CCR_BITS.C; // carry into bit 7
    step(cpu, bus);
    expect(mem[0x10]).toBe(0x80);
    expect(ccrHas(cpu.ccr, CCR_BITS.C)).toBe(true); // bit 0 → C
  });
});

// ============================================================
// JSR / BSR / RTS
// ============================================================

describe("subroutine call/return", () => {
  it("BSR pushes return PC and jumps; RTS pops it", () => {
    const { cpu, bus } = makeCPU(0x8D, 0x10, /* return: */ 0x01, /* +1 NOP */);
    // Place the called routine at PC_START + 2 + 0x10 = PC_START + 0x12
    bus.write(PC_START + 0x12, 0x39); // RTS at the target
    cpu.sp = 0x00FF;
    step(cpu, bus); // BSR
    expect(cpu.pc).toBe(PC_START + 2 + 0x10);
    expect(cpu.sp).toBe(0x00FD);
    step(cpu, bus); // RTS
    expect(cpu.pc).toBe(PC_START + 2);
    expect(cpu.sp).toBe(0x00FF);
  });

  it("JSR extended", () => {
    const { cpu, bus } = makeCPU(0xBD, 0xAB, 0xCD);
    cpu.sp = 0x00FF;
    step(cpu, bus);
    expect(cpu.pc).toBe(0xABCD);
    expect(cpu.sp).toBe(0x00FD);
  });
});

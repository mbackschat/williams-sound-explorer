/**
 * 6800 disassembler tests.
 *
 * Cover each addressing-mode formatting separately + a few specific opcodes
 * that the LITE / SETUP paths actually hit (the Williams sound IRQ handler
 * starts with `LDS #$007F`, so we explicitly test that one).
 *
 * The disassembler is pure — we test it against a tiny in-memory bus that
 * simply returns whatever bytes we wrote to it.
 */
import { describe, expect, it } from "vitest";
import type { Bus } from "../src/cpu/types.ts";
import { disassemble, formatDisassembly } from "../src/cpu/disasm.ts";

function memBus(bytes: Record<number, number>): Bus {
  return {
    read: (addr: number) => bytes[addr & 0xFFFF] ?? 0,
    write: () => {},
  };
}

describe("disassembler — addressing modes", () => {
  it("inherent: single-byte opcode", () => {
    const d = disassemble(memBus({ 0x100: 0x01 }), 0x100);
    expect(d.mnemonic).toBe("NOP");
    expect(d.length).toBe(1);
    expect(d.bytes).toEqual([0x01]);
    expect(d.operand).toBe("");
    expect(d.nextPc).toBe(0x101);
  });

  it("imm8: 1-byte immediate (LDAA #$42)", () => {
    const d = disassemble(memBus({ 0x100: 0x86, 0x101: 0x42 }), 0x100);
    expect(d.mnemonic).toBe("LDAA");
    expect(d.operand).toBe("#$42");
    expect(d.length).toBe(2);
    expect(d.bytes).toEqual([0x86, 0x42]);
    expect(d.nextPc).toBe(0x102);
  });

  it("imm16: 2-byte immediate (LDS #$007F)", () => {
    const d = disassemble(memBus({ 0x100: 0x8E, 0x101: 0x00, 0x102: 0x7F }), 0x100);
    expect(d.mnemonic).toBe("LDS");
    expect(d.operand).toBe("#$007F");
    expect(d.length).toBe(3);
    expect(d.bytes).toEqual([0x8E, 0x00, 0x7F]);
    expect(d.nextPc).toBe(0x103);
  });

  it("dir: 1-byte direct (STAA $04)", () => {
    const d = disassemble(memBus({ 0x100: 0x97, 0x101: 0x04 }), 0x100);
    expect(d.mnemonic).toBe("STAA");
    expect(d.operand).toBe("$04");
    expect(d.length).toBe(2);
    expect(d.target).toBe(0x04);
  });

  it("ext: 2-byte extended (STAA $0400)", () => {
    const d = disassemble(memBus({ 0x100: 0xB7, 0x101: 0x04, 0x102: 0x00 }), 0x100);
    expect(d.mnemonic).toBe("STAA");
    expect(d.operand).toBe("$0400");
    expect(d.length).toBe(3);
    expect(d.target).toBe(0x0400);
    expect(d.nextPc).toBe(0x103);
  });

  it("idx: 1-byte indexed (LDAA $05,X)", () => {
    const d = disassemble(memBus({ 0x100: 0xA6, 0x101: 0x05 }), 0x100);
    expect(d.mnemonic).toBe("LDAA");
    expect(d.operand).toBe("$05,X");
    expect(d.length).toBe(2);
  });

  it("rel: forward branch (BRA $+5) resolves the target", () => {
    // BRA = 0x20, offset = 0x03 → target = 0x100 + 2 + 3 = 0x105
    const d = disassemble(memBus({ 0x100: 0x20, 0x101: 0x03 }), 0x100);
    expect(d.mnemonic).toBe("BRA");
    expect(d.operand).toBe("$0105");
    expect(d.target).toBe(0x105);
    expect(d.length).toBe(2);
  });

  it("rel: backward branch (BNE $-3) sign-extends correctly", () => {
    // BNE = 0x26, offset = 0xFD = -3 signed → target = 0x100 + 2 - 3 = 0xFF
    const d = disassemble(memBus({ 0x100: 0x26, 0x101: 0xFD }), 0x100);
    expect(d.mnemonic).toBe("BNE");
    expect(d.target).toBe(0xFF);
    expect(d.operand).toBe("$00FF");
  });
});

describe("disassembler — known LITE-path opcodes", () => {
  it("0x3B = RTI", () => {
    expect(disassemble(memBus({ 0: 0x3B }), 0).mnemonic).toBe("RTI");
  });
  it("0x7E ext = JMP", () => {
    const d = disassemble(memBus({ 0: 0x7E, 1: 0xF8, 2: 0x00 }), 0);
    expect(d.mnemonic).toBe("JMP");
    expect(d.operand).toBe("$F800");
  });
  it("0xBD ext = JSR", () => {
    const d = disassemble(memBus({ 0: 0xBD, 1: 0xF9, 2: 0x12 }), 0);
    expect(d.mnemonic).toBe("JSR");
    expect(d.operand).toBe("$F912");
  });
  it("0x8D = BSR (relative)", () => {
    const d = disassemble(memBus({ 0x100: 0x8D, 0x101: 0x10 }), 0x100);
    expect(d.mnemonic).toBe("BSR");
    expect(d.target).toBe(0x112);
  });
});

describe("disassembler — unknown opcode is graceful", () => {
  it("unimplemented byte yields ??? with length 1 so caller can advance", () => {
    const d = disassemble(memBus({ 0: 0x42 }), 0);
    expect(d.mnemonic).toBe("???");
    expect(d.length).toBe(1);
    expect(d.bytes).toEqual([0x42]);
    expect(d.operand).toBe("$42");
  });
});

describe("disassembler — formatter", () => {
  it("aligns columns: 4-char address, 8-char bytes, 4-char mnemonic", () => {
    const d = disassemble(memBus({ 0xF800: 0x8E, 0xF801: 0x00, 0xF802: 0x7F }), 0xF800);
    expect(formatDisassembly(d)).toBe("F800  8E 00 7F  LDS  #$007F");
  });
  it("inherent prints without operand spacing", () => {
    const d = disassemble(memBus({ 0xF800: 0x01 }), 0xF800);
    expect(formatDisassembly(d)).toBe("F800  01        NOP");
  });
});

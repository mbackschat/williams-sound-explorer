/**
 * Step 1.1 verification — PIA CA1-IRQ delivery into the CPU.
 *
 * The test plan covers four families of assertions, per the project's
 * "test thoroughly" convention (memory: feedback-thorough-testing):
 *
 *   A. Happy path: command fires → CPU vectors → stack frame correct
 *   B. Stack-frame invariants: byte order, SP arithmetic, CCR I-flag
 *   C. Negative: I-mask blocks delivery, no re-fire without a fresh command
 *   D. Re-fire: a second command vectors again
 *
 * The Defender SETUP routine ends at a `BRA *` self-branch ($F801 → ...).
 * We boot to that idle, then exercise the IRQ path.
 */
import { describe, expect, it } from "vitest";

import { createCPU, reset, step } from "../src/cpu/m6800.ts";
import { CCR_BITS, ccrHas } from "../src/cpu/flags.ts";
import { SoundBoard, type GameKind } from "../src/board/soundboard.ts";
import { loadROM } from "../src/board/rom.ts";
import { tick } from "../src/runner.ts";

/** Boot a fresh sound board to the BRA-self idle loop and return the live state. */
async function bootToIdle(game: GameKind) {
  const rom = await loadROM(game);
  const board = new SoundBoard(game, rom);
  const cpu = createCPU();
  board.cpu = cpu;
  reset(cpu, board);
  let lastPc = -1;
  let sameSteps = 0;
  for (let i = 0; i < 2000; i++) {
    step(cpu, board);
    if (cpu.pc === lastPc) {
      sameSteps++;
      if (sameSteps >= 4) break;
    } else {
      sameSteps = 0;
      lastPc = cpu.pc;
    }
  }
  return { board, cpu };
}

describe("PIA → CPU IRQ delivery", () => {
  // ----- A. Happy path -----------------------------------------------------
  describe("A. happy path", () => {
    it("Defender: command fires → CPU leaves idle and vectors to IRQV target", async () => {
      const { board, cpu } = await bootToIdle("defender");
      const idlePc = cpu.pc;
      const irqVector = (board.rom[board.rom.length - 8]! << 8) | board.rom[board.rom.length - 7]!;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      expect(cpu.pc).not.toBe(idlePc);     // left the BRA-self
      expect(cpu.pc).toBe(irqVector);      // and is now at IRQ target
      expect(irqVector).toBe(0xFCB6);      // sanity — matches documented Defender IRQ
    });

    it("Stargate: same flow with its own IRQV value", async () => {
      const { board, cpu } = await bootToIdle("stargate");
      const idlePc = cpu.pc;
      const irqVector = (board.rom[board.rom.length - 8]! << 8) | board.rom[board.rom.length - 7]!;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      expect(cpu.pc).not.toBe(idlePc);
      expect(cpu.pc).toBe(irqVector);
      expect(irqVector).toBe(0xFC8C);
    });

    it("Robotron: same flow with its own IRQV value", async () => {
      const { board, cpu } = await bootToIdle("robotron");
      const irqVector = (board.rom[board.rom.length - 8]! << 8) | board.rom[board.rom.length - 7]!;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      expect(cpu.pc).toBe(irqVector);
      // $FB11 in the production Robotron sound ROM (matches MAME's bundled
      // dump byte-for-byte after the FCC + `ORG LOCRAM+1` preprocessor fixes).
      expect(irqVector).toBe(0xFB11);
    });

    it("vectoring consumes the documented 12 cycles", async () => {
      const { board, cpu } = await bootToIdle("defender");
      const cyclesBefore = cpu.cycles;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      expect(cpu.cycles - cyclesBefore).toBe(12);
    });
  });

  // ----- B. Stack-frame invariants ----------------------------------------
  describe("B. stack-frame invariants", () => {
    it("pushes PCl, PCh, Xl, Xh, A, B, CCR in order onto a descending SP", async () => {
      const { board, cpu } = await bootToIdle("defender");

      // Seed registers with recognisable patterns so we can verify they
      // appear on the stack in the documented order.
      cpu.a = 0x5A;
      cpu.b = 0xA5;
      cpu.x = 0xABCD;
      const idlePc = cpu.pc;
      const spBefore = cpu.sp;
      const ccrBefore = cpu.ccr;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      // 7 bytes pushed → SP decreased by 7.
      expect(cpu.sp).toBe((spBefore - 7) & 0xFFFF);
      // Stack memory layout (descending push, so memory order is reversed):
      expect(board.read(spBefore)).toBe(idlePc & 0xFF);             // PCl, pushed first
      expect(board.read((spBefore - 1) & 0xFFFF)).toBe((idlePc >>> 8) & 0xFF); // PCh
      expect(board.read((spBefore - 2) & 0xFFFF)).toBe(0xCD);       // Xl
      expect(board.read((spBefore - 3) & 0xFFFF)).toBe(0xAB);       // Xh
      expect(board.read((spBefore - 4) & 0xFFFF)).toBe(0x5A);       // A
      expect(board.read((spBefore - 5) & 0xFFFF)).toBe(0xA5);       // B
      expect(board.read((spBefore - 6) & 0xFFFF)).toBe(ccrBefore);  // CCR (pre-vectoring)
    });

    it("sets I=1 in the CPU's CCR after vectoring (but not in the pushed CCR)", async () => {
      const { board, cpu } = await bootToIdle("defender");

      // Ensure I was clear so the IRQ would be serviced (SETUP runs CLI early).
      expect(ccrHas(cpu.ccr, CCR_BITS.I)).toBe(false);
      const ccrBefore = cpu.ccr;
      const spBefore = cpu.sp;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      // Live CCR has I set
      expect(ccrHas(cpu.ccr, CCR_BITS.I)).toBe(true);
      // The byte pushed at SP+1 (after the descending push) was the OLD CCR
      const pushedCcr = board.read((spBefore - 6) & 0xFFFF);
      expect(pushedCcr).toBe(ccrBefore);
      // and the old CCR had I=0
      expect(pushedCcr & CCR_BITS.I).toBe(0);
    });

    it("reserved CCR bits 6 and 7 remain set throughout vectoring", async () => {
      const { board, cpu } = await bootToIdle("defender");
      board.pia.setCommand(0x00);
      tick(cpu, board);
      expect(cpu.ccr & 0xC0).toBe(0xC0);
    });
  });

  // ----- C. Negative / masking --------------------------------------------
  describe("C. interrupt masking and no-refire-without-command", () => {
    it("when CCR I=1, a pending command does NOT vector", async () => {
      const { board, cpu } = await bootToIdle("defender");
      const idlePc = cpu.pc;

      // Force the I flag on
      cpu.ccr = (cpu.ccr | CCR_BITS.I) | 0xC0;

      board.pia.setCommand(0x00);
      tick(cpu, board);

      // CPU should still be at idle (executing BRA *)
      expect(cpu.pc).toBe(idlePc);
    });

    it("once vectored, a subsequent tick does NOT re-vector for the same command", async () => {
      const { board, cpu } = await bootToIdle("defender");
      board.pia.setCommand(0x00);
      tick(cpu, board); // services the IRQ — PC now at IRQV target

      const irqTarget = cpu.pc;
      const cyclesAfterFirstVector = cpu.cycles;

      // PIA's CA1 latch is still set because the IRQ handler hasn't yet read
      // Port B; however, the CPU now has I=1 so further IRQs are masked.
      // The second tick should execute the FIRST instruction of the handler
      // (Defender's is `LDS #$007F`, 3 cycles) — NOT vector again (which would
      // cost 12 cycles and put PC back at the IRQV target).
      tick(cpu, board);
      expect(cpu.pc).not.toBe(irqTarget); // PC advanced past handler entry
      expect(cpu.cycles - cyclesAfterFirstVector).toBeLessThan(12); // not another vector
      expect(ccrHas(cpu.ccr, CCR_BITS.I)).toBe(true); // I-mask still set
    });

    it("PIA's CA1 flag clears after Port B data read (real-hardware behaviour)", async () => {
      const { board } = await bootToIdle("defender");
      board.pia.setCommand(0x12);
      expect(board.pia.isIRQPending()).toBe(true);
      // The PIA's CRB has bit 2 set by SETUP → reading Port-B *data* clears CA1
      board.read(0x0402);
      expect(board.pia.isIRQPending()).toBe(false);
    });
  });

  // ----- D. Re-fire on a new command --------------------------------------
  describe("D. re-fire", () => {
    it("a second setCommand after the handler returns vectors again", async () => {
      const { board, cpu } = await bootToIdle("defender");

      // First fire and consume the CA1 (simulate the handler reading port B)
      board.pia.setCommand(0x00);
      tick(cpu, board); // vector
      board.read(0x0402); // clear CA1 (what the real handler does)
      expect(board.pia.isIRQPending()).toBe(false);

      // Manually clear I to simulate RTI (we haven't implemented RTI yet, so
      // this isolates the wiring under test from the opcode coverage).
      cpu.ccr = cpu.ccr & ~CCR_BITS.I;

      // Reset PC to the idle loop's BRA-self so we have something to leave again.
      const idlePc = 0xF801 - 1; // SETUP last instruction is at $F801 area; this is fine for the test.
      cpu.pc = idlePc + 0; // any address is fine — we only test that vectoring happens
      const pcBeforeRefire = cpu.pc;

      board.pia.setCommand(0x11);
      tick(cpu, board);
      expect(cpu.pc).not.toBe(pcBeforeRefire);
      expect(cpu.pc).toBe(0xFCB6); // Defender IRQ target
    });
  });
});

/**
 * Integration smoke test: load each game's assembled sound ROM, step the CPU
 * through its reset/SETUP routine, and verify the PIA ends up configured.
 *
 * The Williams SETUP routine (Defender lines 168-190 of VSNDRM1.SRC) does:
 *
 *   LDS  #$007F        ; SP at top of internal RAM
 *   LDX  #$0400        ; PIA base
 *   CLR  1,X           ; CRA  := 0 (DDR access)
 *   CLR  3,X           ; CRB  := 0 (DDR access)
 *   LDAA #$FF          ; all-outputs mask
 *   STAA 0,X           ; DDRA := $FF (Port A = all outputs → DAC drive)
 *   CLR  2,X           ; DDRB := 0  (Port B = all inputs → command latch)
 *   LDAA #$3C          ; CRA value: DDRA -> data mode, …
 *   STAA 1,X
 *   LDAA #$37
 *   STAA 3,X
 *   …
 *   BRA *              ; idle wait for IRQ
 *
 * After running the SETUP routine the PIA should report:
 *   DDR_A = $FF, DDR_B = $00, CRA bit 2 set, CRB bit 2 set.
 */
import { describe, expect, it } from "vitest";

import { createCPU, reset, step } from "../src/cpu/m6800.ts";
import { SoundBoard, type GameKind } from "../src/board/soundboard.ts";
import { loadROM } from "../src/node/rom.ts";

const GAMES: GameKind[] = ["defender", "stargate", "robotron"];

describe("sound-board boot", () => {
  for (const game of GAMES) {
    it(`${game}: SETUP configures DDR_A=$FF, DDR_B=$00, control regs to data mode`, async () => {
      const rom = await loadROM(game);
      const board = new SoundBoard(game, rom);
      const cpu = createCPU();
      board.cpu = cpu;
      reset(cpu, board);

      // Reset vector should point into ROM.
      expect(cpu.pc).toBeGreaterThanOrEqual(board.romBase);
      expect(cpu.pc).toBeLessThan(board.romBase + rom.length);

      // Run until the CPU enters the idle BRA-self loop, or up to a hard cap.
      // The SETUP routine completes in well under 200 instructions.
      let lastPc = -1;
      let samePcSteps = 0;
      const maxSteps = 1000;
      let i = 0;
      while (i < maxSteps) {
        step(cpu, board);
        i++;
        if (cpu.pc === lastPc) {
          samePcSteps++;
          if (samePcSteps >= 4) break; // tight self-branch detected
        } else {
          samePcSteps = 0;
          lastPc = cpu.pc;
        }
      }
      expect(i).toBeLessThan(maxSteps); // we found the idle loop

      // PIA was configured during SETUP.
      expect(board.pia.inspectDDR_A()).toBe(0xFF);
      expect(board.pia.inspectDDR_B()).toBe(0x00);
      // After CRA = $3C / CRB = $37, bit 2 (data-mode select) is set on both.
      expect(board.pia.inspectCRA() & 0x04).toBe(0x04);
      expect(board.pia.inspectCRB() & 0x04).toBe(0x04);
    });
  }
});

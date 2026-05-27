/**
 * Motorola 6800 CPU emulator (cycle-accurate per instruction).
 *
 * Public surface:
 *   • `createCPU()` returns a fresh CPUState seeded for reset.
 *   • `reset(cpu, bus)` reads the reset vector ($FFFE/$FFFF) into PC.
 *   • `step(cpu, bus)` executes one instruction (or services a pending IRQ /
 *     NMI), returning the number of cycles consumed.
 *
 * The dispatch table maps opcode -> handler.  Each handler is a small function
 * `(cpu, bus) => cycles_consumed`.  The handlers update `cpu.pc`, `cpu.cycles`,
 * registers, CCR, etc. in place.  This style avoids a per-instruction object
 * allocation and lets the emulator run at hundreds of thousands of ops per
 * second in a typical browser.
 *
 * Implementation strategy: we start with a small subset of opcodes — the ones
 * exercised by the Williams sound-ROM SETUP routine — and grow the table as
 * tests demand.  Every unimplemented opcode throws so the gap is visible.
 *
 * Cycle counts come from the Motorola 6800 datasheet.
 */
import { type Bus, type CPUState, readWord, writeWord } from "./types.ts";
import { CCR_BITS, CCR_RESET, ccrSet, setNZ8, setNZ16 } from "./flags.ts";
import { OPCODES } from "./instructions.ts";

const VECTOR_IRQ   = 0xFFF8;
const VECTOR_SWI   = 0xFFFA;
const VECTOR_NMI   = 0xFFFC;
const VECTOR_RESET = 0xFFFE;

/** Build a fresh CPU in its just-powered-on state.  Caller still has to run reset(). */
export function createCPU(): CPUState {
  return {
    a: 0,
    b: 0,
    x: 0,
    sp: 0,
    pc: 0,
    ccr: CCR_RESET,
    cycles: 0,
    irqPending: false,
    nmiPending: false,
    waiting: false,
  };
}

/**
 * Perform a CPU reset.  Sets I=1, reads the reset vector at $FFFE/$FFFF,
 * and points PC at the routine it names.  Other registers are undefined on a
 * real 6800 but we zero them for reproducibility.
 */
export function reset(cpu: CPUState, bus: Bus): void {
  cpu.a = 0;
  cpu.b = 0;
  cpu.x = 0;
  cpu.sp = 0;
  cpu.ccr = CCR_RESET;
  cpu.cycles = 0;
  cpu.irqPending = false;
  cpu.nmiPending = false;
  cpu.waiting = false;
  cpu.pc = readWord(bus, VECTOR_RESET);
}

/**
 * Execute one instruction.  Returns the number of CPU cycles consumed.
 *
 * If an NMI or unmasked IRQ is pending, the corresponding vector is taken
 * before the next instruction (12 cycles each, per the datasheet).
 */
export function step(cpu: CPUState, bus: Bus): number {
  // NMI is edge-triggered and always serviced.
  if (cpu.nmiPending) {
    cpu.nmiPending = false;
    return takeInterrupt(cpu, bus, VECTOR_NMI);
  }
  // IRQ is level-sensitive but masked by I-flag.
  if (cpu.irqPending && (cpu.ccr & CCR_BITS.I) === 0) {
    return takeInterrupt(cpu, bus, VECTOR_IRQ);
  }
  // WAI: idle until interrupted.  Returns 1 cycle to keep the simulation
  // moving forward; the next real cycle budget happens after the IRQ fires.
  if (cpu.waiting) {
    cpu.cycles += 1;
    return 1;
  }

  const opcode = bus.read(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xFFFF;
  const handler = OPCODES[opcode];
  if (!handler) {
    throw new Error(
      `unimplemented opcode 0x${opcode.toString(16).padStart(2, "0")} at PC=0x${
        ((cpu.pc - 1) & 0xFFFF).toString(16).padStart(4, "0")
      }`,
    );
  }
  const used = handler(cpu, bus);
  cpu.cycles += used;
  return used;
}

/**
 * Push the full register set onto the stack (per the 6800 interrupt protocol),
 * load the vectored PC, and set the I bit.  Used by IRQ, NMI, and SWI.
 */
export function takeInterrupt(cpu: CPUState, bus: Bus, vector: number): number {
  cpu.waiting = false;
  // Push order: PC-low, PC-high, X-low, X-high, A, B, CCR  (low addresses)
  pushByte(cpu, bus, cpu.pc & 0xFF);
  pushByte(cpu, bus, (cpu.pc >>> 8) & 0xFF);
  pushByte(cpu, bus, cpu.x & 0xFF);
  pushByte(cpu, bus, (cpu.x >>> 8) & 0xFF);
  pushByte(cpu, bus, cpu.a);
  pushByte(cpu, bus, cpu.b);
  pushByte(cpu, bus, cpu.ccr);
  cpu.ccr = ccrSet(cpu.ccr, CCR_BITS.I, true);
  cpu.pc = readWord(bus, vector);
  cpu.cycles += 12;
  return 12;
}

// --- internal helpers shared with opcode handlers --------------------------

export function pushByte(cpu: CPUState, bus: Bus, value: number): void {
  bus.write(cpu.sp & 0xFFFF, value & 0xFF);
  cpu.sp = (cpu.sp - 1) & 0xFFFF;
}

export function pullByte(cpu: CPUState, bus: Bus): number {
  cpu.sp = (cpu.sp + 1) & 0xFFFF;
  return bus.read(cpu.sp & 0xFFFF);
}

/** Re-export helpers so `instructions.ts` can use them without depending on flags. */
export { readWord, writeWord, setNZ8, setNZ16 };

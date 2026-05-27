/**
 * Minimal Motorola 6821 PIA emulation, just enough for the Williams sound
 * board.  The real chip is a much richer beast; we model what the sound CPU
 * actually touches:
 *
 *   $0400  Port A data / DDR (DAC output)
 *   $0401  Port A control register
 *   $0402  Port B data / DDR (command input from main CPU)
 *   $0403  Port B control register
 *
 * The DDR/data toggle is selected by bit 2 of the control register.
 *
 * The interesting side-effects:
 *   • Every WRITE to Port A data is recorded as a "DAC event" with the
 *     current CPU cycle.  This is the raw signal the speaker eventually
 *     reproduces.
 *   • A WRITE to Port B (from outside — `setCommand()` below) sets the
 *     latched value, and pulses CA1 (rising edge) — which on the real board
 *     wires to the 6808's /IRQ pin.
 *
 * Each instance owns its own state; the bus simply forwards reads/writes
 * through the four register addresses.
 */

export interface DACEvent {
  /** Absolute CPU-cycle timestamp of the DAC write. */
  cycle: number;
  /** Byte value written (0..255). */
  value: number;
  /**
   * CPU PC at the moment of the write — i.e. the next instruction the CPU
   * would have executed.  Lets the tape view show "which line of code
   * produced this byte."  Optional so callers (and golden fixtures from
   * before this field existed) that don't supply a CPU still type-check.
   */
  pc?: number;
}

export class PIA {
  /** Port A data register (DAC output when DDR_A is all-outputs). */
  private portA = 0;
  /** Port A data direction register (1=output bit). */
  private ddrA = 0;
  /** Port A control register.  Bit 2 selects DDR vs DATA. */
  private craReg = 0;

  /** Port B data register (command latch from main CPU). */
  private portB = 0;
  /** Port B data direction register. */
  private ddrB = 0;
  /** Port B control register.  Bit 2 selects DDR vs DATA. */
  private crbReg = 0;

  /** True when CA1 has just been asserted (pending IRQ to the CPU). */
  private ca1IRQPending = false;

  /**
   * Recorded sequence of writes to Port A.  The host can flush these into
   * a sampler for audio reconstruction.  Capped indirectly by the host.
   */
  readonly dacEvents: DACEvent[] = [];

  /** Read register at offset 0..3 within the PIA. */
  read(offset: number): number {
    switch (offset & 0x3) {
      case 0: // Port A: data or DDR
        return (this.craReg & 0x04) !== 0 ? this.portA & 0xFF : this.ddrA & 0xFF;
      case 1:
        return this.craReg & 0xFF;
      case 2: // Port B: data or DDR
        // Reading Port-B data clears the CA1-equivalent (CB1) interrupt flag.
        // Williams sound code reads Port B inside the IRQ handler, so this
        // matters: clear ca1IRQPending here too.
        if ((this.crbReg & 0x04) !== 0) {
          this.ca1IRQPending = false;
          return this.portB & 0xFF;
        }
        return this.ddrB & 0xFF;
      case 3:
        return this.crbReg & 0xFF;
      default:
        return 0;
    }
  }

  /** Write register at offset 0..3 within the PIA. */
  write(offset: number, value: number, cycle: number, pc = 0): void {
    const v = value & 0xFF;
    switch (offset & 0x3) {
      case 0:
        if ((this.craReg & 0x04) !== 0) {
          this.portA = v;
          // Record only the OUTPUT side: the bits that are configured as
          // outputs by DDR_A.  In the Williams setup DDR_A is $FF (all 8
          // bits output), so the effective DAC value is the full byte.
          const dacValue = v & this.ddrA & 0xFF;
          this.dacEvents.push({ cycle, value: dacValue, pc });
        } else {
          this.ddrA = v;
        }
        return;
      case 1:
        this.craReg = v;
        return;
      case 2:
        if ((this.crbReg & 0x04) !== 0) {
          this.portB = v;
        } else {
          this.ddrB = v;
        }
        return;
      case 3:
        this.crbReg = v;
        return;
    }
  }

  /**
   * Called by the host to inject a 6-bit command from the "main CPU".  Sets
   * Port B data and asserts CA1 (which the bus translates to an IRQ).
   */
  setCommand(command: number): void {
    // The real board inverts the command on the way in (active-low strobe);
    // the sound CPU does `COMA / ANDA #$3F` to undo this.  For convenience
    // we accept the post-COMA value here (0..0x3F) and pre-invert it.
    this.portB = (~command) & 0xFF;
    this.ca1IRQPending = true;
  }

  /** True while the CA1 line is high (i.e. a command is pending). */
  isIRQPending(): boolean {
    return this.ca1IRQPending;
  }

  // --- inspection helpers used by tests ----------------------------------

  /** Read DDR_A (test/debug only — bypasses the data/DDR toggle). */
  inspectDDR_A(): number { return this.ddrA & 0xFF; }
  /** Read DDR_B (test/debug only). */
  inspectDDR_B(): number { return this.ddrB & 0xFF; }
  /** Read CRA (test/debug only). */
  inspectCRA(): number { return this.craReg & 0xFF; }
  /** Read CRB (test/debug only). */
  inspectCRB(): number { return this.crbReg & 0xFF; }
}

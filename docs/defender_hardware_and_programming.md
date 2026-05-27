# Defender (1981) — Hardware & Programming Deep Dive

*A technical reference for developers, covering the arcade hardware, system architecture, programming model, and source/build resources for Williams Electronics' Defender.*

---

## 1. Overview and historical context

Defender was developed by Eugene Jarvis, Larry DeMar, Sam Dicker and Paul Dussault at Williams Electronics in Chicago, and released in early 1981. It was Williams' first video game (the company was previously a pinball manufacturer) and went on to become their best-selling arcade title, with over 55,000 cabinets shipped during the golden age of arcade games.

What makes Defender interesting from a system-engineering perspective is that it sits at an unusual point in arcade evolution. By 1980, most arcades had moved from hand-wired analog circuits to specialized graphics chips (Galaxian/Pac-Man-style sprite hardware) and PSG sound chips (AY-3-8910, SN76489). Defender went a completely different direction: a **general-purpose CPU plus a large bitmap framebuffer** for video, and a **second general-purpose CPU plus a DAC** for sound. There is no sprite hardware, no scrolling hardware, and on the original board, no blitter. The 6809 CPU draws every pixel in software at 60 Hz — a remarkable feat given a 1 MHz clock.

Development used a Motorola EXORcisor / Gimix 6809 system with dual 8-inch floppies in Larry DeMar's spare bedroom. Jarvis programmed during the day and DeMar at night, on the same physical workstation. Defender development took roughly nine months — far longer than expected — and the team famously finished features at the AMOA trade show booth.

**Key sources for this section**

- Wikipedia — Defender (1981 video game): <https://en.wikipedia.org/wiki/Defender_(1981_video_game)>
- Eugene Jarvis interview, Halcyon Days (Dadgum Games): <https://dadgum.com/halcyon/BOOK/JARVIS.HTM>
- Arcade Blogger — Development of Robotron (covers Defender background too): <https://arcadeblogger.com/2020/06/27/the-development-of-robotron/>

---

## 2. Cabinet board set

A Defender cabinet is built from five separate PCBs connected via a backplane / harness. This was the typical "Williams 6809 Rev.1" architecture, later refined for Stargate, Robotron, Joust, Bubbles, Sinistar and Splat.

1. **CPU board** — Motorola 6809E + 48 KB DRAM. Defender's CPU board is unique to Defender and Stargate; it has no provision for screen rotation or player-2 controls, so it cannot be used in cocktail variants.
2. **ROM board** — Carries the program ROMs (defend.1 through defend.12), the I/O PIA (MC6821) for talking to the sound board and coin door, and the bank-switch latch.
3. **Interface board** — Reads the joystick and the five action buttons; debounces; multiplexes them onto a second PIA.
4. **Sound board** — Independent computer: Motorola 6802/6808 + RAM + a 2 KB sound ROM + 8-bit DAC + amplifier. This board is shared across many Williams video games and pinball machines from 1980–1983.
5. **Power supply board** — Regulated DC for everything; also used by early Stargate cabinets.

The boards communicate over a parallel bus on the backplane. The sound board is intentionally isolated — the main CPU never reads sound RAM; it only writes a 6-bit "sound command" code to a PIA register and continues. This division of labour is the same pattern Williams used in its pinball machines, and it's what gives Defender its distinctive sonic character (more on this below).

**Source:** Sean Riddle's Williams Hardware Description: <https://seanriddle.com/willhard.html> and the Robotron-2084 board identification site: <https://www.robotron-2084.co.uk/techwilliamshardwareid.html>

---

## 3. The main CPU subsystem

### 3.1 Motorola 6809E at 1 MHz

The main CPU is a **Motorola MC6809E**, the externally-clocked variant of the 6809, clocked at exactly 1 MHz. The 6809E is significantly more capable than its contemporaries (Z80 and 6502) for this kind of work:

- **Two 8-bit accumulators** (A and B) that can also be paired as a 16-bit D register.
- **Two index registers** (X and Y), both fully usable for arithmetic and addressing.
- **Two stack pointers** (S = hardware stack, U = user stack), enabling fast context switches between game loop and ISRs.
- **Direct Page (DP) register** — an 8-bit register specifying the high byte of a 256-byte "zero-page" anywhere in memory. Defender sets DP to `$A0`, so its game variables live at `$A0xx` and are reachable with the fast 1-byte direct addressing mode.
- **Position-independent code** through PC-relative addressing — important when the same routines run from multiple ROM banks.
- **Hardware 8×8→16 multiply** (`MUL`) and signed/unsigned arithmetic — rare in 1980 8-bit MCUs.
- **Three orthogonal interrupt lines**: `NMI`, `IRQ`, `FIRQ`. The Fast IRQ skips most context save, which Defender uses for the high-rate timer interrupt.

The 6809 was the right choice for this hardware precisely because it has to do *everything* — pixel pushing, AI, collision detection, scrolling, scoring — in 16.67 ms per frame at 1 MHz. That budget is about 16,666 cycles per frame; an "average" 6809 instruction takes 3–6 cycles, so the entire game loop has on the order of 3,000–5,000 instructions per frame to spend. Defender's code is aggressively optimised for that constraint.

### 3.2 The 64 KB address space and Defender-specific memory map

The 6809 has a flat 16-bit address bus, giving 64 KB. Defender is unusual among Williams games in that it dedicates almost all of low memory to RAM: `$0000`–`$BFFF` is RAM at all times — 48 KB — most of which is the video framebuffer. ROM appears only at `$D000`–`$FFFF`, and a single 4 KB window at `$C000`–`$CFFF` is bank-switched to expose the rest of the program ROM, I/O registers, palette registers and CMOS configuration.

```
$0000–$97FF   Screen RAM (framebuffer, ~38 KB)
$9800–$9FFF   General RAM (game state, AI, lists)
$A000–$BFFF   General RAM
              - Stack pointer initialised to $BFFF (descending)
              - DP = $A0 so $A0xx is the "direct page"
$C000–$CFFF   Bank-switched window (4 KB)
$D000–$FFFF   Fixed ROM (defend.1 + defend.4 + defend.2 + defend.3)
```

The 4 KB bank-switch window at `$C000`–`$CFFF` is controlled by writing the bank number to anywhere in `$D000`–`$DFFF` (yes — writing to ROM space; the address bits are decoded by the bank logic, and the write is effectively a side-effect on a latch). The banks are:

| Bank | Contents                                                |
|------|---------------------------------------------------------|
| 0    | I/O — color palette, screen control, watchdog, CMOS, PIAs |
| 1    | Bank1 (defend.9 + defend.12), 2×2 KB                    |
| 2    | Bank2 (defend.8 + defend.11), 2×2 KB                    |
| 3    | Bank3 (defend.7 + defend.10), 2×2 KB                    |
| 4–6  | Unused                                                  |
| 7    | Bank7 (defend.6), 2 KB                                  |

Bank 0 is the I/O bank. When it is selected, the `$C000`–`$CFFF` window is mapped to memory-mapped peripherals rather than program ROM. The most important addresses there:

```
$C000–$C00F   16 palette registers (8 bits each, BBGGGRRR — 2/3/3 bits)
$C010         Screen control bits (rotation/flip etc.)
$C3FC–$C3FF   Watchdog — writing $38 or $39 here resets the watchdog timer
$C400–$C7FF   1 KB battery-backed CMOS RAM (high scores, configuration)
$C800–$CBFF   Read 6 MSbits of video address counter (used to know
              what line is currently being scanned out)
$CC00–$CC03   PIA #1 (ROM board)  — sound command out, coin door inputs,
                                    LED outputs, 4 ms and 240-line interrupts
$CC04–$CC07   PIA #2 (Interface)  — joystick + 5 action buttons
```

So the entire I/O surface — palette, screen control, sound, watchdog, controls, NVRAM — fits in 4 KB, and the game ROM still has 26 KB of code space (12 KB fixed + 4 banks × 4 KB). This is impressively dense.

**Source:** Computer Archeology — Defender Hardware page (excellent annotated memory map): <https://computerarcheology.com/Arcade/Defender/Hardware.html>

### 3.3 PIAs (MC6821) and I/O

There are two MC6821 Peripheral Interface Adapters on the ROM board and one on the sound board. Each PIA gives two 8-bit ports plus four "control lines" (CA1, CA2, CB1, CB2) that can be inputs, outputs, or interrupt sources.

**PIA #1 (ROM board) — `$CC00`–`$CC03`** does most of the work:
- Port A (`$CC00`): bits 0–5 read the coin door (auto/manual switch, advance, three coin slots, high-score reset). Bits 6–7 drive two LEDs.
- Port B (`$CC02`): bits 0–5 are outputs to the sound board — this is the 6-bit "sound command" bus. Bits 6–7 are two more LEDs.
- CA1: connected to the **COUNT240** signal — fires on the negative-to-positive transition every time the video counter hits line 240. Used to generate a 60 Hz "vertical blank" interrupt to the main CPU.
- CB1: a **4 ms periodic interrupt** derived from the video timing. The 6809 services this 250 times per second; it's the main time-base for game logic.
- CB2: a hardware "mute" — when pulled low, it stops interrupts from reaching the sound CPU.

**PIA #2 (Interface board) — `$CC04`–`$CC07`** reads the player controls (5-position joystick = up/down + the digital buttons: Fire, Thrust, Smart Bomb, Hyperspace, Reverse). CB2 selects player 1 vs player 2 in two-player mode — the same buttons are read twice per frame on alternating reads.

**Source:** Arcade Game Manual (Defender) — Internet Archive: <https://archive.org/stream/ArcadeGameManualDefender/defender_djvu.txt>

### 3.4 The watchdog and the boot sequence

Defender has a hardware watchdog at `$C3FC`–`$C3FF`. The CPU must write the byte `$38` or `$39` to one of these addresses periodically (typically once per frame); otherwise the watchdog resets the CPU. This is classic embedded-systems defensive design: if the game crashes or gets stuck in a runaway loop, the cabinet reboots itself rather than freezing in front of a paying customer.

On reset, the 6809 loads its program counter from the reset vector at `$FFFE/$FFFF`, which points into bank-fixed ROM at the top of the address space. Early in boot, the CPU sets DP to `$A0` and initialises the stack pointer to `$BEFF` (later raised to `$BFFF` once stack-test passes).

---

## 4. Video hardware

This is the part that always surprises modern developers: there is **no graphics chip**. The CPU writes pixels directly into a region of DRAM, and discrete TTL logic reads that DRAM and shifts the bits out to the RGB DACs.

### 4.1 Framebuffer organisation

The display is 304 horizontal × 256 vertical pixels at 16 colors out of a 256-color palette, but Defender uses only about 290 × 241 of those pixels (the rest are hidden by overscan on the CRT). The framebuffer occupies `$0000`–`$97FF`, which is **38 KB** — most of the system DRAM.

Each pixel is 4 bits, so one byte stores two pixels. The 4-bit value indexes into the 16-entry palette, which itself contains 8-bit BBGGGRRR values (2 bits blue, 3 bits green, 3 bits red, written to the registers at `$C000`–`$C00F`). The R, G, B bits drive three resistor-transistor ladder DACs that produce the analog video signal.

### 4.2 The rotated-monitor layout — and why pixels are *column-major*

The CRT in a Defender cabinet is mounted **on its side**: the monitor is physically rotated 90° from a typical TV, so the natural raster lines now run *vertically* across what the player perceives as the playfield. This was a common arcade trick: it lets a 4:3 tube give you more horizontal action space than vertical.

Because the hardware reads RAM out in raster order — meaning sequential bytes are sequential pixels along a scanline — and the scanlines run vertically in the player's view, the framebuffer ends up arranged **column-major in player coordinates**. Concretely:

- Byte at `$0000` displays as the two pixels in the upper-left corner of the screen, stacked vertically.
- Byte at `$0001` displays as the two pixels immediately below them (next byte down a column).
- Byte at `$00FF` (i.e. 256 bytes in) reaches the bottom-left corner of the screen.
- Byte at `$0100` starts the *next column* — the third and fourth pixels in the player's "top row".

So each 256-byte page of memory is one column (= 256 vertical pixels, 2 pixels per byte → 256 pixels tall). The game does its drawing *with* this layout rather than fighting it: a horizontal scroll is conceptually just stepping the read base address by 256 bytes, and vertical moves are 1-byte increments. This is exactly why so much Defender code uses 256-byte stride arithmetic.

### 4.3 No sprites, no blitter, no scrolling hardware

This is the punch line that makes Defender impressive:

> "In fact, Defender doesn't have a blitter at all — it is all drawn by the main CPU."  
> — Aaron Giles, on the original Williams 6809 hardware

There is **no sprite engine**. There is **no horizontal scroll register**. The 6809 redraws the visible playfield from a logical world that is **wider than the screen** (this is the "wraparound" world inherited from Asteroids). Every visible object — your ship, the landers, mutants, bombers, baiters, swarmers, pods, smart bombs, the mountainous terrain, the radar mini-map at the top — is *blitted by hand* into the framebuffer every frame, and *erased* before the next frame's draw.

The two ICs ("Special Chips" 1 and 2) that implement a real hardware blitter only appear on later Williams hardware starting with Robotron (1982). On Defender, the entire pixel pipeline is the 6809 plus tightly hand-coded copy/erase loops.

Two consequences fall out of this design:

1. **No depth sorting or masking is free.** The CPU can't easily test "is there already something at this pixel?" because the framebuffer is in the same memory region as ROM-shadow space and reads there would return ROM data, not framebuffer data. So Defender uses *back-to-front* drawing and accepts pixel-level overlap artifacts — you can see a 1-pixel "shadow" when two aliens cross each other. This is a deliberate trade-off, not a bug.
2. **Drawing time scales with on-screen action.** If the wave gets too dense, the CPU literally can't finish drawing before the next interrupt arrives, and the game slows down. Williams turned this into a *feature*: the perceived "slow-motion" during heavy action is iconic and rewarding. Some sources note the game also moves aliens by larger steps when overloaded, and silently teleports excess enemies into the far side of the wraparound world to keep the local frame budget achievable.

### 4.4 Interrupts and the frame timing model

Defender uses **two interrupts** to pace its frame:

- **COUNT240 (the start of vertical blank, ~60 Hz)** — fires when the vertical counter reaches line 240, on the IRQ line via the PIA's CA1. The handler kicks off the second half of the frame: erase + redraw of objects in the lower half of the screen.
- **4 ms periodic timer (250 Hz)** — fires every 4 ms via the PIA's CB1, also on IRQ. It's the heartbeat for fixed-timestep game logic. With a 16.67 ms frame, you get roughly four 4-ms ticks per frame; the game uses this for sub-frame timing of physics, sound triggers, and the mid-screen split.

The mid-screen interrupt mechanism is the elegant trick: by splitting the redraw into "upper half" and "lower half" passes, each driven by a separate interrupt, Defender effectively double-buffers in time without needing a second framebuffer (which it couldn't afford in 48 KB of DRAM). When the CRT beam is in the upper half, the CPU is busy redrawing the lower half (which the beam hasn't reached yet); when the beam reaches the lower half during VBL, the CPU flips to redrawing the upper half. The result is no visible tearing on properly-drawn objects.

**Sources for this section**

- rec.games.video.classic post on Defender hardware specs (from one of the original developers): <https://groups.google.com/g/rec.games.video.classic/c/6Gsg136cJIA>
- Sean Riddle — Blitter information & graphics layout: <https://seanriddle.com/blitter.html> and <https://seanriddle.com/ripper.html>
- Aaron Giles' archive (April 2005): <https://aarongiles.com/old/?m=200504>
- FPGA recreation report with detailed video pipeline diagrams: <https://www.ele.uva.es/~jesus/DEFENDER/defrdx.pdf>

---

## 5. Sound subsystem

### 5.1 Architecture: CPU + DAC, not PSG

The sound board is a self-contained computer:

```
6802/6808 CPU @ ~894 kHz  ──►  PIA (MC6821)  ──►  8-bit R-2R DAC  ──►  LPF + amp ──► speaker
        ▲                          ▲
        │                          │  CA1: sound-command interrupt from main CPU
        │ 2 KB ROM (program)       │  Port A: 6-bit command byte from main CPU
        │ 128 bytes RAM (state)
```

The 6802/6808 is a 6800-architecture CPU with on-chip clock generator and 128 bytes of internal RAM (which is the entire sound-side data RAM — there is no external RAM IC). The sound ROM is just **2 kilobytes**, mapped at `$F800`–`$FFFF`. The PIA at `$0400`–`$0403` accepts commands from the main CPU and presents the next sample byte to the 8-bit DAC.

This is the same architecture Randy Pfeiffer pioneered in Steve Ritchie's 1978 pinball machine "Flash". It is *forward-looking* for 1980 — most arcades were using PSG chips like the AY-3-8910 with fixed-function tone+noise channels — and it has the major advantage that anything the CPU can compute fast enough can be turned into sound. In principle it could play PCM samples; in practice 2 KB of ROM holds nowhere near enough audio data, so all sounds are **synthesised algorithmically** by tiny subroutines that compute samples on the fly.

### 5.2 Command interface

The main CPU writes a 6-bit value to bits 0–5 of port B at `$CC02` (PIA #1, port B). This drives a 6-bit parallel command into the sound board's port A. On the sound board, the rising edge of that latched byte triggers an interrupt to the 6808 (via CA1). The 6808's ISR reads the 6-bit code, dispatches into one of nine sound sub-programs (groups), and starts streaming samples to the DAC. The main CPU does **not** wait for the sound to finish — communication is one-way and fire-and-forget. Only one sound plays at a time; if a new one arrives while another is in progress, a priority table decides whether to preempt.

### 5.3 Algorithmic synthesis (example: ship destruction)

Each sound is a small assembly program that runs a phase accumulator (for pitch sweeps), reads from short waveform tables (sine, triangle, noise via LFSR), applies amplitude envelopes, optionally clips the waveform for harmonic distortion, and writes the result to the DAC port. The iconic "Lander Die" / ship-destruction sound is a sine sweep played four times with decreasing amplitudes (100%, 75%, 50%, 25%) and hard clipping at 50%, which introduces strong odd harmonics on the first two iterations and decays to a clean sine by the fourth.

Pseudocode for the structure:

```c
void play_destroy(void) {
    const float amps[4]  = {1.00f, 0.75f, 0.50f, 0.25f};
    const float clip_lvl = 0.50f;
    for (int it = 0; it < 4; ++it) {
        for (int n = 0; n < samples_per_iter; ++n) {
            float t = (float)n / samples_per_iter;
            float f = f_start + (f_end - f_start) * t;     // linear sweep down
            float s = amps[it] * sinf(2 * M_PI * f * n / SR);
            if (s >  clip_lvl) s =  clip_lvl;              // hard clip
            if (s < -clip_lvl) s = -clip_lvl;
            dac_write((uint8_t)(128 + 127.0f * s));
        }
    }
}
```

The actual 6800 code is much denser — the "sine" is a small lookup table, and the frequency sweep is a phase accumulator with a per-sample increment that itself changes each sample. But the structure above captures the algorithm exactly.

### 5.4 The nine sound groups

The 2 KB sound ROM contains nine distinct sub-programs (sound "groups"), each with its own parameter presets:

1. Player laser (downsweeping square)
2. Smart bomb (LFSR noise + amplitude envelope)
3. Hyperspace warp (chaotic FM-like effect)
4. Ship/lander destruction (sine sweep + hard clipping, described above)
5. Lander abducting astronaut (the "oo-oo-oo" rising pitch)
6. Extra-ship jingle
7. Lander killed by smart bomb
8. Baiter swarm warning
9. Utility / startup tones

**Sources**

- Computer Archeology — Defender Sound Hardware page: <https://computerarcheology.com/Arcade/Defender/SoundHardware.html>
- Defender Sound Studio (JavaScript port + disassembly with annotations): <https://zapspace.net/defender_sound/> and <https://zapspace.net/defender_sound/help.html>
- Nameless Algorithm — Defender hardware & sound ROM disassembly: <https://namelessalgorithm.com/defender/>
- ZEN Instruments — Williams sound disassembly notes: <http://zeninstruments.blogspot.com/2020/02/williams-defender-sound-disassembly.html>

---

## 6. Programming model and notable techniques

### 6.1 Language and toolchain

Defender is written in **Motorola 6809 assembly language** for the main game, and **Motorola 6800 assembly** for the sound module. There is no high-level language anywhere in the source. The team developed on a **Gimix 6809** workstation (and earlier an EXORcisor) with dual 8-inch floppies — they wrote their own text editor and assembler because off-the-shelf tools were inadequate. Compile cycles were on the order of **one hour**, which Jarvis worked around by editing instruction bytes directly in memory and disassembling them in his head while testing. Comments and indentation are sparse in the source because every byte of ROM was precious.

The four release revisions of the game ROMs are called **White Label**, **Blue Label**, **Green Label**, and **Red Label** (in chronological order). The Red Label is what the publicly available source code on GitHub assembles to.

### 6.2 Frame loop and timing

The conceptual game loop, reconstructed from the disassembly, is roughly:

```
main:
    init_hardware()           ; set DP, stack, palette, PIAs
    init_game_state()
    enable_interrupts()       ; COUNT240 + 4ms via PIAs
    forever:
        wait_for_top_half_redraw_due
        erase_objects_top()
        update_ai_top()       ; AI runs interleaved with drawing
        draw_objects_top()
        check_collisions_top()
        wait_for_bottom_half_redraw_due
        erase_objects_bottom()
        update_ai_bottom()
        draw_objects_bottom()
        check_collisions_bottom()
        kick_watchdog()
        update_scores_and_radar()
```

Real Defender code is much more interleaved — AI updates and drawing happen object-by-object, and the "wait" is implicit in the interrupt being delivered. The 4 ms timer maintains a per-frame counter so the code can subdivide a single 16.67 ms frame into ~4 time slices.

### 6.3 Drawing primitive: stack-blasting

Without a blitter, the inner loop of object drawing has to push pixel data into the framebuffer as fast as the 6809 can. The trick the Williams programmers used (and later refined for the post-Defender games) is what's now called **stack-blasting**: temporarily redirect the hardware stack pointer (`S`) into the destination region of the framebuffer, then use a long sequence of `PSHS` instructions to push pre-loaded register pairs into consecutive memory addresses. The `PSHS reg-list` instruction can write up to seven bytes in a single instruction at the cost of just a few cycles per byte — faster than the equivalent `STA / STB / LEAX 1,X` loop.

This works particularly well in Defender because of the column-major framebuffer layout: pushing onto a descending stack walks *upward* in memory, which corresponds to walking *upward* in a single column of pixels on the rotated screen — exactly the direction you want for a sprite that's drawn one column at a time. The same pre-loaded pixel byte can be re-pushed for a "stride" of two pixels, and changing the pre-loaded value gives the next row of the sprite.

Sprite source data lives in ROM as 4-bit-per-pixel bitmaps. They are organised in column-major form (matching the framebuffer) so that the copy loop is a straight `LDA / PSHS` cadence with minimal address math.

### 6.4 AI: parametric, table-driven, surprisingly small

The enemy AI is striking when you read the source: each enemy type is a tiny state machine (5–30 states) with parametric movement (target seek, dive, evade, abduct). The Lander has an explicit "search for astronaut" → "descend to abduct" → "ascend with astronaut" → "transform into Mutant if reaches top" cycle. Mutants are emergent — they're just landers in a different state, with different parameters fed to the same movement code, which is why they suddenly feel so dangerous.

The trick to keeping all this fast is that everything is precomputed into tables. Sine and cosine for movement are 256-entry byte tables. Pixel positions on screen are translated to framebuffer addresses by a tiny table lookup, not a multiplication. There are very few divisions anywhere in the code — most of the math is shift-and-add.

### 6.5 The CMOS NVRAM and configuration

The 1 KB CMOS RAM at `$C400`–`$C7FF` is battery-backed (a small 3 V coin cell on the ROM board) and stores high scores plus operator configuration: difficulty, number of starting ships, bonus thresholds, attract-mode behaviour. The operator changes these by holding down the "advance" button on the coin door and watching prompts on screen. Defender's CMOS layout is itself bank-switched (it appears only when bank 0 is selected) which prevents the game code from accidentally overwriting it.

---

## 7. Open source code and where to find it

In 2021 the **original Williams source code** for both the game and the sound module appeared on GitHub. This is the actual assembly source, not a reverse-engineering disassembly — comments, labels, file structure all intact (or as intact as 1980-era pre-Git development gets).

### 7.1 Original assembly source

- **`historicalsource/defender`** — Motorola 6809 assembly source for the *Red Label* game ROMs. <https://github.com/historicalsource/defender-1>
- **`historicalsource/williams-soundroms`** — 6800/6802 assembly source for the Williams sound boards (Defender, Stargate, Robotron, Joust, Bubbles, Sinistar). <https://github.com/historicalsource/williams-soundroms>

### 7.2 Buildable forks (easiest entry point)

These wrap the historical source with a modern assembler (asm6809 for the main game, vasm for the sound module) and a Makefile that produces a directory of `defend.1` through `defend.12` ROM files you can drop straight into MAME:

- **`mwenge/defender`** — <https://github.com/mwenge/defender>
- **`codesockett/williams-defender`** — <https://github.com/codesockett/williams-defender>
- **`retroric/original-defender-arcade-6809-source`** — <https://github.com/retroric/original-defender-arcade-6809-source>
- **`jeffnyman/defender-retro`** — alternative build system with ROM extraction utility: <https://github.com/jeffnyman/defender-retro>
- **`AaronBottegal/Defender-Source-Code`** — a hand-disassembly with annotations, useful for cross-referencing the official source: <https://github.com/AaronBottegal/Defender-Source-Code>

Quick-start (on Ubuntu, assuming `mwenge/defender`):

```bash
sudo apt install build-essential wine python3 mame
git clone --recurse-submodules https://github.com/mwenge/defender.git
cd defender
make redlabel                 # produces redlabel/defend.1 ... defend.12
mame defender -rompath redlabel
```

### 7.3 Reverse engineering, hardware writeups, and sound tools

- **Computer Archeology — Defender** (full hardware writeup, RAM maps, bank-by-bank disassembly with annotations): <https://computerarcheology.com/Arcade/Defender/>
- **Sean Riddle — Williams Arcade Games Info** (memory map, sprite formats, blitter info for the later games): <https://seanriddle.com/willhard.html>
- **Nameless Algorithm — Defender** (hardware analysis + partial sound ROM disassembly): <https://namelessalgorithm.com/defender/>
- **Defender Sound Studio** (in-browser JavaScript port of the 2 KB sound program with tweakable parameters): <https://zapspace.net/defender_sound/>
- **FPGA recreation paper by Jesús Arias** (rebuilds the entire video pipeline and CPU/memory map in an FPGA): <https://www.ele.uva.es/~jesus/DEFENDER/defrdx.pdf>

### 7.4 Running Defender today

The easiest way to actually play Defender on a modern machine is **MAME** (<https://www.mamedev.org/>). MAME's `williams.cpp` driver is the canonical software model of the entire Williams 6809 Rev.1 architecture — it emulates the 6809 main CPU, the 6808 sound CPU, the PIAs with their CA/CB interrupt lines, the DRAM framebuffer, the palette latches and the 4-ms / COUNT240 timing. The same driver covers Defender, Stargate, Robotron, Joust, Bubbles, Sinistar and Splat, with per-game memory map differences (Defender being the odd one out — RAM at `$0000`–`$BFFF` instead of the others' bank-switched lower 36 KB).

If you build the ROMs yourself from the open source, you do **not** need to download dubious ROM dumps — your build output is byte-identical to the released Red Label ROMs and works directly in MAME.

---

## 8. Summary table: numerical hardware specs

| Subsystem | Specification |
|---|---|
| Main CPU | Motorola MC6809E @ 1.0 MHz |
| Sound CPU | Motorola MC6808 (6800 family with internal clock) @ ~894 kHz |
| Main RAM | 48 KB DRAM (24 × 4116) |
| Framebuffer size | ~38 KB at `$0000`–`$97FF` |
| Display resolution | 304 × 256 pixels (visible ~290 × 241) |
| Color depth | 4 bpp = 16 simultaneous colors |
| Palette | 16 entries × 8 bits, BBGGGRRR (256-color total palette) |
| Display orientation | Horizontal, but tube rotated 90° (column-major framebuffer in player coords) |
| Sprite hardware | None — all CPU-drawn |
| Scroll hardware | None — framebuffer redrawn each frame |
| Blitter | None on Defender (added later for Robotron+) |
| Main CPU ROM | 26 KB (12 KB fixed + 4 × ~4 KB banks) across 11 chips |
| Sound ROM | 2 KB |
| Sound RAM | 128 bytes (internal to 6808) |
| Audio output | Single channel, 8-bit DAC, monophonic, algorithmically synthesised |
| NVRAM | 1 KB battery-backed CMOS at `$C400`–`$C7FF` |
| Frame rate | 60 Hz (vertical refresh via COUNT240 interrupt) |
| Fast timer | 4 ms / 250 Hz interrupt for game logic |
| I/O chips | 3 × MC6821 PIA (ROM board, interface board, sound board) |
| Controls | 2-way joystick + 5 buttons: Fire, Thrust, Smart Bomb, Hyperspace, Reverse |
| Watchdog | Software-kicked at `$C3FC`–`$C3FF` (write `$38`/`$39`) |
| ROM revisions | White Label → Blue Label → Green Label → Red Label |

---

## 9. References (full URL list)

- Wikipedia — Defender (1981 video game): <https://en.wikipedia.org/wiki/Defender_(1981_video_game)>
- Computer Archeology — Defender Hardware: <https://computerarcheology.com/Arcade/Defender/Hardware.html>
- Computer Archeology — Defender Sound Hardware: <https://computerarcheology.com/Arcade/Defender/SoundHardware.html>
- Computer Archeology — Defender index (RAM use, bank-by-bank disassembly): <https://computerarcheology.com/Arcade/Defender/>
- Sean Riddle — Williams Hardware Description: <https://seanriddle.com/willhard.html>
- Sean Riddle — Williams Blitter info: <https://seanriddle.com/blitter.html>
- Sean Riddle — Sprite Ripper / graphics layout: <https://seanriddle.com/ripper.html>
- Robotron-2084 — Williams Hardware Identification: <https://www.robotron-2084.co.uk/techwilliamshardwareid.html>
- Nameless Algorithm — Defender hardware + sound ROM disassembly: <https://namelessalgorithm.com/defender/>
- Defender Sound Studio (JavaScript port + annotated disassembly): <https://zapspace.net/defender_sound/>
- Defender Sound Studio help / writeup: <https://zapspace.net/defender_sound/help.html>
- Eugene Jarvis interview, Halcyon Days: <https://dadgum.com/halcyon/BOOK/JARVIS.HTM>
- Arcade Game Manual (Williams Defender), Internet Archive: <https://archive.org/stream/ArcadeGameManualDefender/defender_djvu.txt>
- rec.games.video.classic — Defender hardware specs: <https://groups.google.com/g/rec.games.video.classic/c/6Gsg136cJIA>
- Aaron Giles archive (April 2005, blitter history): <https://aarongiles.com/old/?m=200504>
- FPGA recreation paper (Jesús Arias, Universidad de Valladolid): <https://www.ele.uva.es/~jesus/DEFENDER/defrdx.pdf>
- ZEN Instruments — Williams sound disassembly: <http://zeninstruments.blogspot.com/2020/02/williams-defender-sound-disassembly.html>
- The Arcade Blogger — Robotron development (Defender background): <https://arcadeblogger.com/2020/06/27/the-development-of-robotron/>
- Retro Reversing — How retro arcade games were made: <https://www.retroreversing.com/arcade>
- GitHub: `historicalsource/defender-1`: <https://github.com/historicalsource/defender-1>
- GitHub: `historicalsource/williams-soundroms`: <https://github.com/historicalsource/williams-soundroms>
- GitHub: `mwenge/defender`: <https://github.com/mwenge/defender>
- GitHub: `codesockett/williams-defender`: <https://github.com/codesockett/williams-defender>
- GitHub: `retroric/original-defender-arcade-6809-source`: <https://github.com/retroric/original-defender-arcade-6809-source>
- GitHub: `jeffnyman/defender-retro`: <https://github.com/jeffnyman/defender-retro>
- GitHub: `AaronBottegal/Defender-Source-Code`: <https://github.com/AaronBottegal/Defender-Source-Code>
- MAME: <https://www.mamedev.org/>

---

*Document prepared as a technical reference. All hardware details cross-checked against the Williams Arcade Game Manual, Computer Archeology disassembly, Sean Riddle's notes, and the FPGA recreation paper.*

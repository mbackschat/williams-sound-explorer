# Sound Designer — open items

> Active plan for **Design mode**: only what's *open*. The full build chronology — phases 1–9, foundations, the dispatcher spike, per-phase decisions, deferred-items history (what got shipped/dropped and why) — is archived in [`done/designer-mode-v1.md`](done/designer-mode-v1.md). Reference (how it's built): [`../docs/implementation/designer_implementation.md`](../docs/implementation/designer_implementation.md).

## Done

All 5 data-driven engines shipped — **VARI · GWAVE · LFSR · FNOISE · RADIO** — with per-engine parity vs. the Defender Sound Studio on Defender, the fork-the-game item list, Open-in-Explore, and the `.bin` roundtrip. (Phase-by-phase detail → [`done/designer-mode-v1.md`](done/designer-mode-v1.md).)

## What's left (all optional — nothing required to ship)

| Item | State | Note |
|---|---|---|
| **Robotron as a VARI engine base** | deferred | Robotron's VARI dispatch is non-linear (`JMPTBL` + the `$3F` `SUBA #$39` special-case); needs different patching than Defender/Stargate's clean linear band. **Spike first.** |
| **New command *codes* per engine** (vs. override-in-place) | not on roadmap | Needs a dispatcher trampoline + table relocation (~6–8 h, niche value). Dropped for GWAVE after a spike re-eval — full analysis in [`done/designer-mode-v1.md`](done/designer-mode-v1.md) § *Deferred to v-future*. |
| **SCREAM · HYPER · ORGAN-pitch editors** | out of scope | No preset record in the ROM — would need an in-browser 6800 assembler WSED deliberately doesn't ship. |

For *why* each was deferred/dropped (the trade-off analysis), see [`done/designer-mode-v1.md`](done/designer-mode-v1.md) § *Deferred to v-future*.

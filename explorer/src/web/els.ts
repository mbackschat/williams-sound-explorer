/**
 * DOM element cache for the browser entry (`main.ts`) and its UI controllers.
 *
 * One typed handle set, populated once at module load via `getElementById`.
 * Centralised here so every controller imports the same `els` rather than
 * re-querying the DOM.  Throws on the first missing id (fail-fast at boot).
 */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not in DOM`);
  return el as T;
};

export const els = {
  pageLayout: $<HTMLDivElement>("pageLayout"),
  colSplitter: $<HTMLDivElement>("colSplitter"),
  gameSwitcher: $<HTMLDivElement>("gameSwitcher"),
  cmd: $<HTMLInputElement>("cmd"),
  fire: $<HTMLButtonElement>("fire"),
  firePaused: $<HTMLButtonElement>("firePaused"),
  pause: $<HTMLButtonElement>("pause"),
  step: $<HTMLButtonElement>("step"),
  stepDac: $<HTMLButtonElement>("stepDac"),
  stepIrq: $<HTMLButtonElement>("stepIrq"),
  pauseState: $<HTMLSpanElement>("pauseState"),
  speedReadout: $<HTMLSpanElement>("speedReadout"),
  volume: $<HTMLInputElement>("volume"),
  volumeReadout: $<HTMLSpanElement>("volumeReadout"),
  volumeMeterRms: $<HTMLDivElement>("volumeMeterRms"),
  volumeMeterPeak: $<HTMLDivElement>("volumeMeterPeak"),
  meterReadout: $<HTMLSpanElement>("meterReadout"),
  earCanvas: $<HTMLCanvasElement>("earCanvas"),
  eyeCanvas: $<HTMLCanvasElement>("eyeCanvas"),
  codePanel: $<HTMLPreElement>("codePanel"),
  spectroCanvas: $<HTMLCanvasElement>("spectroCanvas"),
  swimlaneCanvas: $<HTMLCanvasElement>("swimlaneCanvas"),
  variCanvas: $<HTMLCanvasElement>("variCanvas"),
  wavetableCanvas: $<HTMLCanvasElement>("wavetableCanvas"),
  screamCanvas: $<HTMLCanvasElement>("screamCanvas"),
  organCanvas: $<HTMLCanvasElement>("organCanvas"),
  fnoiseCanvas: $<HTMLCanvasElement>("fnoiseCanvas"),
  ramHeatmapCanvas: $<HTMLCanvasElement>("ramHeatmapCanvas"),
  explainerCard: $<HTMLDivElement>("explainerCard"),
  quizPanel: $<HTMLDivElement>("quizPanel"),
  engineStack: $<HTMLDivElement>("engineStack"),
  engineToggleRow: $<HTMLDivElement>("engineToggleRow"),
  screamBuildUp: $<HTMLButtonElement>("screamBuildUp"),
  screamTearDown: $<HTMLButtonElement>("screamTearDown"),
  screamSeqStop: $<HTMLButtonElement>("screamSeqStop"),
  organBuildUp: $<HTMLButtonElement>("organBuildUp"),
  organTearDown: $<HTMLButtonElement>("organTearDown"),
  organSeqStop: $<HTMLButtonElement>("organSeqStop"),
  hideHelpToggle: $<HTMLButtonElement>("hideHelpToggle"),
  abGameA: $<HTMLSelectElement>("abGameA"),
  abGameB: $<HTMLSelectElement>("abGameB"),
  abCmdA: $<HTMLInputElement>("abCmdA"),
  abCmdB: $<HTMLInputElement>("abCmdB"),
  abRun: $<HTMLButtonElement>("abRun"),
  abSummary: $<HTMLSpanElement>("abSummary"),
  abCanvas: $<HTMLCanvasElement>("abCanvas"),
  genealogyList: $<HTMLDivElement>("genealogyList"),
  cmdInfo: $<HTMLDivElement>("cmdInfo"),
  cmdChips: $<HTMLDivElement>("cmdChips"),
  chipLegend: $<HTMLDivElement>("chipLegend"),
  exportWav: $<HTMLButtonElement>("exportWav"),
  termList: $<HTMLDivElement>("termList"),
  termPopover: $<HTMLDivElement>("termPopover"),
  scrubStart: $<HTMLButtonElement>("scrubStart"),
  scrubLive: $<HTMLButtonElement>("scrubLive"),
  scrubReset: $<HTMLButtonElement>("scrubReset"),
  scrubMode: $<HTMLButtonElement>("scrubMode"),
  scrubPos: $<HTMLInputElement>("scrubPos"),
  scrubReadout: $<HTMLSpanElement>("scrubReadout"),
  scrubLoop: $<HTMLButtonElement>("scrubLoop"),
  scrubPlay: $<HTMLButtonElement>("scrubPlay"),
  scrubMarkers: $<HTMLDivElement>("scrubMarkers"),
  log: $<HTMLDivElement>("log"),
};

export type Els = typeof els;

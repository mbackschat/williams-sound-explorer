/**
 * Minimal type declarations for the AudioWorkletGlobalScope.
 *
 * `lib.dom.d.ts` does not (as of TS 5.7) include `AudioWorkletProcessor`,
 * `registerProcessor`, or the worklet-scope `sampleRate` global.  We declare
 * only what `worklet.ts` actually touches.  Reference via:
 *     /// <reference path="./worklet-globals.d.ts" />
 */

declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface AudioWorkletProcessorConstructor {
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
}

declare function registerProcessor(
  name: string,
  processorCtor: AudioWorkletProcessorConstructor,
): void;

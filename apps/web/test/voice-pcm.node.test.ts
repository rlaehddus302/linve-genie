// @vitest-environment node
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PCM_WORKLET_SOURCE } from '../src/voice/pcm-worklet.ts'

describe('microphone PCM worklet', () => {
  it.each([44100, 48000])('resamples stereo %s Hz input into mono 16 kHz 100 ms PCM16 frames', (sampleRate) => {
    const frames: ArrayBuffer[] = []
    let Processor: (new () => { process(input: Float32Array[][]): boolean }) | undefined
    class Base { port = { postMessage: (bytes: ArrayBuffer) => frames.push(bytes) } }
    vm.runInNewContext(PCM_WORKLET_SOURCE, { AudioWorkletProcessor: Base, sampleRate, registerProcessor: (_name: string, processor: typeof Processor) => { Processor = processor } })
    const processor = new Processor!()
    for (let offset = 0; offset < sampleRate + 128; offset += 128) expect(processor.process([[new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.75)]])).toBe(true)
    expect(frames).toHaveLength(10)
    for (const frame of frames) {
      expect(frame.byteLength).toBe(3200)
      const view = new DataView(frame)
      for (let n = 0; n < 1600; n++) expect(view.getInt16(n * 2, true)).toBe(16384)
    }
  })
})

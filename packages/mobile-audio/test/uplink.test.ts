// 소리 올리기 (APP-02, D-APP-19 (나)): 네이티브 틀 → 엔진.sendAudio(틀, 잡은 시각). 엔진이 버린 틀은 세기만 한다.
import { describe, expect, it } from 'vitest'
import { createAudioCapture, createAudioUplink, type AudioSink } from '../src/index.ts'
import { createFakeNative, frame } from './fakes.ts'

function fakeEngine(accept = true) {
  const calls: { bytes: number; capturedAt: number | undefined }[] = []
  const engine: AudioSink & { accept: boolean; calls: typeof calls } = {
    accept,
    calls,
    sendAudio(chunk, capturedAt) {
      calls.push({ bytes: chunk.byteLength, capturedAt })
      return engine.accept
    },
  }
  return engine
}

describe('createAudioUplink', () => {
  it('start는 마이크를 16kHz로 켜고, 틀마다 엔진.sendAudio(ArrayBuffer 3,200바이트, 잡은 시각)를 부른다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const engine = fakeEngine()
    const uplink = createAudioUplink({ capture, engine })
    await uplink.start()
    expect(native.starts[0]?.sampleRate).toBe(16_000)
    native.emitFrame(frame(1), 5_000)
    native.emitFrame(frame(2), 5_100)
    expect(engine.calls).toEqual([
      { bytes: 3_200, capturedAt: 5_000 },
      { bytes: 3_200, capturedAt: 5_100 },
    ])
    expect(uplink.getCounters()).toEqual({ received: 2, sent: 2, dropped: 0 })
  })

  it('엔진이 거짓(ready 전·다시 잇는 중)이면 버린 수로 센다 — 다른 곳에 모아 두지 않는다 (D-APP-05)', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const engine = fakeEngine(false)
    const uplink = createAudioUplink({ capture, engine })
    await uplink.start()
    native.emitFrame(frame(), 1)
    native.emitFrame(frame(), 2)
    engine.accept = true
    native.emitFrame(frame(), 3)
    expect(uplink.getCounters()).toEqual({ received: 3, sent: 1, dropped: 2 })
    // 다시 받기 시작한 첫 틀은 그 뒤에 잡은 소리다 — 앞서 버린 틀을 다시 보내지 않는다
    expect(engine.calls.at(-1)?.capturedAt).toBe(3)
  })

  it('잡은 시각이 없으면(NaN) 엔진에 undefined로 넘겨 엔진이 지금으로 셈하게 한다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const engine = fakeEngine()
    const uplink = createAudioUplink({ capture, engine })
    await uplink.start()
    native.emitFrame(frame(), Number.NaN)
    expect(engine.calls[0]?.capturedAt).toBeUndefined()
  })

  it('엔진이 예외를 던져도 올리기는 계속되고 버린 수로 센다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    let boom = true
    const engine: AudioSink = {
      sendAudio() {
        if (boom) throw new Error('boom')
        return true
      },
    }
    const uplink = createAudioUplink({ capture, engine })
    await uplink.start()
    native.emitFrame(frame(), 1)
    boom = false
    native.emitFrame(frame(), 2)
    expect(uplink.getCounters()).toEqual({ received: 2, sent: 1, dropped: 1 })
  })

  it('stop은 마이크를 멈추고 틀 흘리기를 끊는다; 다시 start하면 듣는 쪽을 겹쳐 달지 않는다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const engine = fakeEngine()
    const uplink = createAudioUplink({ capture, engine })
    await uplink.start()
    await uplink.stop()
    expect(native.stops).toBe(1)
    expect(uplink.getCaptureState()).toBe('OFF')
    await uplink.start()
    await uplink.stop()
    await uplink.start()
    native.emitFrame(frame(), 9)
    expect(engine.calls).toHaveLength(1)
  })

  it('마이크 상태를 그대로 보여 준다 (끼어들기 등)', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const uplink = createAudioUplink({ capture, engine: fakeEngine() })
    const seen: string[] = []
    uplink.onCaptureState((s) => seen.push(s))
    await uplink.start()
    native.emitState('INTERRUPTED')
    expect(uplink.getCaptureState()).toBe('INTERRUPTED')
    expect(seen).toEqual(['STARTING', 'LISTENING', 'INTERRUPTED'])
  })

  it('엔진이 없으면 만들 수 없다', () => {
    const capture = createAudioCapture(createFakeNative())
    expect(() => createAudioUplink({ capture, engine: {} as AudioSink })).toThrow(TypeError)
  })
})

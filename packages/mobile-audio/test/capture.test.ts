// 마이크 소리 잡기 (APP-02 AC2·AC3, D-APP-06·D-APP-11) — 가짜 네이티브로: 권한 흐름, 틀 정규화, 상태 비추기, 멈추기.
import { describe, expect, it } from 'vitest'
import { AUDIO_FRAME_BYTES, AUDIO_SAMPLE_RATE, LISTENING_NOTIFICATION_TEXT, LISTENING_NOTIFICATION_TITLE, createAudioCapture, frameBytesOf, haltReasonOf } from '../src/index.ts'
import { DENIED, GRANTED, UNDETERMINED, createFakeNative, flush, frame } from './fakes.ts'

describe('켜기·권한 (APP-01 권한 설명, D-APP-11)', () => {
  it('허락된 기기: 네이티브 start에 16,000Hz·100ms·고정 알림 문장이 그대로 간다 (APP-02 AC3)', async () => {
    const native = createFakeNative(GRANTED)
    const capture = createAudioCapture(native)
    const states: string[] = []
    capture.addStateListener((s) => states.push(s))
    await capture.start({ sampleRate: 16_000 })
    expect(native.starts).toEqual([{ sampleRate: AUDIO_SAMPLE_RATE, frameMs: 100, notificationTitle: LISTENING_NOTIFICATION_TITLE, notificationText: LISTENING_NOTIFICATION_TEXT }])
    expect(native.starts[0]?.notificationTitle + ' · ' + native.starts[0]?.notificationText).toBe('라이브지니 · 음성 듣는 중 · 눌러서 돌아가기')
    expect(native.requests).toBe(0)
    expect(capture.getState()).toBe('LISTENING')
    expect(states).toEqual(['STARTING', 'LISTENING'])
  })

  it('아직 묻지 않은 기기: 권한을 묻고 허락이면 켠다', async () => {
    const native = createFakeNative(UNDETERMINED)
    native.afterRequest = GRANTED
    const capture = createAudioCapture(native)
    await capture.start({ sampleRate: 16_000 })
    expect(native.requests).toBe(1)
    expect(native.starts).toHaveLength(1)
    expect(capture.getState()).toBe('LISTENING')
  })

  it('거절: 네이티브를 켜지 않고 HALTED(PERMISSION_DENIED), 예외 없음', async () => {
    const native = createFakeNative(UNDETERMINED)
    native.afterRequest = DENIED
    const capture = createAudioCapture(native)
    await capture.start({ sampleRate: 16_000 })
    expect(native.starts).toHaveLength(0)
    expect(capture.getState()).toBe('HALTED')
    expect(capture.getHaltReason()).toBe('PERMISSION_DENIED')
  })

  it('이미 거절된 채 다시 물을 수 없는 기기(설정에서만 바꿀 수 있음): 다시 묻지 않고 HALTED', async () => {
    const native = createFakeNative(DENIED)
    const capture = createAudioCapture(native)
    await capture.start({ sampleRate: 16_000 })
    expect(native.requests).toBe(0)
    expect(capture.getHaltReason()).toBe('PERMISSION_DENIED')
  })

  it('16,000이 아닌 표본률은 받지 않는다 (D-APP-06)', () => {
    const capture = createAudioCapture(createFakeNative())
    expect(() => capture.start({ sampleRate: 48_000 as unknown as 16_000 })).toThrow(TypeError)
  })

  it('네이티브 start가 실패하면 까닭을 가려 HALTED — 마이크 없음·권한·그 밖', async () => {
    const native = createFakeNative()
    native.startError = Object.assign(new Error('마이크를 찾지 못했어요'), { code: 'E_NO_MICROPHONE' })
    const capture = createAudioCapture(native)
    await capture.start({ sampleRate: 16_000 })
    expect(capture.getHaltReason()).toBe('NO_MICROPHONE')
    expect(native.listeners).toEqual({ frame: 0, state: 0 })
    expect(haltReasonOf({ code: 'E_PERMISSION_DENIED' })).toBe('PERMISSION_DENIED')
    expect(haltReasonOf(new Error('boom'))).toBe('DEVICE_ERROR')
    expect(haltReasonOf({ code: 'E_UNSUPPORTED' })).toBe('UNSUPPORTED')
  })

  it('켜는 중에 또 켜면 같은 켜기를 기다린다 — 네이티브 start는 한 번', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const a = capture.start({ sampleRate: 16_000 })
    const b = capture.start({ sampleRate: 16_000 })
    await Promise.all([a, b])
    expect(native.starts).toHaveLength(1)
    await capture.start({ sampleRate: 16_000 })
    expect(native.starts).toHaveLength(1)
  })
})

describe('틀 (VOC-06 AC2, D-APP-06)', () => {
  it('base64 틀 → 3,200바이트 ArrayBuffer와 잡은 시각 그대로, 새 버퍼(네이티브 것과 얽히지 않음)', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const got: { pcm: ArrayBuffer; at: number }[] = []
    capture.addFrameListener((pcm, at) => got.push({ pcm, at }))
    await capture.start({ sampleRate: 16_000 })
    const source = frame(7)
    native.emitFrame(source, 1_700_000_000_000)
    expect(got).toHaveLength(1)
    expect(got[0]!.pcm.byteLength).toBe(AUDIO_FRAME_BYTES)
    expect(new Uint8Array(got[0]!.pcm)).toEqual(source)
    expect(got[0]!.at).toBe(1_700_000_000_000)
    // 네이티브가 바이트로 줘도 같다
    native.emitFrame(source, 1_700_000_000_100)
    expect(new Uint8Array(got[1]!.pcm)).toEqual(source)
  })

  it('10초 = 틀 100개가 모두 3,200바이트로 온다 (AC-APP1-34와 같은 셈)', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    let count = 0
    let allRight = true
    capture.addFrameListener((pcm) => {
      count++
      if (pcm.byteLength !== 3_200) allRight = false
    })
    await capture.start({ sampleRate: 16_000 })
    for (let i = 0; i < 100; i++) native.emitFrame(frame(i), 1_000 + i * 100)
    expect(count).toBe(100)
    expect(allRight).toBe(true)
  })

  it('빈 틀·홀수 바이트·깨진 base64는 버린다 (예외 없음)', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    let count = 0
    capture.addFrameListener(() => count++)
    await capture.start({ sampleRate: 16_000 })
    native.emitFrame(new Uint8Array(0), 1)
    native.emitFrame(new Uint8Array(3_199), 1)
    native.emitFrame('***not base64***', 1)
    expect(count).toBe(0)
    expect(frameBytesOf({ pcm: 42 as unknown as string, capturedAtMs: 0 })).toBeNull()
  })

  it('끈 뒤 늦게 온 틀은 넘기지 않는다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    let count = 0
    capture.addFrameListener(() => count++)
    await capture.start({ sampleRate: 16_000 })
    native.emitFrame(frame(), 1)
    await capture.stop()
    native.emitFrame(frame(), 2)
    expect(count).toBe(1)
  })

  it('듣는 쪽이 예외를 던져도 다른 듣는 쪽은 받는다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    let count = 0
    capture.addFrameListener(() => {
      throw new Error('boom')
    })
    capture.addFrameListener(() => count++)
    await capture.start({ sampleRate: 16_000 })
    native.emitFrame(frame(), 1)
    expect(count).toBe(1)
  })
})

describe('상태·끄기 (APP-02 끄기·AC2)', () => {
  it('끼어들기(전화)·마이크 뺏김 → INTERRUPTED, 네이티브가 다시 잡으면 LISTENING — JS가 다시 start를 부르지 않는다', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const states: string[] = []
    capture.addStateListener((s) => states.push(s))
    await capture.start({ sampleRate: 16_000 })
    native.emitState('INTERRUPTED')
    expect(capture.getState()).toBe('INTERRUPTED')
    native.emitState('LISTENING')
    expect(capture.getState()).toBe('LISTENING')
    expect(native.starts).toHaveLength(1)
    expect(states).toEqual(['STARTING', 'LISTENING', 'INTERRUPTED', 'LISTENING'])
    // 끼어든 채로 start를 또 불러도 네이티브를 다시 켜지 않는다 (네이티브가 스스로 돌아온다)
    native.emitState('INTERRUPTED')
    await capture.start({ sampleRate: 16_000 })
    expect(native.starts).toHaveLength(1)
  })

  it('네이티브가 멈췄다고 알리면(HALTED·OFF) HALTED와 까닭', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    await capture.start({ sampleRate: 16_000 })
    native.emitState('HALTED', 'NO_MICROPHONE')
    expect(capture.getState()).toBe('HALTED')
    expect(capture.getHaltReason()).toBe('NO_MICROPHONE')
    native.emitState('LISTENING')
    native.emitState('OFF')
    expect(capture.getHaltReason()).toBe('DEVICE_ERROR')
    native.emitState('HALTED', '???')
    expect(capture.getHaltReason()).toBe('DEVICE_ERROR')
  })

  it('"음성 끄기": 네이티브 stop을 바로 부르고(1초 기다림 없음) 듣기를 끊는다, OFF', async () => {
    const native = createFakeNative()
    const capture = createAudioCapture(native)
    const states: string[] = []
    capture.addStateListener((s) => states.push(s))
    await capture.start({ sampleRate: 16_000 })
    const stopping = capture.stop()
    // 기다리기 전에 이미 네이티브 stop이 불렸고 상태는 OFF
    expect(native.stops).toBe(1)
    expect(capture.getState()).toBe('OFF')
    await stopping
    expect(native.running).toBe(false)
    expect(native.listeners).toEqual({ frame: 0, state: 0 })
    expect(states.at(-1)).toBe('OFF')
    // 꺼진 채 stop을 또 불러도 네이티브 stop은 한 번
    await capture.stop()
    expect(native.stops).toBe(1)
  })

  it('켜는 중(권한 묻는 사이)에 끄면 네이티브를 켜지 않는다', async () => {
    const native = createFakeNative(UNDETERMINED)
    let release: (() => void) | undefined
    native.requestPermission = () =>
      new Promise((resolve) => {
        release = () => resolve(GRANTED)
      })
    const capture = createAudioCapture(native)
    const starting = capture.start({ sampleRate: 16_000 })
    await flush()
    await capture.stop()
    release!()
    await starting
    expect(native.starts).toHaveLength(0)
    expect(capture.getState()).toBe('OFF')
  })

  it('네이티브 상태 사건이 늦어도 틀이 오면 듣는 중이다', async () => {
    const native = createFakeNative()
    native.start = async () => {
      native.running = true
    }
    const capture = createAudioCapture(native)
    const starting = capture.start({ sampleRate: 16_000 })
    await flush()
    native.emitFrame(frame(), 1)
    await starting
    expect(capture.getState()).toBe('LISTENING')
  })

  it('네이티브 모듈이 없으면 만들 수 없다', () => {
    expect(() => createAudioCapture(undefined as never)).toThrow(TypeError)
  })
})

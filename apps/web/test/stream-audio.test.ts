import { describe, expect, it } from 'vitest'
import { STREAM_AUDIO_LATE, STREAM_AUDIO_LISTENING, STREAM_AUDIO_MIC, STREAM_AUDIO_RECONNECTING, STREAM_AUDIO_STOPPED, STREAM_AUDIO_UNSUPPORTED, readStreamAudioStatus, streamAudioLine } from '../src/lib/stream-audio.ts'

describe('방송 소리 상태 줄 (LV1 VOC-08)', () => {
  it('듣는 중·늦음·끊김·멈춤·받을 수 없음 문장', () => {
    expect(streamAudioLine({ phase: 'listening', lagMs: 1000 }, false)).toMatchObject({ text: STREAM_AUDIO_LISTENING, late: null, useMic: false })
    expect(streamAudioLine({ phase: 'listening', lagMs: 20_001 }, false)).toMatchObject({ late: STREAM_AUDIO_LATE, useMic: true })
    expect(streamAudioLine({ phase: 'listening', lagMs: 20_000 }, false)?.late).toBeNull()
    expect(streamAudioLine({ phase: 'reconnecting' }, false)?.text).toBe(STREAM_AUDIO_RECONNECTING)
    expect(streamAudioLine({ phase: 'stopped' }, false)).toMatchObject({ text: STREAM_AUDIO_STOPPED, tone: 'danger', retry: true, useMic: true })
    expect(streamAudioLine({ phase: 'unsupported' }, false)?.text).toBe(STREAM_AUDIO_UNSUPPORTED)
  })
  it('마이크를 켜면 마이크가 듣는 곳', () => {
    expect(streamAudioLine({ phase: 'listening' }, true)?.text).toBe(STREAM_AUDIO_MIC)
    expect(streamAudioLine({ phase: 'mic' }, false)?.text).toBe(STREAM_AUDIO_MIC)
  })
  it('운영자가 끄면 줄이 없다, 모르는 값도 숨김', () => {
    expect(streamAudioLine({ phase: 'hidden' }, false)).toBeNull()
    expect(streamAudioLine(readStreamAudioStatus({ phase: 'HLS_ERROR' }), false)).toBeNull()
    expect(readStreamAudioStatus({ phase: 'listening', lagMs: 5 })).toEqual({ phase: 'listening', lagMs: 5 })
  })
  it('문장에 영어·기술 이름이 없다', () => {
    for (const text of [STREAM_AUDIO_LATE, STREAM_AUDIO_LISTENING, STREAM_AUDIO_MIC, STREAM_AUDIO_RECONNECTING, STREAM_AUDIO_STOPPED, STREAM_AUDIO_UNSUPPORTED]) expect(text).not.toMatch(/[A-Za-z]/)
  })
})

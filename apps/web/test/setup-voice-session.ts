// 시험마다 앱 전체 음성(D-V3-52 — 콘솔을 떠나도 켜진 채)을 끝낸다: 앞 시험의 켠 음성이 다음 시험 콘솔에 남지 않게
import { afterEach } from 'vitest'
import { endVoiceSession, getVoiceSession } from '../src/voice/session.ts'

afterEach(() => {
  endVoiceSession(getVoiceSession(), true)
})

// 서버 입구 약속(가정) — 주소·봉투 모양·토큰 모양. 약속이 나오면 이 시험과 contract.ts를 같이 맞춘다.
import { describe, expect, it } from 'vitest'
import {
  DEVICE_ID_PATTERN,
  DEVICE_TOKEN_PATTERN,
  ENVELOPE_FIELDS,
  NOTICE_BODY_MAX_CHARS,
  NOTICE_CONTRACT_STATUS,
  NOTICE_INTAKE_PATH,
  isNoticeEnvelope,
  noticeIntakeUrl,
} from '../src/index.ts'

const envelope = {
  kindHint: 'sms',
  sourceType: 'sms_number',
  source: '01012345678',
  body: '찜 3번',
  receivedAtMs: 1_761_800_000_000,
  sentAtMs: 1_761_800_000_500,
  deviceId: 'phone-a',
  localId: 'd914f7dd6f9f0a83bd9053d4a95960a3',
}

describe('약속 상태', () => {
  it('지금은 가정 — 봉투 칸 8개', () => {
    expect(NOTICE_CONTRACT_STATUS).toBe('ASSUMED')
    expect([...ENVELOPE_FIELDS]).toEqual(['kindHint', 'sourceType', 'source', 'body', 'receivedAtMs', 'sentAtMs', 'deviceId', 'localId'])
    expect(NOTICE_INTAKE_PATH).toBe('/api/inbox/messages')
  })
})

describe('입구 주소', () => {
  it('https 서버 주소 + 경로 (끝 빗금·하위 경로 유지, 질의·조각 버림)', () => {
    expect(noticeIntakeUrl('https://livejjim.example')).toBe(`https://livejjim.example${NOTICE_INTAKE_PATH}`)
    expect(noticeIntakeUrl('https://livejjim.example/')).toBe(`https://livejjim.example${NOTICE_INTAKE_PATH}`)
    expect(noticeIntakeUrl('https://livejjim.example:8443/app/?x=1#y')).toBe(`https://livejjim.example:8443/app${NOTICE_INTAKE_PATH}`)
  })
  it('토큰이 실리므로 http는 개발용 루프백만', () => {
    expect(noticeIntakeUrl('http://10.0.2.2:3000')).toBe(`http://10.0.2.2:3000${NOTICE_INTAKE_PATH}`)
    expect(noticeIntakeUrl('http://localhost:7760')).toBe(`http://localhost:7760${NOTICE_INTAKE_PATH}`)
    expect(noticeIntakeUrl('http://127.0.0.1:7760')).toBe(`http://127.0.0.1:7760${NOTICE_INTAKE_PATH}`)
    expect(noticeIntakeUrl('http://192.168.0.10:3000')).toBeNull()
    expect(noticeIntakeUrl('http://livejjim.example')).toBeNull()
  })
  it('틀린 주소·다른 방식·주소 안 계정은 받지 않는다', () => {
    for (const bad of ['', 'livejjim.example', 'ftp://livejjim.example', 'javascript:alert(1)', 'https://user:pw@livejjim.example', 'wss://livejjim.example']) {
      expect(noticeIntakeUrl(bad), bad).toBeNull()
    }
  })
})

describe('봉투 모양', () => {
  it('맞는 봉투', () => {
    expect(isNoticeEnvelope(envelope)).toBe(true)
    expect(isNoticeEnvelope({ ...envelope, kindHint: 'bank', sourceType: 'app_package', source: 'com.kbstar.kbbank' })).toBe(true)
  })
  it('칸이 빠지거나 더 있으면 아니다', () => {
    const { localId: _localId, ...missing } = envelope
    expect(isNoticeEnvelope(missing)).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, phone: '010' })).toBe(false)
  })
  it('값이 틀리면 아니다', () => {
    expect(isNoticeEnvelope({ ...envelope, kindHint: 'kakao' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, sourceType: 'number' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, source: '' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, body: '' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, body: 'x'.repeat(NOTICE_BODY_MAX_CHARS + 1) })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, receivedAtMs: 1.5 })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, sentAtMs: '1' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, deviceId: 'a b' })).toBe(false)
    expect(isNoticeEnvelope({ ...envelope, localId: 'D914F7DD6F9F0A83BD9053D4A95960A3' })).toBe(false)
    expect(isNoticeEnvelope(null)).toBe(false)
    expect(isNoticeEnvelope('{}')).toBe(false)
  })
})

describe('토큰·기기 번호 모양', () => {
  it('토큰: b64token 16~512자', () => {
    expect(DEVICE_TOKEN_PATTERN.test('abcDEF0123456789_-')).toBe(true)
    expect(DEVICE_TOKEN_PATTERN.test('abc.def~ghi+jkl/mno==')).toBe(true)
    expect(DEVICE_TOKEN_PATTERN.test('short')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('has space 0123456789')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('줄바꿈\n0123456789abcdef')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('a'.repeat(513))).toBe(false)
  })
  it('기기 번호: 영문·숫자·._:- 1~128자', () => {
    expect(DEVICE_ID_PATTERN.test('phone-a_1')).toBe(true)
    expect(DEVICE_ID_PATTERN.test('')).toBe(false)
    expect(DEVICE_ID_PATTERN.test('a/b')).toBe(false)
  })
})

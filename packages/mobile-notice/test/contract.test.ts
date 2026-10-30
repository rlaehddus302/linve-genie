// 서버 받는 입구 약속 (SPEC ORD-13 C-04) — 주소·요청 모양·한도·토큰 모양.
import { describe, expect, it } from 'vitest'
import {
  DEVICE_NAME_MAX_CHARS,
  DEVICE_TOKEN_PATTERN,
  INBOX_BATCH_MAX,
  INBOX_MESSAGE_FIELDS,
  INBOX_REQUEST_FIELDS,
  NOTICE_CONTRACT_STATUS,
  NOTICE_INTAKE_PATH,
  NOTICE_QUEUE_MAX,
  NOTICE_TEXT_MAX_CHARS,
  TOO_MANY_WAIT_MS,
  cleanDeviceName,
  isInboxMessage,
  isInboxRequest,
  noticeIntakeUrl,
  type InboxMessage,
} from '../src/index.ts'

const message: InboxMessage = { id: 'a0220353186dd4a2e44dfafe4cb8eb18', channel: 'SMS', from: '01012345678', title: null, text: '찜 3번', receivedAt: 1_761_800_000_000 }

describe('약속 상태·한도', () => {
  it('스펙 C-04: 경로 하나, 칸, 한도', () => {
    expect(NOTICE_CONTRACT_STATUS).toBe('SPEC')
    expect(NOTICE_INTAKE_PATH).toBe('/api/inbox/messages')
    expect([...INBOX_REQUEST_FIELDS]).toEqual(['device', 'messages'])
    expect([...INBOX_MESSAGE_FIELDS]).toEqual(['id', 'channel', 'from', 'title', 'text', 'receivedAt'])
    expect(INBOX_BATCH_MAX).toBe(20)
    expect(NOTICE_TEXT_MAX_CHARS).toBe(1_000)
    expect(DEVICE_NAME_MAX_CHARS).toBe(30)
    expect(TOO_MANY_WAIT_MS).toBe(60_000)
    expect(NOTICE_QUEUE_MAX).toBe(200)
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

describe('요청 모양', () => {
  it('맞는 메시지·요청 (0건 요청은 filters만 받기)', () => {
    expect(isInboxMessage(message)).toBe(true)
    expect(isInboxMessage({ ...message, from: null })).toBe(true)
    expect(isInboxMessage({ ...message, channel: 'APP', from: 'com.kbstar.kbbank', title: '입금' })).toBe(true)
    expect(isInboxRequest({ device: '내 갤럭시', messages: [message] })).toBe(true)
    expect(isInboxRequest({ device: '내 갤럭시', messages: [] })).toBe(true)
  })
  it('칸이 빠지거나 더 있거나 값이 틀리면 아니다', () => {
    const { id: _id, ...missing } = message
    for (const bad of [
      missing,
      { ...message, phone: '010' },
      { ...message, id: '' },
      { ...message, id: 'x'.repeat(65) },
      { ...message, channel: 'KAKAO' },
      { ...message, from: '' },
      { ...message, title: '문자에는 제목 없음' },
      { ...message, text: '' },
      { ...message, text: 'x'.repeat(NOTICE_TEXT_MAX_CHARS + 1) },
      { ...message, receivedAt: 1.5 },
      { ...message, receivedAt: '1761800000000' },
      null,
    ]) {
      expect(isInboxMessage(bad), JSON.stringify(bad)?.slice(0, 60)).toBe(false)
    }
    expect(isInboxRequest({ device: '', messages: [] })).toBe(false)
    expect(isInboxRequest({ device: 'x'.repeat(31), messages: [] })).toBe(false)
    expect(isInboxRequest({ device: '폰', messages: Array.from({ length: 21 }, () => message) })).toBe(false)
    expect(isInboxRequest({ device: '폰', messages: [], extra: 1 })).toBe(false)
  })
})

describe('기기 이름·토큰 모양', () => {
  it('기기 이름: 앞뒤 빈칸 빼고 1~30자, 제어 문자 없음', () => {
    expect(cleanDeviceName('  내 갤럭시 S23 ')).toBe('내 갤럭시 S23')
    expect(cleanDeviceName('가'.repeat(30))).toBe('가'.repeat(30))
    expect(cleanDeviceName('가'.repeat(31))).toBeNull()
    expect(cleanDeviceName('   ')).toBeNull()
    expect(cleanDeviceName('폰\n1')).toBeNull()
    expect(cleanDeviceName(3)).toBeNull()
  })
  it('토큰: b64token 16~512자', () => {
    expect(DEVICE_TOKEN_PATTERN.test('abcDEF0123456789_-')).toBe(true)
    expect(DEVICE_TOKEN_PATTERN.test('abc.def~ghi+jkl/mno==')).toBe(true)
    expect(DEVICE_TOKEN_PATTERN.test('short')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('has space 0123456789')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('줄바꿈\n0123456789abcdef')).toBe(false)
    expect(DEVICE_TOKEN_PATTERN.test('a'.repeat(513))).toBe(false)
  })
})

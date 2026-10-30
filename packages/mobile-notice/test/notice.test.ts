// JS API (start/stop/getState/addStateListener/openSettings/setToken/flush) — 가짜 네이티브로.
import { describe, expect, it, vi } from 'vitest'
import { createFakeNoticeNative } from '../src/fake.ts'
import {
  NOTICE_INTAKE_PATH,
  NoticeInputError,
  createNoticeIntake,
  normalizeFlushResult,
  normalizeNoticeState,
  NOTICE_INTENT_TITLE,
  NOTICE_SHORTCUT_GUIDE,
  noticeCountLine,
  noticeDroppedLine,
  noticeStatusLine,
  type NativeNoticeModuleLike,
  type NoticeState,
} from '../src/index.ts'

const TOKEN = 'dev_token_0123456789abcdef'

describe('상태 고치기', () => {
  it('모르는 칸·틀린 값은 안전한 쪽(꺼짐·0건·모름)', () => {
    const state = normalizeNoticeState({ platform: 'web', enabled: 'yes', access: 'all', pending: -1, sent: 1.5, lastSentAtMs: 0, lastError: 'BOOM', bankApps: ['a.b', 3], smsApp: 3, batteryOptimized: 'no' })
    expect(state).toEqual({
      platform: 'fake',
      enabled: false,
      access: 'needed',
      connected: false,
      hasToken: false,
      tokenRejected: false,
      inboxOff: false,
      pending: 0,
      sent: 0,
      ignored: 0,
      filtered: 0,
      duplicates: 0,
      rejected: 0,
      dropped: 0,
      lastQueuedAtMs: null,
      lastSentAtMs: null,
      lastError: null,
      bankApps: ['a.b'],
      smsApp: null,
      batteryOptimized: null,
      hasFilters: false,
    })
    expect(normalizeNoticeState(null).enabled).toBe(false)
    expect(normalizeNoticeState({ platform: 'ios' }).access).toBe('shortcut')
  })
  it('보내기 결과', () => {
    expect(normalizeFlushResult({ sent: 2, pending: 1, stoppedBy: 'NETWORK' })).toEqual({ sent: 2, pending: 1, stoppedBy: 'NETWORK' })
    expect(normalizeFlushResult({ stoppedBy: 'NO_TOKEN' })).toEqual({ sent: 0, pending: 0, stoppedBy: 'NO_TOKEN' })
    expect(normalizeFlushResult({ sent: 'x', stoppedBy: 'X' })).toEqual({ sent: 0, pending: 0, stoppedBy: null })
    expect(normalizeFlushResult(undefined)).toEqual({ sent: 0, pending: 0, stoppedBy: null })
  })
})

describe('입력 검사 — 틀린 값은 네이티브에 가지 않는다', () => {
  const spyNative = () => {
    const fake = createFakeNoticeNative()
    const setToken = vi.spyOn(fake, 'setToken')
    return { fake, setToken, intake: createNoticeIntake(fake) }
  }

  it('토큰: 서버 주소 + 약속 경로, 다듬은 기기 이름을 네이티브에 넘긴다', async () => {
    const { intake, setToken } = spyNative()
    const state = await intake.setToken({ token: ` ${TOKEN} `, serverUrl: 'https://livejjim.example', deviceName: ' 내 갤럭시 ' })
    expect(setToken).toHaveBeenCalledWith(TOKEN, `https://livejjim.example${NOTICE_INTAKE_PATH}`, '내 갤럭시')
    expect(state.hasToken).toBe(true)
  })
  it('http 주소·틀린 토큰·틀린 기기 이름', async () => {
    const { intake, setToken } = spyNative()
    await expect(intake.setToken({ token: TOKEN, serverUrl: 'http://livejjim.example', deviceName: '폰' })).rejects.toMatchObject({ code: 'SERVER_URL' })
    await expect(intake.setToken({ token: 'short', serverUrl: 'https://livejjim.example', deviceName: '폰' })).rejects.toMatchObject({ code: 'TOKEN' })
    await expect(intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '' })).rejects.toMatchObject({ code: 'DEVICE_NAME' })
    await expect(intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '가'.repeat(31) })).rejects.toMatchObject({ code: 'DEVICE_NAME' })
    expect(setToken).not.toHaveBeenCalled()
    const error = await intake.setToken({ token: 'secretvalue with space', serverUrl: 'https://a.example', deviceName: 'p' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NoticeInputError)
    // 화면 문장에 토큰 값이 실리지 않는다
    expect(String((error as Error).message)).not.toContain('secretvalue')
  })
  it('토큰 지우기', async () => {
    const { intake } = spyNative()
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceName: '폰' })
    expect((await intake.setToken(null)).hasToken).toBe(false)
  })
  it('은행 앱 고르기·거르기 규칙 넣기는 없다 — 서버 filters만 쓴다(C-03)', () => {
    const intake = createNoticeIntake(createFakeNoticeNative()) as unknown as Record<string, unknown>
    expect(intake.setAllowedPackages).toBeUndefined()
    expect(intake.setFilterRules).toBeUndefined()
  })
})

describe('켜기·끄기·상태 듣기·설정 열기', () => {
  it('켜면 enabled, 상태 사건은 듣는 동안만 구독', async () => {
    const fake = createFakeNoticeNative({ platform: 'android', now: () => 1_000 })
    const intake = createNoticeIntake(fake)
    const seen: NoticeState[] = []
    const off = intake.addStateListener((s) => seen.push(s))
    expect(fake.listenerCount).toBe(1)
    const second = intake.addStateListener(() => undefined)
    expect(fake.listenerCount).toBe(1)
    expect((await intake.start()).enabled).toBe(true)
    expect(seen.at(-1)?.enabled).toBe(true)
    expect((await intake.stop()).enabled).toBe(false)
    expect(seen.at(-1)?.enabled).toBe(false)
    off()
    second()
    expect(fake.listenerCount).toBe(0)
  })
  it('알림 읽기 허용 전: 켠 채로 access needed — 허용하면 granted·connected', async () => {
    const fake = createFakeNoticeNative({ platform: 'android', accessGranted: false })
    const intake = createNoticeIntake(fake)
    const state = await intake.start()
    expect(state).toMatchObject({ enabled: true, access: 'needed', connected: false })
    expect(noticeStatusLine(state)).toBe('알림 읽기가 꺼져 있어요')
    fake.setAccess(true)
    expect(await intake.getState()).toMatchObject({ access: 'granted', connected: true })
  })
  it('설정 열기: 기본은 알림 읽기 화면, 모르는 화면·네이티브 예외는 false', async () => {
    const fake = createFakeNoticeNative({ platform: 'android' })
    const intake = createNoticeIntake(fake)
    expect(await intake.openSettings()).toBe(true)
    expect(await intake.openSettings('battery')).toBe(true)
    expect(await intake.openSettings('nope' as never)).toBe(false)
    expect(fake.openedSettings).toEqual(['notificationAccess', 'battery'])
    const broken = { ...fake, openSettings: () => Promise.reject(new Error('no activity')) } as NativeNoticeModuleLike
    expect(await createNoticeIntake(broken).openSettings('app')).toBe(false)
  })
})

describe('화면 문장 (쉬운 한국어, 영어 상태값 없음)', () => {
  const base = normalizeNoticeState({ platform: 'android', enabled: true, access: 'granted', connected: true, hasToken: true })
  it('상태 줄', () => {
    expect(noticeStatusLine({ ...base, enabled: false })).toBe('꺼져 있어요')
    expect(noticeStatusLine({ ...base, hasToken: false })).toBe('받기 토큰을 넣어 주세요')
    expect(noticeStatusLine({ ...base, tokenRejected: true })).toBe('받기 토큰을 다시 넣어 주세요')
    expect(noticeStatusLine({ ...base, pending: 3, lastError: 'NETWORK' })).toBe('인터넷이 끊겨 3건을 모아 두었어요. 연결되면 바로 보내요')
    expect(noticeStatusLine({ ...base, pending: 2, lastError: 'SERVER' })).toBe('2건을 보내지 못했어요. 잠시 뒤 다시 보내요')
    expect(noticeStatusLine({ ...base, pending: 2, lastError: 'BUSY' })).toBe('2건을 1분 뒤에 다시 보내요')
    expect(noticeStatusLine({ ...base, pending: 1 })).toBe('1건 보내는 중이에요')
    expect(noticeStatusLine({ ...base, connected: false })).toContain('알림 읽기를 아직 붙이지 않았어요')
    expect(noticeStatusLine(base)).toBe('문자를 보내고 있어요. 은행 앱 목록은 서버에 연결되면 받아요')
    expect(noticeStatusLine({ ...base, hasFilters: true })).toBe('문자와 은행 앱 알림을 보내고 있어요')
    expect(noticeStatusLine({ ...base, platform: 'ios', access: 'shortcut', connected: false })).toBe('단축어로 받은 문자를 보내고 있어요')
  })
  it('건수 줄', () => {
    expect(noticeCountLine({ ...base, sent: 5 })).toBe('보냄 5건')
    expect(noticeCountLine({ ...base, sent: 5, ignored: 3, filtered: 2, duplicates: 1, rejected: 1, dropped: 1 })).toBe(
      '보냄 5건 · 찜·입금 아님 3건 · 광고·인증 문자 거름 2건 · 겹침 1건 · 서버가 받지 않음 1건',
    )
  })
  it('버린 알림 줄 (D-SMS3-28)', () => {
    expect(noticeDroppedLine({ ...base, dropped: 0 })).toBeNull()
    expect(noticeDroppedLine({ ...base, dropped: 12 })).toBe('보내지 못하고 버린 알림이 12건 있어요. 은행 앱에서 입금을 확인해 주세요')
  })
  it('받기 꺼짐(403) 줄 (D-SMS3-27) — 토큰 거절이 먼저', () => {
    expect(noticeStatusLine({ ...base, inboxOff: true, pending: 3 })).toBe('웹 설정에서 휴대폰 알림 받기가 꺼져 있어요. 켜면 모아 둔 알림을 보내요')
    expect(noticeStatusLine({ ...base, inboxOff: true, tokenRejected: true })).toBe('받기 토큰을 다시 넣어 주세요')
  })
  it('모든 문장에 영문 상태값이 없다', () => {
    const lines = [
      noticeStatusLine(base),
      noticeStatusLine({ ...base, pending: 3, lastError: 'NETWORK' }),
      noticeStatusLine({ ...base, pending: 3, lastError: 'SERVER' }),
      noticeStatusLine({ ...base, pending: 3, lastError: 'BUSY' }),
      noticeStatusLine({ ...base, hasFilters: true }),
      noticeStatusLine({ ...base, tokenRejected: true }),
      noticeCountLine({ ...base, sent: 1, ignored: 1, filtered: 1, duplicates: 1, rejected: 1, dropped: 1 }),
      noticeStatusLine({ ...base, inboxOff: true }),
      noticeDroppedLine({ dropped: 1 }) ?? '',
    ]
    for (const line of lines) expect(line).not.toMatch(/[A-Za-z]/)
  })
})

describe('아이폰 단축어 안내 (D-SMS3-23)', () => {
  it('판매자에게 보이는 안내는 웹 설정의 "URL 콘텐츠 가져오기" 한 가지 — 앱의 단축어 동작을 권하지 않는다', () => {
    expect(NOTICE_SHORTCUT_GUIDE).toContain('URL 콘텐츠 가져오기')
    expect(NOTICE_SHORTCUT_GUIDE).toContain('아이폰 단축어 만들기 안내')
    expect(NOTICE_SHORTCUT_GUIDE).not.toContain(NOTICE_INTENT_TITLE)
    expect(NOTICE_SHORTCUT_GUIDE).not.toContain('문자 보내기')
  })
})

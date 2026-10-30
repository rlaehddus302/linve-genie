// JS API (start/stop/getState/addStateListener/openSettings/setAllowedPackages/setToken/setFilterRules/flush) — 가짜 네이티브로.
import { describe, expect, it, vi } from 'vitest'
import { createFakeNoticeNative } from '../src/fake.ts'
import {
  NOTICE_INTAKE_PATH,
  NoticeInputError,
  createNoticeIntake,
  normalizeFlushResult,
  normalizeNoticeState,
  noticeCountLine,
  noticeStatusLine,
  type NativeNoticeModuleLike,
  type NoticeState,
} from '../src/index.ts'

const TOKEN = 'dev_token_0123456789abcdef'

describe('상태 고치기', () => {
  it('모르는 칸·틀린 값은 안전한 쪽(꺼짐·0건·모름)', () => {
    const state = normalizeNoticeState({ platform: 'web', enabled: 'yes', access: 'all', pending: -1, sent: 1.5, lastSentAtMs: 0, lastError: 'BOOM', bankPackages: ['a.b', 3], batteryOptimized: 'no' })
    expect(state).toEqual({
      platform: 'fake',
      enabled: false,
      access: 'needed',
      connected: false,
      hasToken: false,
      tokenRejected: false,
      pending: 0,
      sent: 0,
      filtered: 0,
      duplicates: 0,
      rejected: 0,
      dropped: 0,
      lastQueuedAtMs: null,
      lastSentAtMs: null,
      lastError: null,
      bankPackages: ['a.b'],
      batteryOptimized: null,
      serverRules: false,
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
    const setAllowed = vi.spyOn(fake, 'setAllowedPackages')
    const setRules = vi.spyOn(fake, 'setFilterRules')
    return { fake, setToken, setAllowed, setRules, intake: createNoticeIntake(fake) }
  }

  it('토큰: 서버 주소 + 약속 경로를 네이티브에 넘긴다', async () => {
    const { intake, setToken } = spyNative()
    const state = await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    expect(setToken).toHaveBeenCalledWith(TOKEN, `https://livejjim.example${NOTICE_INTAKE_PATH}`, 'phone-a')
    expect(state.hasToken).toBe(true)
  })
  it('http 주소·틀린 토큰·틀린 기기 번호', async () => {
    const { intake, setToken } = spyNative()
    await expect(intake.setToken({ token: TOKEN, serverUrl: 'http://livejjim.example', deviceId: 'phone-a' })).rejects.toMatchObject({ code: 'SERVER_URL' })
    await expect(intake.setToken({ token: 'short', serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })).rejects.toMatchObject({ code: 'TOKEN' })
    await expect(intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: '' })).rejects.toMatchObject({ code: 'DEVICE_ID' })
    expect(setToken).not.toHaveBeenCalled()
    const error = await intake.setToken({ token: 'secretvalue with space', serverUrl: 'https://a.example', deviceId: 'p' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NoticeInputError)
    // 화면 문장에 토큰 값이 실리지 않는다
    expect(String((error as Error).message)).not.toContain('secretvalue')
  })
  it('토큰 지우기', async () => {
    const { intake } = spyNative()
    await intake.setToken({ token: TOKEN, serverUrl: 'https://livejjim.example', deviceId: 'phone-a' })
    expect((await intake.setToken(null)).hasToken).toBe(false)
  })
  it('은행 앱: 메신저는 막고 쉬운 문장', async () => {
    const { intake, setAllowed } = spyNative()
    await expect(intake.setAllowedPackages(['com.kakao.talk'])).rejects.toThrow('카카오톡 같은 대화 앱은')
    expect(setAllowed).not.toHaveBeenCalled()
    const state = await intake.setAllowedPackages(['com.kbstar.kbbank', 'com.kbstar.kbbank'])
    expect(setAllowed).toHaveBeenCalledWith(['com.kbstar.kbbank'])
    expect(state.bankPackages).toEqual(['com.kbstar.kbbank'])
  })
  it('거르기 규칙: 틀린 목록은 넘기지 않고, null은 기본 규칙으로', async () => {
    const { intake, setRules } = spyNative()
    await expect(intake.setFilterRules([{ id: 'x', field: 'body', op: 'regex', value: '.*' }])).rejects.toMatchObject({ code: 'FILTER_RULES' })
    expect(setRules).not.toHaveBeenCalled()
    expect((await intake.setFilterRules([{ id: 'x', field: 'body', op: 'contains', value: '출금' }])).serverRules).toBe(true)
    expect(setRules).toHaveBeenLastCalledWith('[{"id":"x","field":"body","op":"contains","value":"출금"}]')
    expect((await intake.setFilterRules(null)).serverRules).toBe(false)
    expect(setRules).toHaveBeenLastCalledWith('')
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
    expect(noticeStatusLine(state)).toBe('알림 읽기를 허용해 주세요')
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
    expect(noticeStatusLine({ ...base, hasToken: false })).toBe('라이브지니 서버와 연결이 필요해요')
    expect(noticeStatusLine({ ...base, tokenRejected: true })).toBe('연결이 풀렸어요. 다시 켜 주세요')
    expect(noticeStatusLine({ ...base, pending: 3, lastError: 'NETWORK' })).toBe('인터넷이 끊겨 3건을 모아 두었어요. 연결되면 바로 보내요')
    expect(noticeStatusLine({ ...base, pending: 2, lastError: 'SERVER' })).toBe('2건을 보내지 못했어요. 잠시 뒤 다시 보내요')
    expect(noticeStatusLine({ ...base, pending: 1 })).toBe('1건 보내는 중이에요')
    expect(noticeStatusLine({ ...base, connected: false })).toContain('알림 읽기를 아직 붙이지 않았어요')
    expect(noticeStatusLine(base)).toBe('문자·입금 알림을 받고 있어요')
    expect(noticeStatusLine({ ...base, platform: 'ios', access: 'shortcut', connected: false })).toBe('단축어로 넣은 문자를 받고 있어요')
  })
  it('건수 줄', () => {
    expect(noticeCountLine({ ...base, sent: 5 })).toBe('보냄 5건')
    expect(noticeCountLine({ ...base, sent: 5, filtered: 2, duplicates: 1, rejected: 1, dropped: 1 })).toBe(
      '보냄 5건 · 인증번호·광고 거름 2건 · 겹침 1건 · 서버가 받지 않음 1건 · 넘쳐서 못 담음 1건',
    )
  })
  it('모든 문장에 영문 상태값이 없다', () => {
    const lines = [
      noticeStatusLine(base),
      noticeStatusLine({ ...base, pending: 3, lastError: 'NETWORK' }),
      noticeStatusLine({ ...base, pending: 3, lastError: 'SERVER' }),
      noticeStatusLine({ ...base, tokenRejected: true }),
      noticeCountLine({ ...base, sent: 1, filtered: 1, duplicates: 1, rejected: 1, dropped: 1 }),
    ]
    for (const line of lines) expect(line).not.toMatch(/[A-Za-z]/)
  })
})

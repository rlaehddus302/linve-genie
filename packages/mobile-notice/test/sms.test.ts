// 문자 직접 받기 JS API (SMS4) — 상태 고치기·옛 모듈·권한 요청 실패
import { describe, expect, it } from 'vitest'
import { createFakeNoticeNative } from '../src/fake.ts'
import { createNoticeIntake, createSmsLink, normalizeSmsState, type NativeNoticeModuleLike, type NativeSmsState } from '../src/index.ts'

describe('문자 상태 고치기', () => {
  it('모르는 값은 꺼짐·권한 없음', () => {
    expect(normalizeSmsState({ available: 'yes', permission: 'all', enabled: true, active: true, lastScanAtMs: -5 })).toEqual({
      available: false,
      permission: 'needed',
      enabled: false,
      active: false,
      lastScanAtMs: null,
    })
    expect(normalizeSmsState(null).available).toBe(false)
  })

  it('권한이 없으면 켬이어도 읽는 중이 아니다', () => {
    expect(normalizeSmsState({ available: true, permission: 'needed', enabled: true, active: true })).toMatchObject({ enabled: true, active: false })
    expect(normalizeSmsState({ available: true, permission: 'granted', enabled: true, active: true, lastScanAtMs: 1_761_800_000_000 })).toEqual({
      available: true,
      permission: 'granted',
      enabled: true,
      active: true,
      lastScanAtMs: 1_761_800_000_000,
    })
  })
})

function nativeWithSms(overrides: Partial<NativeNoticeModuleLike> = {}): { native: NativeNoticeModuleLike; calls: string[] } {
  const calls: string[] = []
  let state: NativeSmsState = { available: true, permission: 'needed', enabled: false, active: false }
  const native: NativeNoticeModuleLike = {
    ...createFakeNoticeNative(),
    async getSmsState() {
      calls.push('get')
      return state
    },
    async requestSmsPermission() {
      calls.push('ask')
      state = { ...state, permission: 'granted' }
      return state
    },
    async setSmsEnabled(on: boolean) {
      calls.push(`set:${String(on)}`)
      state = { ...state, enabled: on, active: on && state.permission === 'granted' }
      return state
    },
    ...overrides,
  }
  return { native, calls }
}

describe('문자 연동', () => {
  it('옛 모듈(함수 없음)이면 sms는 null — 칸을 숨긴다', () => {
    expect(createNoticeIntake(createFakeNoticeNative()).sms).toBeNull()
    expect(createSmsLink(createFakeNoticeNative())).toBeNull()
  })

  it('켜기: 권한 요청 → 켜기 → 읽는 중', async () => {
    const { native, calls } = nativeWithSms()
    const sms = createNoticeIntake(native).sms
    expect(sms).not.toBeNull()
    expect((await sms!.requestPermission()).permission).toBe('granted')
    const on = await sms!.setEnabled(true)
    expect(on).toMatchObject({ enabled: true, active: true })
    expect((await sms!.setEnabled(false)).active).toBe(false)
    expect(calls).toEqual(['ask', 'set:true', 'set:false'])
  })

  it('권한 창이 실패하면 지금 상태를 다시 읽는다(가짜 성공으로 바꾸지 않는다)', async () => {
    const { native } = nativeWithSms({
      async requestSmsPermission() {
        throw new Error('no activity')
      },
    })
    const state = await createSmsLink(native)!.requestPermission()
    expect(state.permission).toBe('needed')
  })
})

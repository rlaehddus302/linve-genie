// N1 적대 테스트 (test-domain): 이름·까닭 공격 (AC-N1-72, AC-N1-31·34·55, LABEL_RULES L-12 3·6).
// - 비슷한 글자(전각 Ｐ, 키릴 Р, 폭 없는 공백, 앞 공백, undefined·null·숫자 이름)는 어느 프로필도 고르지 않는다
// - 어댑터로 연결하면 그런 이름은 WRONG_MODEL이고 상태는 DISCONNECTED, 기기 연결은 끊긴다
// - 사용자 에이전트: 대소문자가 다른 낱말은 IN_APP이 아니다, 아이폰 + 카카오톡이면 언제나 IOS, 실제 한국 사용자 에이전트 몇 개
import {
  BAUATO_PPA2L,
  EXPERIMENTAL_PROFILES,
  MARKLIFE_MESSAGES,
  MARKLIFE_PROFILES,
  createMarklifeAdapter,
  profileForDeviceName,
  unsupportedMessage,
  unsupportedReason,
  type BluetoothEnvironment,
  type ModelProfile,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ManualBle, StepTimer } from './ble-mock.ts'

const ALL = [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES]
const PREFIXES = ALL.map((p) => p.namePrefix as string)

describe('AC-N1-72 이름으로 고르기 — 비슷한 글자', () => {
  const lookalikes: [string, unknown][] = [
    ['전각 Ｐ', 'Ｐ12_AB12'],
    ['키릴 Р', 'Р12_AB12'],
    ['키릴 С(S 대신)', 'С2_AB12'],
    ['그리스 Χ(X 대신)', 'Χ2_AB12'],
    ['폭 없는 공백', 'P12​_AB12'],
    ['폭 없는 공백이 맨 앞', '​P12_AB12'],
    ['BOM이 맨 앞', '﻿P12_AB12'],
    ['앞 공백', ' P12_AB12'],
    ['앞 줄바꿈', '\nS2_AB12'],
    ['밑줄 대신 전각 밑줄', 'P12＿AB12'],
    ['밑줄 대신 하이픈', 'P12-AB12'],
    ['소문자', 'p12_AB12'],
    ['PPA2 소문자', 'ppa2L_1'],
    ['undefined', undefined],
    ['null', null],
    ['숫자', 12],
    ['빈 이름', ''],
    ['앞자리만 일부', 'P1'],
    ['LP 없이 P90', 'P90_AB'],
  ]
  it.each(lookalikes)('%s → 어느 프로필도 고르지 않는다', (_what, name) => {
    expect(profileForDeviceName(name, ALL)).toBeUndefined()
  })

  it('앞자리 + 무작위 꼬리면 그 프로필, 앞자리 앞에 무엇이든 한 글자가 붙으면 고르지 않는다 (속성)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL), fc.string({ maxLength: 40 }), fc.string({ minLength: 1, maxLength: 3 }), (profile, tail, head) => {
        expect(profileForDeviceName(`${profile.namePrefix as string}${tail}`, ALL)?.id).toBe(profile.id)
        const shifted = `${head}${profile.namePrefix as string}${tail}`
        // 앞에 붙은 글자로 다른 프로필의 앞자리가 우연히 만들어진 경우만 그 프로필이다
        const other = ALL.find((p) => shifted.startsWith(p.namePrefix as string))
        expect(profileForDeviceName(shifted, ALL)?.id).toBe(other?.id)
      }),
      { numRuns: 400, seed: 0x4e3172 },
    )
  })

  it('앞자리끼리 겹치지 않는다 — 어떤 앞자리도 다른 앞자리로 시작하지 않는다', () => {
    for (const a of PREFIXES) for (const b of PREFIXES) if (a !== b) expect(a.startsWith(b), `${a} / ${b}`).toBe(false)
  })

  it('아주 긴 이름(1만 자)도 던지지 않는다', () => {
    expect(profileForDeviceName(`P12_${'가'.repeat(10_000)}`, ALL)?.id).toBe('MARKLIFE_P12')
    expect(profileForDeviceName(`${'가'.repeat(10_000)}P12_`, ALL)).toBeUndefined()
  })
})

describe('AC-N1-31·55 어댑터로 연결 — 비슷한 이름은 WRONG_MODEL, 연결을 끊는다', () => {
  const cases: [string, string, readonly ModelProfile[] | undefined][] = [
    ['전각 Ｐ', 'Ｐ12_AB12', undefined],
    ['키릴 Р', 'Р12_AB12', undefined],
    ['폭 없는 공백', 'P12​_AB12', undefined],
    ['기본 목록에 바우아토', 'PPA2L_1234', undefined],
    ['바우아토만 켠 어댑터에 P12', 'P12_AB12', EXPERIMENTAL_PROFILES],
  ]
  it.each(cases)('%s', async (_what, name, profiles) => {
    const timer = new StepTimer()
    const ble = new ManualBle({ name, timer, onFlowStart: [[0x01, 0x04]] })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, ...(profiles ? { profiles } : {}) })
    const r = await adapter.connect('bluetooth')
    expect(r).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', message: MARKLIFE_MESSAGES.WRONG_MODEL } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(ble.connected).toBe(false)
    expect(adapter.bundle).toBeNull()
    // 거르기는 켠 프로필의 앞자리 하나씩 — acceptAllDevices 없음
    const req = ble.requests[0] as unknown as Record<string, unknown>
    expect(req).not.toHaveProperty('acceptAllDevices')
    expect((req.filters as { namePrefix: string }[]).map((f) => f.namePrefix)).toEqual((profiles ?? MARKLIFE_PROFILES).map((p) => p.namePrefix))
  })

  it('실험 목록을 넘긴 어댑터는 바우아토를 고르고 L11 바이트를 보낸다', async () => {
    const timer = new StepTimer()
    const ble = new ManualBle({ name: 'PPA2L_1234', timer, onFlowStart: [[0x01, 0x04]] })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES] })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(adapter.profile.id).toBe(BAUATO_PPA2L.id)
    expect(adapter.profile.experimental).toBe(true)
  })
})

describe('AC-N1-72·34 까닭 — 글자 그대로', () => {
  const IPHONE_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5'
  const ANDROID_KAKAO = 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36;KAKAOTALK 2410520'
  const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  const ANDROID_NAVER = 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)'
  const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'

  it.each([
    ['아이폰 + 카카오톡', IPHONE_KAKAO, 0, 'IOS'],
    ['아이폰 + 카카오톡(터치 5)', IPHONE_KAKAO, 5, 'IOS'],
    ['안드로이드 카카오톡', ANDROID_KAKAO, 5, 'IN_APP'],
    ['안드로이드 네이버', ANDROID_NAVER, 5, 'IN_APP'],
    ['소문자 kakaotalk (낱말이 다르다)', ANDROID_CHROME + ' kakaotalk/10', 5, 'OTHER'],
    ['소문자 instagram', ANDROID_CHROME + ' instagram 300.0', 5, 'OTHER'],
    ['대문자 LINE/', ANDROID_CHROME + ' LINE/14.0', 5, 'OTHER'],
    ['삼성 인터넷', SAMSUNG, 5, 'OTHER'],
    ['빈 글', '', 0, 'OTHER'],
    ['undefined', undefined, undefined, 'OTHER'],
  ] as const)('%s → %s', (_what, ua, touch, want) => {
    expect(unsupportedReason(ua, touch)).toBe(want)
  })

  it('아이폰·아이패드 표시가 있으면 무엇이 더 붙어도 언제나 IOS (속성)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('iPhone', 'iPad', 'iPod'),
        fc.string({ maxLength: 30 }),
        fc.subarray(['KAKAOTALK', 'Instagram', 'FBAN', 'FBAV', 'NAVER(inapp', 'Line/', 'DaumApps', '; wv)']),
        fc.integer({ min: 0, max: 10 }),
        (marker, noise, inApp, touch) => {
          expect(unsupportedReason(`Mozilla/5.0 (${marker}; ${noise}) ${inApp.join(' ')}`, touch)).toBe('IOS')
        },
      ),
      { numRuns: 300, seed: 0x4e3173 },
    )
  })

  it('블루투스가 없는 아이폰 카카오톡에서 연결하면 UNSUPPORTED + IOS 문장 (Marklife 앱 / 바우아토만이면 Luck Jingle 앱)', async () => {
    const env: BluetoothEnvironment = { bluetooth: undefined, userAgent: IPHONE_KAKAO, maxTouchPoints: 5 }
    const a = createMarklifeAdapter({ environment: () => env })
    expect(a.availableMethods()).toEqual([])
    const r = await a.connect('bluetooth')
    expect(r).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED', message: unsupportedMessage('IOS', 'Marklife 앱') } })
    const b = createMarklifeAdapter({ environment: () => env, profiles: EXPERIMENTAL_PROFILES })
    expect(await b.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED', message: unsupportedMessage('IOS', 'Luck Jingle 앱') } })
    expect(a.state).toBe('DISCONNECTED')
  })
})

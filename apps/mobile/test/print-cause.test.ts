// 출력이 실패한 까닭 (F2-2, D-RETRO-43): 앱이 본 사실(블루투스 상태·앱 앞/뒤·끊긴 때와 오류 번호)로 까닭 낱말을 정한다. 기기 주소·이름·글은 남기지 않는다.
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { LOST_BEFORE_START_MS, needsCause, printCause, type LinkFacts } from '../src/lib/print-cause.ts'
import { appStateNow, linkFacts, noteAppState, noteLinkLost, resetLinkFacts } from '../src/native/link-facts.ts'

const T0 = Date.parse('2026-11-12T03:25:53.000Z')
const facts = (patch: Partial<LinkFacts> = {}): LinkFacts => ({ radio: 'on', app: 'active', leftAt: null, lost: null, ...patch })
const cause = (code: string, f: LinkFacts | null, elapsed = 34_000) => printCause({ code, startedAt: T0, failedAt: T0 + elapsed, facts: f, profileId: 'NIIMBOT_B1' })

describe('printCause', () => {
  it('시간 초과인데 이어져 있고 앱도 앞에 있었으면 "답 없음" — 시각·걸린 시간·프린터 프로필을 함께', () => {
    expect(cause('TIMEOUT', facts())).toEqual({ reason: 'NO_RESPONSE', at: '2026-11-12T03:26:27.000Z', radio: 'on', app: 'active', wentBackground: false, elapsedMs: 34_000, profileId: 'NIIMBOT_B1' })
  })

  it('블루투스가 꺼졌으면 다른 것보다 먼저 "블루투스 꺼짐", 권한이 없으면 "권한 없음"', () => {
    expect(cause('TIMEOUT', facts({ radio: 'off', app: 'background', lost: { at: T0 + 1000, android: 8 } }))?.reason).toBe('BLUETOOTH_OFF')
    expect(cause('BLUETOOTH_OFF', facts())?.reason).toBe('BLUETOOTH_OFF')
    expect(cause('DISCONNECTED', facts({ radio: 'unauthorized' }))?.reason).toBe('BLUETOOTH_DENIED')
  })

  it('이 시도와 이어진 끊김은 오류 번호로 가린다: 연결 시간 초과는 거리·전원, 상대가 끊음은 프린터, 그 밖은 끊김', () => {
    expect(cause('TIMEOUT', facts({ lost: { at: T0 + 3000, ble: 201, android: 8 } }))).toMatchObject({ reason: 'OUT_OF_RANGE', lostAgoMs: 31_000, ble: 201, android: 8 })
    expect(cause('TIMEOUT', facts({ lost: { at: T0 + 3000, ios: 6 } }))?.reason).toBe('OUT_OF_RANGE')
    expect(cause('DISCONNECTED', facts({ lost: { at: T0 + 3000, android: 19 } }))?.reason).toBe('PRINTER_CLOSED')
    expect(cause('DISCONNECTED', facts({ lost: { at: T0 + 3000, ios: 7 } }))?.reason).toBe('PRINTER_CLOSED')
    expect(cause('DISCONNECTED', facts({ lost: { at: T0 + 3000, android: 133 } }))?.reason).toBe('LINK_LOST')
    expect(cause('DISCONNECTED', facts({ lost: { at: T0 + 3000 } }))).toMatchObject({ reason: 'LINK_LOST', lostAgoMs: 31_000 })
  })

  it('보내기 직전(5초 안)에 끊긴 것은 이 시도의 끊김이고, 오래전 끊김은 이 시도와 상관없다', () => {
    expect(cause('DISCONNECTED', facts({ lost: { at: T0 - LOST_BEFORE_START_MS, android: 8 } }), 10)?.reason).toBe('OUT_OF_RANGE')
    const old = cause('TIMEOUT', facts({ lost: { at: T0 - 60_000, android: 8 } }))
    expect(old?.reason).toBe('NO_RESPONSE')
    expect(old).not.toHaveProperty('lostAgoMs')
    expect(old).not.toHaveProperty('android')
  })

  it('끊김 기록 없이 앱이 뒤에 있거나 이 시도 중에 앞에서 벗어났으면 "앱이 뒤로 감"', () => {
    expect(cause('TIMEOUT', facts({ app: 'background' }))).toMatchObject({ reason: 'APP_BACKGROUND', app: 'background', wentBackground: true })
    expect(cause('TIMEOUT', facts({ app: 'active', leftAt: T0 + 5000 }))).toMatchObject({ reason: 'APP_BACKGROUND', app: 'active', wentBackground: true })
    // 이 시도 전에 벗어났다 돌아온 것은 상관없다. 앱 상태를 모르면 뒤로 치지 않는다
    expect(cause('TIMEOUT', facts({ leftAt: T0 - 5000 }))).toMatchObject({ reason: 'NO_RESPONSE', wentBackground: false })
    expect(cause('TIMEOUT', facts({ app: 'unknown' }))).toMatchObject({ reason: 'NO_RESPONSE', wentBackground: false })
  })

  it('끊김 코드인데 끊긴 기록이 없으면 "끊김", 그 밖의 연결 실패는 "모름"', () => {
    expect(cause('DISCONNECTED', facts())?.reason).toBe('LINK_LOST')
    expect(cause('NOT_CONNECTED', facts())?.reason).toBe('LINK_LOST')
    expect(cause('PRINT_FAILED', facts())?.reason).toBe('UNKNOWN')
  })

  it('라벨을 못 그린 실패와 사실을 모르는 연결(시험용 프린터)에는 붙이지 않는다', () => {
    for (const code of ['INVALID_TEMPLATE', 'DOES_NOT_FIT', 'IMAGE_TOO_WIDE', 'INVALID_DENSITY', 'LABEL_INVALID']) {
      expect(needsCause(code)).toBe(false)
      expect(cause(code, facts())).toBeNull()
    }
    expect(cause('TIMEOUT', null)).toBeNull()
  })

  it('남기는 칸은 정해진 것뿐이다 (글·주소 없음)', () => {
    const made = cause('TIMEOUT', facts({ app: 'inactive', leftAt: T0 + 1, lost: { at: T0 + 2, ble: 201, android: 8, ios: 6, att: 1 } }))
    expect(Object.keys(made ?? {}).sort()).toEqual(['android', 'app', 'at', 'att', 'ble', 'elapsedMs', 'ios', 'lostAgoMs', 'profileId', 'radio', 'reason', 'wentBackground'])
    expect(printCause({ code: 'TIMEOUT', startedAt: T0, failedAt: T0 + 1, facts: facts(), profileId: null })).not.toHaveProperty('profileId')
  })
})

describe('연결 사실 모으기 (native/link-facts)', () => {
  beforeEach(() => resetLinkFacts())

  it('끊긴 때와 오류 번호만 적는다 — 까닭 글에서는 status 수만 읽고 글·주소는 남기지 않는다', () => {
    noteLinkLost({ errorCode: 201, androidErrorCode: 8, reason: 'Device AA:BB:CC:DD:EE:FF was disconnected', message: 'B1-H123456789' }, T0)
    expect(linkFacts('on').lost).toEqual({ at: T0, ble: 201, android: 8 })
    noteLinkLost({ errorCode: 201, reason: 'Disconnection from AA:BB:CC:DD:EE:FF failed with status 19 (GATT_CONN_TERMINATE_PEER_USER)' }, T0 + 1)
    expect(linkFacts('on').lost).toEqual({ at: T0 + 1, ble: 201, android: 19 })
    noteLinkLost({ errorCode: 201, iosErrorCode: 6, attErrorCode: 14 }, T0 + 2)
    expect(linkFacts('on').lost).toEqual({ at: T0 + 2, ble: 201, ios: 6, att: 14 })
    // 오류 없이 끊김
    noteLinkLost(null, T0 + 3)
    expect(linkFacts('off')).toEqual({ radio: 'off', app: 'unknown', leftAt: null, lost: { at: T0 + 3 } })
    expect(JSON.stringify(linkFacts('on'))).not.toMatch(/AA:BB|H123456789|GATT/)
  })

  it('앱이 앞에서 벗어난 때를 적는다 (돌아와도 그때는 남는다)', () => {
    noteAppState('active', T0)
    expect(linkFacts('on')).toMatchObject({ app: 'active', leftAt: null })
    noteAppState('inactive', T0 + 10)
    noteAppState('background', T0 + 20)
    expect(linkFacts('on')).toMatchObject({ app: 'background', leftAt: T0 + 20 })
    noteAppState('active', T0 + 30)
    expect(linkFacts('on')).toMatchObject({ app: 'active', leftAt: T0 + 20 })
    expect(appStateNow()).toBe('active')
    noteAppState(undefined, T0 + 40)
    expect(appStateNow()).toBe('unknown')
  })
})

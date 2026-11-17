// D-ALERTFLOAT-01 → D-PRINTOFF-01 (사용자 지시 2026-11-17 "문구를 다음 6가지 빼고는 다 지워"):
// 라벨 출력 기능이 꺼져 있어요 · 블루투스가 꺼져 있어요 · 프린터와 연결이 끊겼어요 · 라벨 출력에 실패했어요 · 찜 취소 요청 n건 · 등록 안 된 번호에 찜 n건.
// 프린터 쪽은 한 줄(급한 것부터): 꺼짐 → 블루투스(이 폰이 찍는 폰일 때) → 끊김 → 실패. 블루투스·연결은 이 폰이 찍는 폰이거나 찍는 폰이 없으면 이 폰이 본 상태로.
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { describe, expect, it } from 'vitest'
import { FLOAT_TEXT, cancelFloatText, floatAlerts, printerFloat, unlistedFloatText, type HerePrinter } from '../src/screens/console/AlertFloat.tsx'

const device = { id: 'd1', name: '아이폰', live: true, printerConnected: true, releasing: false }
const queue = (over: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true, ...over })
const pause = (reason: 'DISCONNECTED' | 'PRINTER_ERROR' | 'SELLER' | 'LABEL_ERROR') => ({ reason, message: '', backlog: false })
const mine: HerePrinter = { mine: true, printer: 'CONNECTED', radio: 'on' }
const other: HerePrinter = { mine: false, printer: 'DISCONNECTED', radio: 'on' }
const text = (q: QueueSummary | null, here: HerePrinter = mine, rehearsal = false, ended = false) => printerFloat(q, here, rehearsal, ended)?.text ?? null

describe('프린터 한 줄', () => {
  it('잘 나가면 없다 — 연습 방송·끝난 방송·요약을 모르면 없다', () => {
    expect(text(queue({ waiting: 3 }))).toBeNull()
    expect(text(queue({ labelsEnabled: false }), mine, true)).toBeNull()
    expect(text(queue({ labelsEnabled: false }), mine, false, true)).toBeNull()
    expect(text(null)).toBeNull()
  })

  it('라벨 출력을 끄면 "라벨 출력 기능이 꺼져 있어요" — 누르면 라이브 관리', () => {
    expect(printerFloat(queue({ labelsEnabled: false }), { ...mine, radio: 'off' }, false, false)).toEqual({ key: 'printer', text: FLOAT_TEXT.labelsOff, action: 'manage' })
  })

  it('라벨 출력을 켰는데 이 폰 블루투스가 꺼져 있으면 "블루투스가 꺼져 있어요" — 찍는 폰이 아직 없어도', () => {
    expect(text(queue(), { ...mine, radio: 'off', printer: 'DISCONNECTED' })).toBe(FLOAT_TEXT.bluetoothOff)
    expect(text(queue({ device: null }), { mine: false, printer: 'DISCONNECTED', radio: 'unauthorized' })).toBe(FLOAT_TEXT.bluetoothOff)
    // 다른 기기가 찍는 폰이면 이 폰 블루투스는 상관없다
    expect(text(queue(), { ...other, radio: 'off' })).toBeNull()
  })

  it('연결이 없으면 "프린터와 연결이 끊겼어요" — 이 폰이면 이 폰 연결, 다른 기기면 그 기기 연결', () => {
    expect(text(queue(), { ...mine, printer: 'DISCONNECTED' })).toBe(FLOAT_TEXT.lost)
    expect(text(queue({ device: null }), { mine: false, printer: 'DISCONNECTED', radio: 'on' })).toBe(FLOAT_TEXT.lost)
    expect(text(queue({ device: { ...device, printerConnected: false } }), other)).toBe(FLOAT_TEXT.lost)
    expect(text(queue({ device: { ...device, live: false } }), other)).toBe(FLOAT_TEXT.lost)
    expect(text(queue({ pause: pause('DISCONNECTED') }))).toBe(FLOAT_TEXT.lost)
  })

  it('멈춤(프린터 오류·라벨을 못 만듦·옛 판매자 멈춤)은 "라벨 출력에 실패했어요"', () => {
    for (const reason of ['PRINTER_ERROR', 'LABEL_ERROR', 'SELLER'] as const) expect(text(queue({ pause: pause(reason) }))).toBe(FLOAT_TEXT.failed)
  })

  it('문구는 6가지뿐이고 짧다 — 영어·개발 용어 없음', () => {
    const all = [...Object.values(FLOAT_TEXT), cancelFloatText(2), unlistedFloatText(3)]
    expect(all).toEqual(['라벨 출력 기능이 꺼져 있어요', '블루투스가 꺼져 있어요', '프린터와 연결이 끊겼어요', '라벨 출력에 실패했어요', '찜 취소 요청 2건', '등록 안 된 번호에 찜 3건'])
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(16)
      expect(line).not.toMatch(/[A-Za-z]/)
    }
  })
})

describe('떠 있는 알림 목록 (급한 것부터)', () => {
  it('프린터 → 찜 취소 요청 → 등록 안 된 번호', () => {
    const items = floatAlerts({ cancelRequests: 2, queue: queue({ pause: pause('PRINTER_ERROR') }), here: mine, rehearsal: false, ended: false, unlisted: 3 })
    expect(items.map((item) => item.text)).toEqual(['라벨 출력에 실패했어요', '찜 취소 요청 2건', '등록 안 된 번호에 찜 3건'])
    expect(items.map((item) => item.action)).toEqual(['labels', 'decide', 'unlisted'])
  })

  it('버릴 라벨·대기 라벨 수만으로는 아무것도 뜨지 않는다', () => {
    expect(floatAlerts({ cancelRequests: 0, queue: queue({ discard: 3, waiting: 5 }), here: mine, rehearsal: false, ended: false, unlisted: 0 })).toEqual([])
  })
})

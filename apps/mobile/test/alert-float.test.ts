// D-ALERTFLOAT-01 (사용자 지시 2026-11-17): 오류 알림은 오른쪽 아래 빨간 캡슐 — 같은 일은 한 줄로, 짧게.
// 프린터: 판매자가 멈춤 → 라벨을 못 만듦 → 기기 없음 → 알린 까닭 → 기기 앱 꺼짐 → 끊김 → 프린터 오류. 버릴 라벨·확인 필요는 띄우지 않는다.
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { describe, expect, it } from 'vitest'
import { PRINT_FLOAT_TEXT, PRINT_ISSUE_TEXT, floatAlerts, printerFloatText } from '../src/screens/console/AlertFloat.tsx'

const device = { id: 'd1', name: '아이폰', live: true, printerConnected: true, releasing: false }
const queue = (over: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true, ...over })
const pause = (reason: 'DISCONNECTED' | 'PRINTER_ERROR' | 'SELLER' | 'LABEL_ERROR') => ({ reason, message: '', backlog: false })
const counts = { conflict: 0, cancelRequest: 0, succession: 0, pending: 0, attention: 0 }

describe('프린터 한 줄 (출력 기기 없음 + 출력 멈춤을 하나로)', () => {
  it('잘 나가면 없다 — 연습 방송·요약을 모르면 없다', () => {
    expect(printerFloatText(queue({ waiting: 3 }), false, false)).toBeNull()
    expect(printerFloatText(queue({ device: null, waiting: 3 }), true, false)).toBeNull()
    expect(printerFloatText(null, false, false)).toBeNull()
  })

  it('라벨이 쌓였는데 기기가 없으면 "프린터를 연결해 주세요", 쌓인 게 없으면 없다', () => {
    expect(printerFloatText(queue({ device: null, waiting: 2 }), false, false)).toBe('프린터를 연결해 주세요')
    expect(printerFloatText(queue({ device: null }), false, false)).toBeNull()
    expect(printerFloatText(queue({ device: null, waiting: 2, labelsEnabled: false }), false, false)).toBeNull()
  })

  it('알린 까닭이 있으면 까닭 그대로 — 덮개·용지·블루투스', () => {
    const off = { ...device, printerConnected: false }
    expect(printerFloatText(queue({ device: off, waiting: 1, issue: 'BLUETOOTH_OFF' }), false, false)).toBe('블루투스가 꺼져 있어요')
    expect(printerFloatText(queue({ pause: pause('PRINTER_ERROR'), issue: 'COVER_OPEN' }), false, false)).toBe('프린터 덮개가 열려 있어요')
    expect(printerFloatText(queue({ pause: pause('PRINTER_ERROR'), issue: 'NO_PAPER' }), false, false)).toBe('라벨 용지가 없어요')
    expect(printerFloatText(queue({ pause: pause('PRINTER_ERROR'), issue: 'UNKNOWN' }), false, false)).toBe(PRINT_FLOAT_TEXT.printerError)
  })

  it('까닭을 모르면: 기기 앱 꺼짐 → 끊김 → 프린터 오류', () => {
    // D-FLOATLEFT-01: 옛 "출력 기기에서 앱을 켜 주세요"는 뜻을 몰라 바꿈 — 프린터를 맡은 기기(다른 폰·PC일 수 있다)의 앱 연결이 닫힘
    expect(printerFloatText(queue({ device: { ...device, live: false }, waiting: 1 }), false, false)).toBe('프린터 연결 기기가 꺼졌어요')
    expect(printerFloatText(queue({ device: { ...device, printerConnected: false }, waiting: 1 }), false, false)).toBe('프린터 연결이 끊겼어요')
    expect(printerFloatText(queue({ pause: pause('DISCONNECTED') }), false, false)).toBe('프린터 연결이 끊겼어요')
    expect(printerFloatText(queue({ pause: pause('PRINTER_ERROR') }), false, false)).toBe('프린터를 확인해 주세요')
  })

  it('판매자가 멈춘 것·라벨을 못 만든 것은 까닭보다 먼저', () => {
    expect(printerFloatText(queue({ pause: pause('SELLER'), issue: 'NO_PAPER' }), false, false)).toBe('라벨 출력을 멈췄어요')
    expect(printerFloatText(queue({ pause: pause('LABEL_ERROR') }), false, false)).toBe('라벨을 만들지 못했어요')
  })

  it('문구는 짧다 (17자 안팎) — 영어·개발 용어 없음', () => {
    for (const text of [...Object.values(PRINT_FLOAT_TEXT), ...Object.values(PRINT_ISSUE_TEXT)]) {
      if (text === null) continue
      expect(text.length).toBeLessThanOrEqual(17) // D-FLOATLEFT-01: "프린터 연결 기기 앱이 닫혔어요"(17) — 옛 16
      expect(text).not.toMatch(/[A-Za-z]/)
    }
  })
})

describe('떠 있는 알림 목록 (급한 것부터)', () => {
  it('프린터 → 1등 정하기(충돌·승계 합쳐 한 줄) → 취소 요청 → 등록 안 된 번호', () => {
    const items = floatAlerts({ counts: { ...counts, conflict: 1, succession: 2, cancelRequest: 2 }, queue: queue({ pause: pause('SELLER') }), rehearsal: false, ended: false, unlisted: 3 })
    expect(items.map((item) => item.text)).toEqual(['라벨 출력을 멈췄어요', '1등을 정해 주세요', '취소 요청 2건', '등록 안 된 번호에 찜 3건'])
    expect(items.map((item) => item.action)).toEqual(['labels', 'decide', 'decide', 'unlisted'])
  })

  it('버릴 라벨·확인 필요·보류 찜 수만으로는 아무것도 뜨지 않는다', () => {
    expect(floatAlerts({ counts: { ...counts, attention: 2, pending: 4 }, queue: queue({ discard: 3 }), rehearsal: false, ended: false, unlisted: 0 })).toEqual([])
  })
})

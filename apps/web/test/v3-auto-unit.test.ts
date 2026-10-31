// 가격 단위 자동 (V3 D-V3-70) — 빠른 입력 한 줄·미리 보기·설정 낱말
// SRV1 (D-APP-23·24): 읽기 함수는 서버 전용 자리(packages/voice-session/src/read)로 옮겼다 — 기대값은 그대로, 서버 읽기 함수를 본다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { unitLine } from '../src/lib/quick.ts'
import { registerPreview } from '../../../packages/voice-session/src/read/index.ts'
import { PRICE_UNIT_WORDS } from '../src/lib/settings-fields.ts'

describe('가격 단위 자동 (D-V3-70)', () => {
  it('설정 낱말과 빠른 입력칸 아래 한 줄', () => {
    expect(PRICE_UNIT_WORDS.AUTO).toBe('자동 (25 → 250,000원, 180 → 180,000원)')
    expect(unitLine('AUTO')).toBe('가격 단위: 자동 — 25는 250,000원, 180은 180,000원, 15000은 15,000원')
  })

  it('미리 보기: 두 자리 이하 만원, 세 자리 천원, 1000 이상 원 그대로', () => {
    const settings = { ...DEFAULT_SETTINGS, 'price.unit': 'AUTO' as const }
    const none = () => undefined
    expect(registerPreview('15 핑크프릴 25', settings, none)).toBe('등록하면: 15번 핑크프릴 250,000원')
    expect(registerPreview('15 핑크프릴 180', settings, none)).toBe('등록하면: 15번 핑크프릴 180,000원')
    expect(registerPreview('15 핑크프릴 15000', settings, none)).toBe('등록하면: 15번 핑크프릴 15,000원')
  })
})

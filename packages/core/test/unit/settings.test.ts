// 설정 기본값은 코어 안 한 곳(settings.ts)에서만 정의한다 (AC-S01-01).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, checkSettings, parseAmount, parseChat, parseQuickInput, resolveSettings, type SettingsOverride } from '@livejjim/core'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : []
  })
}

describe('DEFAULT_SETTINGS — DOMAIN_RULES 판매 규칙 설정표 기본값', () => {
  // D-PEND-01: claim.preOpenExpire(엔진 기본 예)가 설정표에 더해졌는데 이 표에 빠져 있었다(그 결정이 "새 설정 시험은 나중"으로 남긴 것) — 19개 → 20개.
  // 감사 묶음 시간의 엔진 기본값은 0 그대로다(운영 10초는 서버 판매자 기본값, D-RETRO-01). thanks.followEdits는 기본값이 없는 칸이다(D-RETRO-02, 아래)
  it('설정표의 20개 키와 기본값 (O1: claim.maxQuantity 10, D-PEND-01: claim.preOpenExpire 예)', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      'claim.parseMode': 'STRICT',
      'claim.maxQuantity': 10,
      'claim.multiNumber': 'ALL',
      'claim.maxNumber': 999,
      'claim.ignoreOwner': true,
      'claim.preOpenWindowSec': 30,
      'claim.preOpenExpire': true,
      'waitlist.max': 5,
      'cancel.buyerChat': 'REQUEST',
      'cancel.succession': 'AUTO',
      'contention.policy': 'ARRIVAL',
      'contention.sameMinuteTieBreaker': 'HOST',
      'price.unit': 'THOUSAND',
      'shipping.baseFee': 4000,
      'shipping.freeThreshold': null,
      'settlement.groupBy': 'DATE',
      'print.autoOnConfirm': true,
      'thanks.liveChat': true,
      'thanks.videoComment': 'OFF',
      'thanks.batchWindowSec': 0,
    })
  })

  it('바꿀 수 없다(호출 사이에 남는 상태가 생기지 않게)', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true)
  })

  it('파서 기본값 리터럴은 settings.ts에만 있다 — 파서마다 따로 적지 않는다', () => {
    const others = sourceFiles(SRC).filter((file) => !file.endsWith(`${join('src', 'settings.ts')}`))
    expect(others.length).toBeGreaterThan(0)
    for (const file of others) {
      const text = readFileSync(file, 'utf8')
      for (const literal of [/(?<!\d)999(?!\d)/, /'STRICT'/, /'ALL'/, /'THOUSAND'/]) expect(literal.test(text), `${file}: ${String(literal)}`).toBe(false)
    }
  })
})

describe('resolveSettings', () => {
  it('빠진 키는 기본값, 있는 키는 덮어쓴다', () => {
    const resolved = resolveSettings({ 'claim.maxNumber': 50, 'price.unit': 'WON' })
    expect(resolved).toEqual({ ...DEFAULT_SETTINGS, 'claim.maxNumber': 50, 'price.unit': 'WON' })
  })

  it('넘긴 객체를 바꾸지 않고 새 객체를 돌려준다', () => {
    const override: SettingsOverride = Object.freeze({ 'claim.parseMode': 'LOOSE' })
    const resolved = resolveSettings(override)
    expect(override).toEqual({ 'claim.parseMode': 'LOOSE' })
    expect(resolved).not.toBe(DEFAULT_SETTINGS)
    resolved['claim.maxNumber'] = 1
    expect(DEFAULT_SETTINGS['claim.maxNumber']).toBe(999)
    expect(resolveSettings()['claim.maxNumber']).toBe(999)
  })

  it('값이 undefined인 키와 상속된 속성은 기본값을 쓴다', () => {
    const inherited = Object.create({ 'claim.maxNumber': 5 }) as SettingsOverride
    expect(resolveSettings(inherited)['claim.maxNumber']).toBe(999)
    expect(resolveSettings({ 'claim.maxNumber': undefined })['claim.maxNumber']).toBe(999)
  })

  it('객체가 아닌 값(null, 문자열 등)은 빈 설정으로 본다', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(resolveSettings('LOOSE' as unknown as SettingsOverride)).toEqual(DEFAULT_SETTINGS)
  })

  it('설정표에 없는 키는 무시한다', () => {
    const resolved = resolveSettings({ 'claim.unknown': 1 } as unknown as SettingsOverride)
    expect(Object.keys(resolved)).toEqual(Object.keys(DEFAULT_SETTINGS))
  })

  it('thanks.followEdits(D-RETRO-02)는 기본값이 없다 — 적었을 때만 들어가고, 적지 않은 설정은 이 칸이 없던 때와 글자까지 같다(옛 방송 재생, D-072)', () => {
    expect(Object.hasOwn(DEFAULT_SETTINGS, 'thanks.followEdits')).toBe(false)
    expect(Object.hasOwn(resolveSettings({}), 'thanks.followEdits')).toBe(false)
    expect(Object.hasOwn(resolveSettings({ 'thanks.followEdits': undefined }), 'thanks.followEdits')).toBe(false)
    expect(resolveSettings({ 'thanks.followEdits': true })).toEqual({ ...DEFAULT_SETTINGS, 'thanks.followEdits': true })
    expect(resolveSettings({ 'thanks.followEdits': false })).toEqual({ ...DEFAULT_SETTINGS, 'thanks.followEdits': false })
    expect(checkSettings({ 'thanks.followEdits': true })).toEqual([])
    expect(checkSettings({ 'thanks.followEdits': 'yes' })).toEqual([{ key: 'thanks.followEdits', message: '예나 아니오로만 정할 수 있어요' }])
  })
})

describe('파서는 같은 기본값을 쓴다', () => {
  it('설정을 안 넘긴 것 = 빈 설정 = 기본값을 그대로 넘긴 것', () => {
    const variants: ReadonlyArray<SettingsOverride | undefined> = [undefined, {}, DEFAULT_SETTINGS]
    for (const settings of variants) {
      expect(parseChat('999', settings)).toEqual({ claims: [999], cancels: [], mentions: [] })
      expect(parseChat('1000', settings)).toEqual({ claims: [], cancels: [], mentions: [] })
      expect(parseChat('15번 너무 예뻐요', settings)).toEqual({ claims: [], cancels: [], mentions: [15] })
      expect(parseChat('15 28', settings)).toEqual({ claims: [15, 28], cancels: [], mentions: [] })
      expect(parseAmount('10', settings)).toBe(10000)
      expect(parseQuickInput('999 핑크프릴 10', settings)).toEqual({ no: 999, name: '핑크프릴', price: 10000 })
      expect(parseQuickInput('1000 핑크프릴 10', settings)).toEqual({ error: 'NUMBER_INVALID' })
    }
  })
})

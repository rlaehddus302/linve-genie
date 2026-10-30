// 기기 안 거르기 규칙·은행 앱 고르기 검사.
import { describe, expect, it } from 'vitest'
import {
  BANK_APP_CANDIDATES,
  BANK_PACKAGES_MAX,
  BLOCKED_PACKAGES,
  DEFAULT_FILTER_RULES,
  FILTER_RULES_MAX,
  PACKAGE_NAME_PATTERN,
  SMS_PACKAGES,
  checkBankPackages,
  matchFilterRule,
  parseFilterRules,
  serializeFilterRules,
} from '../src/index.ts'

describe('기본 거르기 규칙', () => {
  it('인증번호·광고는 걸리고 문자찜·입금 알림은 지나간다', () => {
    const sms = (body: string) => matchFilterRule(DEFAULT_FILTER_RULES, { kindHint: 'sms', source: '15880000', body })
    expect(sms('[네이버] 인증번호 [123456]를 입력하세요')).toBe('otp-ko')
    expect(sms('본인 확인을 위해 아래 코드를')).toBe('otp-ko-auth')
    expect(sms('(광고)[가게] 가을 세일')).toBe('ad-mark')
    expect(sms('무료 수신 거부 0801234567')).toBe('ad-optout')
    expect(sms('찜 3번 김민지')).toBeNull()
    expect(sms('3번 5번 찜할게요 010-1234-5678')).toBeNull()
    expect(matchFilterRule(DEFAULT_FILTER_RULES, { kindHint: 'bank', source: 'com.kbstar.kbbank', body: '[KB]10/30 14:13 123456**789 홍길동 입금 35,000 잔액1,234,000' })).toBeNull()
  })
})

describe('서버가 내려준 규칙 검사', () => {
  it('맞는 목록은 받고 kinds 겹침은 하나로', () => {
    expect(parseFilterRules([{ id: 'x', field: 'body', op: 'contains', value: '출금', kinds: ['bank', 'bank'] }])).toEqual([
      { id: 'x', field: 'body', op: 'contains', value: '출금', kinds: ['bank'] },
    ])
    expect(parseFilterRules([])).toEqual([])
  })
  it('하나라도 틀리면 전부 버린다(null → 기본 규칙)', () => {
    const ok = { id: 'x', field: 'body', op: 'contains', value: '출금' }
    for (const bad of [
      null,
      'rules',
      [{ ...ok, id: '이름' }],
      [{ ...ok, field: 'title' }],
      [{ ...ok, op: 'regex' }],
      [{ ...ok, value: '   ' }],
      [{ ...ok, value: 'x'.repeat(101) }],
      [{ ...ok, kinds: [] }],
      [{ ...ok, kinds: ['kakao'] }],
      [ok, 1],
      Array.from({ length: FILTER_RULES_MAX + 1 }, () => ok),
    ]) {
      expect(parseFilterRules(bad), JSON.stringify(bad)?.slice(0, 80)).toBeNull()
    }
  })
  it('네이티브에 넘기는 글은 다시 읽으면 같은 규칙', () => {
    const rules = [...DEFAULT_FILTER_RULES, { id: 'k', field: 'source', op: 'startsWith', value: '080', kinds: ['sms'] } as const]
    expect(parseFilterRules(JSON.parse(serializeFilterRules(rules)))).toEqual(rules.map((r) => ({ ...r })))
  })
})

describe('은행 앱 고르기', () => {
  it('맞는 이름은 겹침 없이 고른 순서대로', () => {
    expect(checkBankPackages(['com.kbstar.kbbank', ' viva.republica.toss ', 'com.kbstar.kbbank'])).toEqual({ ok: true, packages: ['com.kbstar.kbbank', 'viva.republica.toss'] })
    expect(checkBankPackages([])).toEqual({ ok: true, packages: [] })
  })
  it('메신저는 개인 대화가 섞여 고를 수 없다', () => {
    expect(checkBankPackages(['com.kakao.talk'])).toEqual({ ok: false, problem: 'BLOCKED', packageName: 'com.kakao.talk' })
    for (const p of BLOCKED_PACKAGES) expect(checkBankPackages([p]).ok).toBe(false)
  })
  it('문자 앱은 처음부터 들어 있어 고르지 않는다', () => {
    for (const p of SMS_PACKAGES) expect(checkBankPackages([p])).toEqual({ ok: false, problem: 'SMS_APP', packageName: p })
  })
  it('틀린 이름·너무 많음', () => {
    expect(checkBankPackages(['kbbank']).ok).toBe(false)
    expect(checkBankPackages(['com.kb bank']).ok).toBe(false)
    expect(checkBankPackages(['1com.bank']).ok).toBe(false)
    expect(checkBankPackages([42]).ok).toBe(false)
    const many = Array.from({ length: BANK_PACKAGES_MAX + 1 }, (_, i) => `com.bank.app${i}`)
    expect(checkBankPackages(many)).toEqual({ ok: false, problem: 'TOO_MANY' })
  })
  it('후보 목록은 모두 고를 수 있는 이름이다', () => {
    expect(BANK_APP_CANDIDATES.length).toBeGreaterThan(0)
    for (const bank of BANK_APP_CANDIDATES) {
      expect(PACKAGE_NAME_PATTERN.test(bank.packageName)).toBe(true)
      expect(checkBankPackages([bank.packageName]).ok).toBe(true)
    }
  })
})

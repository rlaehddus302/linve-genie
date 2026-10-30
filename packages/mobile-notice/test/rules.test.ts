// 기기에서 먼저 거르기 (C-03, D-SMS3-11·D-SMS3-26) — skipWords·bankApps·bankNumbers, 목록 받기 전엔 문자만.
import { describe, expect, it } from 'vitest'
import {
  BLOCKED_PACKAGES,
  DEFAULT_BANK_NUMBERS,
  DEFAULT_SKIP_WORDS,
  SKIP_WORDS_MAX,
  channelForPackage,
  isBankNumber,
  parseNoticeFilters,
  serializeNoticeFilters,
  skipWordFor,
  skipWordIn,
} from '../src/index.ts'

describe('거를 낱말', () => {
  it('목록 받기 전 사본은 R-26 3 목록과 같다', () => {
    expect([...DEFAULT_SKIP_WORDS]).toEqual(['(광고)', '[광고]', 'web발신', '국제발신', '해외발신', '인증', '승인', '결제', '택배'])
  })
  it('영문 대소문자 무시 — 인증번호 문자는 보내지 않는다', () => {
    expect(skipWordIn('[Web발신] 인증번호 123456', null)).toBe('web발신')
    expect(skipWordIn('[WEB발신] 안내', null)).toBe('web발신')
    expect(skipWordIn('인증번호 123456', null)).toBe('인증')
    expect(skipWordIn('15 홍길동', null)).toBeNull()
  })
  it('서버 목록이 오면 그것만 쓴다(빈 목록이면 거르지 않음)', () => {
    expect(skipWordIn('인증번호 123456', { skipWords: ['Sale'], bankApps: [], bankNumbers: [] })).toBeNull()
    expect(skipWordIn('BIG SALE', { skipWords: ['Sale'], bankApps: [], bankNumbers: [] })).toBe('Sale')
    expect(skipWordIn('(광고) 봄', { skipWords: [], bankApps: [], bankNumbers: [] })).toBeNull()
  })
})

describe('읽을 앱', () => {
  const filters = { skipWords: [], bankApps: ['com.kakaobank.channel'], bankNumbers: [] }
  it('기본 문자 앱만 문자로 — 다른 문자 앱은 읽지 않는다', () => {
    expect(channelForPackage('com.samsung.android.messaging', 'com.samsung.android.messaging', null)).toBe('SMS')
    expect(channelForPackage('com.google.android.apps.messaging', 'com.samsung.android.messaging', null)).toBeNull()
  })
  it('목록 받기 전에는 문자만, 받은 뒤에는 bankApps 앱 알림도', () => {
    expect(channelForPackage('com.kakaobank.channel', 'com.samsung.android.messaging', null)).toBeNull()
    expect(channelForPackage('com.kakaobank.channel', 'com.samsung.android.messaging', filters)).toBe('APP')
    expect(channelForPackage('viva.republica.toss', 'com.samsung.android.messaging', filters)).toBeNull()
  })
  it('메신저는 목록에 있어도 읽지 않는다', () => {
    for (const p of BLOCKED_PACKAGES) expect(channelForPackage(p, 'com.samsung.android.messaging', { skipWords: [], bankApps: [p], bankNumbers: [] })).toBeNull()
  })
})

describe('filters 읽기', () => {
  it('틀리면 null(전에 저장한 것을 그대로)', () => {
    expect(parseNoticeFilters({ skipWords: Array.from({ length: SKIP_WORDS_MAX + 1 }, (_, i) => `w${i}`), bankApps: [], bankNumbers: [] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: ['x'.repeat(101)], bankApps: [], bankNumbers: [] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: [], bankApps: ['kbbank'] })).toBeNull()
  })
  it('저장 글을 다시 읽으면 같다', () => {
    const filters = { skipWords: ['(광고)', 'Web발신'], bankApps: ['com.kbstar.kbbank'], bankNumbers: ['15889999'] }
    expect(parseNoticeFilters(JSON.parse(serializeNoticeFilters(filters)))).toEqual(filters)
  })
})

describe('은행 대표번호 문자는 거르지 않는다 (D-SMS3-26)', () => {
  it('목록 받기 전 사본은 DP-9 1 표의 대표번호 16개와 같다', () => {
    expect([...DEFAULT_BANK_NUMBERS].sort()).toEqual(
      ['15889999', '16449999', '15999999', '15778000', '15998000', '15885000', '15995000', '15881111', '15991111', '16613000', '15882100', '15662566', '15882588', '15993333', '16617654', '15221000'].sort(),
    )
  })
  it('대표번호 판정은 DP-9 1 문자 검사와 같다 — 숫자·하이픈·빈칸만, 숫자만 남긴 글이 목록에', () => {
    expect(isBankNumber('1588-9999', null)).toBe(true)
    expect(isBankNumber('1588 9999', null)).toBe(true)
    expect(isBankNumber(' 15889999 ', null)).toBe(true)
    expect(isBankNumber('+82 1588-9999', null)).toBe(false)
    expect(isBankNumber('(1588)9999', null)).toBe(false)
    expect(isBankNumber('신한 1577-8000', null)).toBe(false)
    expect(isBankNumber('１５８８９９９９', null)).toBe(false)
    expect(isBankNumber('1588.9999', null)).toBe(false)
    expect(isBankNumber('1588-0000', null)).toBe(false)
    expect(isBankNumber('---', null)).toBe(false)
    expect(isBankNumber(null, null)).toBe(false)
    expect(isBankNumber('1588-1234', { skipWords: [], bankApps: [], bankNumbers: ['15881234'] })).toBe(true)
    expect(isBankNumber('1588-9999', { skipWords: [], bankApps: [], bankNumbers: ['15881234'] })).toBe(false)
  })
  it('은행 번호 문자는 skipWords를 보지 않고, 앱 알림은 거르지 않는다', () => {
    expect(skipWordFor({ channel: 'SMS', from: '1588-9999', text: '[Web발신] 홍길동 입금 14,000원' }, null)).toBeNull()
    expect(skipWordFor({ channel: 'SMS', from: '1588-9999', text: '[Web발신] 승인 12,000원 출금' }, null)).toBeNull()
    expect(skipWordFor({ channel: 'SMS', from: '010-1234-5678', text: '[Web발신] 승인' }, null)).toBe('web발신')
    expect(skipWordFor({ channel: 'APP', from: 'com.kbstar.kbbank', text: '승인 12,000원' }, null)).toBeNull()
  })
  it('서버 filters에 bankNumbers가 없으면(옛 서버) 기기 사본, 있는데 틀리면 전체를 버린다', () => {
    expect(parseNoticeFilters({ skipWords: [], bankApps: [] })?.bankNumbers).toEqual([...DEFAULT_BANK_NUMBERS])
    expect(parseNoticeFilters({ skipWords: [], bankApps: [], bankNumbers: [] })?.bankNumbers).toEqual([])
    expect(parseNoticeFilters({ skipWords: [], bankApps: [], bankNumbers: ['1588-9999'] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: [], bankApps: [], bankNumbers: [15889999] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: [], bankApps: [], bankNumbers: '15889999' })).toBeNull()
  })
})

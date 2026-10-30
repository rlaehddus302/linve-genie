// 기기에서 먼저 거르기 (C-03, D-SMS3-11) — skipWords·bankApps, 목록 받기 전엔 문자만.
import { describe, expect, it } from 'vitest'
import { BLOCKED_PACKAGES, DEFAULT_SKIP_WORDS, SKIP_WORDS_MAX, channelForPackage, parseNoticeFilters, serializeNoticeFilters, skipWordIn } from '../src/index.ts'

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
    expect(skipWordIn('인증번호 123456', { skipWords: ['Sale'], bankApps: [] })).toBeNull()
    expect(skipWordIn('BIG SALE', { skipWords: ['Sale'], bankApps: [] })).toBe('Sale')
    expect(skipWordIn('(광고) 봄', { skipWords: [], bankApps: [] })).toBeNull()
  })
})

describe('읽을 앱', () => {
  const filters = { skipWords: [], bankApps: ['com.kakaobank.channel'] }
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
    for (const p of BLOCKED_PACKAGES) expect(channelForPackage(p, 'com.samsung.android.messaging', { skipWords: [], bankApps: [p] })).toBeNull()
  })
})

describe('filters 읽기', () => {
  it('틀리면 null(전에 저장한 것을 그대로)', () => {
    expect(parseNoticeFilters({ skipWords: Array.from({ length: SKIP_WORDS_MAX + 1 }, (_, i) => `w${i}`), bankApps: [] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: ['x'.repeat(101)], bankApps: [] })).toBeNull()
    expect(parseNoticeFilters({ skipWords: [], bankApps: ['kbbank'] })).toBeNull()
  })
  it('저장 글을 다시 읽으면 같다', () => {
    const filters = { skipWords: ['(광고)', 'Web발신'], bankApps: ['com.kbstar.kbbank'] }
    expect(parseNoticeFilters(JSON.parse(serializeNoticeFilters(filters)))).toEqual(filters)
  })
})

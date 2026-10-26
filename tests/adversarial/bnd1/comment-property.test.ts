// BND1 적대 시험 (test-domain): 밴드 댓글 → chat 순수 함수(apps/server/src/band/comment.ts)를 무작위·악의 입력으로 공격한다.
// - bandBatch를 손으로 쓴 모형과 대조(fast-check): 기록 차례 = 작성 시각 오름차순(같으면 읽은 차례), 이미 본 키 빠짐, 같은 읽기 안 두 번째부터 DUPLICATE
// - bandText: 손님이 친 이스케이프 글자는 태그·부르기(@)가 되지 않는다, 앞뒤 공백 없음, 빈 글은 null, 어떤 글에도 예외 없음
// - 키: user_key가 다른 플랫폼 접두어·휴대폰 번호 모양이어도 늘 band: (D-BND1-02, D-079), 판매자와 대소문자만 다르면 판매자가 아님(D-BND1-05)
// - 500 코드 포인트 경계(이모지·결합 문자·ZWJ), 256자 키 경계
// 근거: acceptance.md "공격 관점", AC-BND1-33·90, 골든 tests/golden/band/*.json, D-BND1-02~07
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BAND_TEXT_MAX, bandBatch, bandComment, bandFirstLine, bandText, clipWithEllipsis, longerThan, type BandSkipCode } from '../../../apps/server/src/band/comment.ts'
import { PLATFORM_KEY_MAX, platformOfKey } from '../../../apps/server/src/platform.ts'

const SELLER = 'SELLERKEY'
const POST = 'AADlR4bTLKYkGEuwrMOnwuar'

const codePoints = (value: string): number => Array.from(value).length

// ── 무작위 댓글 항목 ─────────────────────────────────────────────────────

const keyArb = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom('K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8') },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constantFrom(123, '', null) },
)
const authorArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom('GUEST_A', 'GUEST_B', 'sellerkey', 'ig:1', '01012345678').map((key) => ({ name: '손님', user_key: key })) },
  { weight: 2, arbitrary: fc.constant({ name: '판매자', user_key: SELLER }) },
  { weight: 1, arbitrary: fc.constant({ name: '이름만' }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
)
const timeArb = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 5 }).map((s) => 1_793_012_400_000 + s * 1000) },
  { weight: 1, arbitrary: fc.constantFrom(0, -1, 1.5, '1793012400000', Number.MAX_SAFE_INTEGER + 2) },
  { weight: 1, arbitrary: fc.constant(undefined) },
)
const contentArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom('1번', '2번 2개요', ' 3번 ', '<band:refer user_key="X">박사장</band:refer> 1번', '&lt;b&gt;1번', '🌵') },
  { weight: 1, arbitrary: fc.constantFrom('', '   ', '<band:sticker id="1"></band:sticker>', null, 15) },
  { weight: 1, arbitrary: fc.constant('가'.repeat(501)) },
)
const itemArb = fc.record({ comment_key: keyArb, author: authorArb, created_at: timeArb, content: contentArb }, { requiredKeys: [] })

/** 모형: 골든 README "밴드 골든" 문장 그대로 */
function model(items: readonly Record<string, unknown>[], known: ReadonlySet<string>) {
  const inRead = new Set<string>()
  const record: { key: string; at: number; index: number }[] = []
  const skip: { key: string | null; code: BandSkipCode }[] = []
  items.forEach((item, index) => {
    const raw = item['comment_key']
    const key = typeof raw === 'string' ? raw : null
    if (key !== null && known.has(key)) return
    if (key !== null && inRead.has(key)) return void skip.push({ key, code: 'DUPLICATE' })
    if (key !== null) inRead.add(key)
    const one = bandComment({ sellerUserKey: SELLER, postKey: POST, item })
    if ('skip' in one) return void skip.push({ key, code: one.skip })
    record.push({ key: key as string, at: item['created_at'] as number, index })
  })
  record.sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1))
  return { record: record.map((entry) => entry.key), skip }
}

describe('TD-BND1 bandBatch 모형 대조 (속성)', () => {
  it('기록 차례·건너뜀·이미 본 키 — 어떤 목록이든 모형과 같다', () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 40 }), fc.subarray(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']), (items, knownList) => {
        const known = new Set(knownList)
        const frozen = JSON.stringify(items)
        const result = bandBatch({ sellerUserKey: SELLER, postKey: POST, known, items })
        expect(JSON.stringify(items)).toBe(frozen)
        const expected = model(items as Record<string, unknown>[], known)
        expect(result.record.map((entry) => entry.key)).toEqual(expected.record)
        expect(result.skip).toEqual(expected.skip)
        // 기록한 키는 겹치지 않고, 이미 본 키가 없다
        const keys = result.record.map((entry) => entry.key)
        expect(new Set(keys).size).toBe(keys.length)
        for (const key of keys) expect(known.has(key)).toBe(false)
        // 작성 시각은 줄지 않는다 · chat은 정확히 다섯 키, owner false, ch는 band:
        for (let i = 1; i < result.record.length; i += 1) expect((result.record[i] as { createdAt: number }).createdAt).toBeGreaterThanOrEqual((result.record[i - 1] as { createdAt: number }).createdAt)
        for (const entry of result.record) {
          expect(Object.keys(entry.chat).sort()).toEqual(['ch', 'id', 'nick', 'owner', 'text'])
          expect(entry.chat.owner).toBe(false)
          expect(entry.chat.id).toBe(`band:${POST}:${entry.key}`)
          expect(platformOfKey(entry.chat.ch)).toBe('BAND')
          expect(entry.chat.ch).not.toBe(`band:${SELLER}`)
          expect(codePoints(entry.chat.text)).toBeLessThanOrEqual(BAND_TEXT_MAX)
        }
        // 같은 입력이면 같은 결과
        expect(bandBatch({ sellerUserKey: SELLER, postKey: POST, known, items })).toEqual(result)
      }),
      { numRuns: 400, seed: 20261026 },
    )
  })

  it('시각이 뒤섞인 50개 한 묶음 → 기록 차례 = 작성 시각 순 (같은 시각은 읽은 차례)', () => {
    const base = 1_793_012_400_000
    const offsets = Array.from({ length: 50 }, (_, i) => (i * 37) % 23) // 0~22초, 같은 시각 여럿
    const items = offsets.map((s, i) => ({ comment_key: `C${String(i)}`, author: { name: `손님${String(i)}`, user_key: `G${String(i)}` }, created_at: base + s * 1000, content: `${String(i)}번` }))
    const keys = bandBatch({ sellerUserKey: SELLER, postKey: POST, known: [], items }).record.map((entry) => entry.key)
    const expected = items.map((item, i) => ({ key: item.comment_key, at: item.created_at, i })).sort((a, b) => a.at - b.at || a.i - b.i).map((entry) => entry.key)
    expect(keys).toEqual(expected)
  })
})

describe('TD-BND1 키 — 늘 band:, 판매자는 정확히 같을 때만', () => {
  const item = (userKey: string) => ({ comment_key: 'C1', author: { name: '손님', user_key: userKey }, created_at: 1_793_012_400_000, content: '1번' })

  it('다른 플랫폼 접두어·문자 접두어·유튜브 채널 모양·휴대폰 번호 모양 user_key도 band:로 시작하는 밴드 구매자', () => {
    for (const userKey of ['ig:IG_A', 'tt:TT_A', 'sms:s1', 'UC_A', 'sim_a1', '01012345678', '010-1234-5678', 'band:X']) {
      const out = bandComment({ sellerUserKey: SELLER, postKey: POST, item: item(userKey) })
      expect('chat' in out, userKey).toBe(true)
      if (!('chat' in out)) continue
      expect(out.chat.ch).toBe(`band:${userKey}`)
      expect(platformOfKey(out.chat.ch)).toBe('BAND')
    }
  })

  it('판매자 user_key와 대소문자·앞뒤 공백·전각만 다르면 판매자가 아니다 (손님으로 기록)', () => {
    for (const userKey of ['sellerkey', 'SellerKey', ' SELLERKEY', 'SELLERKEY ', 'ＳＥＬＬＥＲＫＥＹ']) {
      const out = bandComment({ sellerUserKey: SELLER, postKey: POST, item: item(userKey) })
      expect('chat' in out, userKey).toBe(true)
    }
    expect(bandComment({ sellerUserKey: SELLER, postKey: POST, item: item(SELLER) })).toEqual({ skip: 'SELLER' })
  })

  it('메시지 ID·구매자 키 256자 경계는 band: 접두어를 포함해 센다', () => {
    const at = 1_793_012_400_000
    const ok = bandComment({ sellerUserKey: SELLER, postKey: POST, item: { comment_key: 'k'.repeat(PLATFORM_KEY_MAX - 30), author: { name: 'a', user_key: 'u'.repeat(PLATFORM_KEY_MAX - 5) }, created_at: at, content: '1번' } })
    expect('chat' in ok).toBe(true)
    if ('chat' in ok) {
      expect(ok.chat.id.length).toBe(PLATFORM_KEY_MAX)
      expect(ok.chat.ch.length).toBe(PLATFORM_KEY_MAX)
    }
    // 서로게이트 쌍이 든 키는 UTF-16 길이로 센다 (수집 경로 상한과 같은 단위)
    const emojiKey = bandComment({ sellerUserKey: SELLER, postKey: POST, item: { comment_key: '🌵'.repeat(114), author: { name: 'a', user_key: 'u' }, created_at: at, content: '1번' } })
    expect(emojiKey).toEqual({ skip: 'BAD_COMMENT_KEY' })
  })
})

describe('TD-BND1 bandText — 태그·이스케이프·공백', () => {
  /** 밴드가 손님 글을 이스케이프해 주는 모양 (문서: html 태그가 포함될 경우 이스케이프) */
  const escapeLikeBand = (raw: string) => raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const typed = fc.string({ unit: fc.constantFrom('<', '>', '&', '"', "'", '@', 'b', 'a', 'n', 'd', ':', 'r', 'e', 'f', '/', ' ', '1', '번', 'l', 't', 'g', ';', '#', '\n', '🌵'), maxLength: 60 })

  it('손님이 친 어떤 글도(밴드가 이스케이프한 뒤) 원래 글자 그대로 돌아온다 — 태그가 되거나 @가 생기지 않는다', () => {
    fc.assert(
      fc.property(typed, (raw) => {
        const text = bandText(escapeLikeBand(raw))
        const trimmed = raw.trim()
        expect(text).toBe(trimmed === '' ? null : trimmed)
      }),
      { numRuns: 500, seed: 1026 },
    )
  })

  it('어떤 글에도 예외 없음 · 결과는 null이거나 앞뒤 공백 없는 빈 글이 아닌 글', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), typed), (content) => {
        const text = bandText(content)
        if (text !== null) {
          expect(text).not.toBe('')
          expect(text).toBe(text.trim())
        }
        expect(typeof bandFirstLine(content)).toBe('string')
      }),
      { numRuns: 400, seed: 7 },
    )
  })

  it('닫히지 않은 부르기·태그 안의 태그·아주 긴 속성·여러 겹 이스케이프', () => {
    expect(bandText('<band:refer user_key="X">박사장 1번')).toBe('박사장 1번')
    expect(bandText('<band:refer user_key="X"><band:refer user_key="Y">박</band:refer></band:refer> 1번')).toBe('@박 1번')
    expect(bandText(`<band:refer user_key="${'x'.repeat(10_000)}">이름</band:refer> 2번`)).toBe('@이름 2번')
    expect(bandText(`<band:sticker ${'a="b" '.repeat(2000)}></band:sticker>3번`)).toBe('3번')
    expect(bandText('&amp;amp;lt;band:refer&amp;amp;gt;')).toBe('&amp;lt;band:refer&amp;gt;')
    expect(bandText('&lt;band:refer user_key=&quot;X&quot;&gt;박사장&lt;/band:refer&gt; 1번')).toBe('<band:refer user_key="X">박사장</band:refer> 1번')
    // 대문자 BAND:는 밴드 태그가 아니다 — 지우지 않는다
    expect(bandText('<BAND:REFER>a</BAND:REFER>')).toBe('<BAND:REFER>a</BAND:REFER>')
  })

  it('500 코드 포인트 경계 — 결합 문자·ZWJ 이모지는 코드 포인트로 센다, 자르지 않고 건너뛴다', () => {
    const at = 1_793_012_400_000
    const run = (content: string) => bandComment({ sellerUserKey: SELLER, postKey: POST, item: { comment_key: 'C', author: { name: 'a', user_key: 'G' }, created_at: at, content } })
    const family = '👨‍👩‍👧' // 코드 포인트 5
    expect(codePoints(family)).toBe(5)
    expect('chat' in run(family.repeat(100))).toBe(true)
    expect(run(`${family.repeat(100)}a`)).toEqual({ skip: 'TEXT_TOO_LONG' })
    const combining = `${'가́'.repeat(250)}`
    expect('chat' in run(combining)).toBe(true)
    expect(run(`${combining}x`)).toEqual({ skip: 'TEXT_TOO_LONG' })
    // 앞뒤 공백은 센 수에 들지 않는다 (정리한 뒤 센다)
    expect('chat' in run(`   ${'가'.repeat(500)}   `)).toBe(true)
    // 태그를 지운 뒤 센다
    expect('chat' in run(`<band:sticker id="${'9'.repeat(600)}"></band:sticker>${'가'.repeat(500)}`)).toBe(true)
  })

  it('longerThan·clipWithEllipsis는 코드 포인트 수와 같다 (서로게이트 쌍을 가르지 않는다)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), fc.integer({ min: 0, max: 70 }), (value, max) => {
        expect(longerThan(value, max)).toBe(codePoints(value) > max)
        const clipped = clipWithEllipsis(value, max)
        if (codePoints(value) > max) {
          expect(codePoints(clipped)).toBe(max + 1)
          expect(clipped.endsWith('…')).toBe(true)
        } else expect(clipped).toBe(value)
        expect(clipped.isWellFormed()).toBe(value.isWellFormed())
      }),
      { numRuns: 300, seed: 3 },
    )
  })

  it('글 첫 줄: 이스케이프·태그를 정리한 뒤의 첫 줄, 40자 넘으면 …, 비면 (글 없음)', () => {
    expect(bandFirstLine('&lt;공지&gt; 오늘 8시 라방\n1번부터')).toBe('<공지> 오늘 8시 라방')
    expect(bandFirstLine('\r\n\r\n   \n둘째 줄')).toBe('둘째 줄')
    expect(bandFirstLine('<band:sticker></band:sticker>')).toBe('(글 없음)')
    expect(bandFirstLine('🌵'.repeat(41))).toBe(`${'🌵'.repeat(40)}…`)
  })
})

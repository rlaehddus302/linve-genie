// 댓글 거르개 단위 시험 (N2b-1, AC-N2b-1-21·22·23·51, D-N2b-1-03·04). 골든 사례는 tiktok-golden.test.ts가 돌린다.
import { describe, expect, it } from 'vitest'
import { chatEventFields, createCommentFilter, decimalId, fakeChatEvent, int64Value, TIKTOK_COMMENT_MEMORY } from '../src/tiktok/index.ts'

const AT = new Date('2026-10-20T11:00:00.000Z')
const raw = (msgId: unknown, userId: unknown = '7101000000000000001', extra: Record<string, unknown> = {}) => ({ msgId, userId, uniqueId: 'buyer_a', nickname: '홍길동', comment: '15', ...extra })

describe('AC-N2b-1-21 64비트 정수 ID', () => {
  it('bigint도 받는다: 7234567890123456789n → "7234567890123456789", 0n·음수 → 버림', () => {
    const filter = createCommentFilter('seller_kim')
    const out = filter.accept(raw(7234567890123456789n, 9223372036854775807n), AT)
    expect(out).toEqual({
      record: {
        platform: 'TIKTOK',
        commentId: '7234567890123456789',
        userId: '9223372036854775807',
        nickname: '홍길동',
        text: '15',
        receivedAt: '2026-10-20T11:00:00.000Z',
        owner: false,
      },
    })
    expect(filter.accept(raw(0n), AT)).toEqual({ drop: 'BAD_COMMENT_ID' })
    expect(filter.accept(raw(-7n), AT)).toEqual({ drop: 'BAD_COMMENT_ID' })
    expect(filter.accept(raw('7301', 0n), AT)).toEqual({ drop: 'BAD_USER_ID' })
    expect(filter.accept(raw('7302', -1n), AT)).toEqual({ drop: 'BAD_USER_ID' })
    expect(filter.accept(raw(10n ** 32n), AT)).toEqual({ drop: 'BAD_COMMENT_ID' })
    expect(filter.accept(raw(10n ** 31n), AT)).toMatchObject({ record: { commentId: '1' + '0'.repeat(31) } })
  })

  it('숫자·bigint·문자열로 온 같은 ID는 같은 ID다', () => {
    const filter = createCommentFilter('seller_kim')
    expect(filter.accept(raw(123456n), AT)).toMatchObject({ record: { commentId: '123456' } })
    expect(filter.accept(raw('123456'), AT)).toEqual({ drop: 'DUPLICATE' })
    expect(filter.accept(raw(123456), AT)).toEqual({ drop: 'DUPLICATE' })
  })

  it('protobuf 64비트 정수 객체({ low, high, unsigned })를 정밀도 손실 없이 10진 문자열로', () => {
    expect(int64Value({ low: -1, high: 0x7fffffff, unsigned: false })).toBe('9223372036854775807')
    // 7234567890123456789 = 0x6466_592A_6A41_8115
    expect(int64Value({ low: 0x6a418115, high: 0x6466592a, unsigned: false })).toBe('7234567890123456789')
    expect(int64Value({ low: -1, high: -1, unsigned: true })).toBe('18446744073709551615')
    expect(int64Value({ low: -1, high: -1, unsigned: false })).toBe('-1')
    expect(int64Value('7234567890123456789')).toBe('7234567890123456789')
    expect(int64Value(7234567890123456789n)).toBe(7234567890123456789n)
    expect(int64Value({ low: 1.5, high: 0 })).toEqual({ low: 1.5, high: 0 })
  })

  it('감싸개가 꺼낸 모양(문자열·bigint·정수 객체)의 2^63-1·7234567890123456789가 레코드에서 글자 그대로', () => {
    const shapes: Array<[unknown, unknown]> = [
      ['9223372036854775807', '7234567890123456789'],
      [9223372036854775807n, 7234567890123456789n],
      [
        { low: -1, high: 0x7fffffff, unsigned: false },
        { low: 0x6a418115, high: 0x6466592a, unsigned: false },
      ],
    ]
    for (const [msgId, userId] of shapes) {
      const filter = createCommentFilter('seller_kim')
      const out = filter.accept(chatEventFields(fakeChatEvent({ msgId, userId, uniqueId: 'buyer_a', nickname: 'a', comment: '15' })), AT)
      expect(out).toMatchObject({ record: { commentId: '9223372036854775807', userId: '7234567890123456789' } })
    }
  })

  it('안전 범위를 넘은 숫자(number)는 버린다 — 숫자로 바꾸는 경로가 없다', () => {
    expect(decimalId(2 ** 53)).toBeNull()
    expect(decimalId(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991')
    expect(decimalId(Number.NaN)).toBeNull()
    expect(decimalId(Number.POSITIVE_INFINITY)).toBeNull()
    expect(decimalId('9223372036854775807')).toBe('9223372036854775807')
    expect(decimalId('00071')).toBeNull()
    expect(decimalId(true)).toBeNull()
  })
})

describe('AC-N2b-1-22 라이브러리 chat 자료 → 다섯 값', () => {
  it('common.msgId·common.createTime·user.userId·user.uniqueId·user.nickname·comment만 꺼낸다', () => {
    const fields = chatEventFields(fakeChatEvent({ msgId: '7301', userId: '7101', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15', createTime: '1700000000000' }))
    expect(fields).toEqual({ msgId: '7301', userId: '7101', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15', createTime: '1700000000000' })
  })

  it('틀린 모양이어도 예외가 새지 않고 거르개의 버림 코드로 끝난다', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('읽으면 오류')
        },
      },
    )
    const shapes: unknown[] = [
      null,
      undefined,
      15,
      'chat',
      {},
      { comment: '15' },
      { common: null, user: null, comment: '15' },
      { common: { msgId: '7301' }, comment: '15' },
      { common: { msgId: '7301' }, user: { uniqueId: 'buyer_a' }, comment: '15' },
      { common: { msgId: '7301' }, user: { userId: '7101' }, comment: null },
      throwing,
      { common: throwing, user: throwing, comment: '15' },
    ]
    const filter = createCommentFilter('seller_kim')
    const codes = shapes.map((shape) => {
      const out = filter.accept(chatEventFields(shape), AT)
      return 'drop' in out ? out.drop : 'RECORD'
    })
    expect(codes).toEqual([
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
      'BAD_USER_ID',
      'BAD_USER_ID',
      'NO_TEXT',
      'BAD_COMMENT_ID',
      'BAD_COMMENT_ID',
    ])
    expect(filter.counts()).toEqual({ received: 0, duplicates: 0, dropped: shapes.length })
  })
})

describe('AC-N2b-1-23 중복 기억 — 최근 2만 개', () => {
  it('서로 다른 ID 25,000개 뒤: 5,001번째를 다시 보내면 DUPLICATE, 기억 크기 ≤ 20,000', () => {
    const filter = createCommentFilter('seller_kim')
    for (let i = 1; i <= 25_000; i += 1) {
      const out = filter.accept(raw(String(7_301_000_000 + i)), AT)
      expect('record' in out).toBe(true)
    }
    expect(filter.memorySize).toBeLessThanOrEqual(TIKTOK_COMMENT_MEMORY)
    expect(filter.memorySize).toBe(20_000)
    expect(filter.accept(raw(String(7_301_000_000 + 5_001)), AT)).toEqual({ drop: 'DUPLICATE' })
    expect(filter.accept(raw(String(7_301_000_000 + 25_000)), AT)).toEqual({ drop: 'DUPLICATE' })
    // 2만 개 밖으로 밀려난 ID는 다시 받는다 (엔진의 메시지 ID 중복 막기가 2차 방어 — N2b-2)
    expect(filter.accept(raw(String(7_301_000_000 + 5_000)), AT)).toMatchObject({ record: { commentId: String(7_301_005_000) } })
    expect(filter.memorySize).toBe(20_000)
    expect(filter.counts()).toEqual({ received: 25_001, duplicates: 2, dropped: 0 })
  })

  it('거르개끼리 기억을 나누지 않는다 (판매자 둘)', () => {
    const a = createCommentFilter('seller_kim')
    const b = createCommentFilter('seller_kim')
    expect('record' in a.accept(raw('7301'), AT)).toBe(true)
    expect('record' in b.accept(raw('7301'), AT)).toBe(true)
    expect(a.accept(raw('7301'), AT)).toEqual({ drop: 'DUPLICATE' })
  })
})

describe('AC-N2b-1-51 꼭 필요한 값만', () => {
  it('레코드는 정확히 일곱 키 — 프로필 사진·배지·secUid·팔로우 정보는 없다', () => {
    const filter = createCommentFilter('seller_kim')
    const out = filter.accept(chatEventFields(fakeChatEvent({ msgId: '7301', userId: '7101', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15' })), AT)
    expect('record' in out && Object.keys(out.record)).toEqual(['platform', 'commentId', 'userId', 'nickname', 'text', 'receivedAt', 'owner'])
    const text = JSON.stringify(out)
    for (const leaked of ['secUid', 'MS4wLjABAAAAfakeSecUid', 'avatar', 'badges', 'followInfo', 'fake bio', 'buyer_a']) expect(text).not.toContain(leaked)
    expect(Object.isFrozen('record' in out ? out.record : null)).toBe(true)
  })

  it('거대한 닉네임·본문도 앞부분만 보고 끝난다 (닉네임 64자, 본문 501자 넘음은 버림)', () => {
    const filter = createCommentFilter('seller_kim')
    const out = filter.accept(raw('7301', '7101', { nickname: '가'.repeat(1_000_000) }), AT)
    expect('record' in out && [...out.record.nickname].length).toBe(64)
    expect(filter.accept(raw('7302', '7101', { comment: 'ㅋ'.repeat(1_000_000) }), AT)).toEqual({ drop: 'TEXT_TOO_LONG' })
  })
})

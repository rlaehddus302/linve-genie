// 틱톡 아이디·주소 해석 단위 시험 (N2b-1, AC-N2b-1-10·11, D-N2b-1-02). 골든 사례는 tiktok-golden.test.ts가 돌린다.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkTikTokTarget,
  createTikTokConnection,
  FakeWebcast,
  isTikTokTarget,
  parseTikTokTarget,
  readTikTokSettings,
  TIKTOK_TARGET_MESSAGES,
  type TikTokTarget,
} from '../src/tiktok/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AC-N2b-1-10 해석 — 길이·결정성', () => {
  it('2,000자(UTF-16 단위)를 넘는 입력은 INVALID', () => {
    expect(parseTikTokTarget('@' + 'a'.repeat(2000))).toEqual({ error: 'INVALID' })
    expect(parseTikTokTarget('https://www.tiktok.com/@seller_kim?x=' + 'a'.repeat(2000))).toEqual({ error: 'INVALID' })
    expect(parseTikTokTarget(' '.repeat(2001))).toEqual({ error: 'INVALID' })
    expect(parseTikTokTarget(' '.repeat(1990) + 'seller_kim')).toEqual({ uniqueId: 'seller_kim' })
  })

  it('되풀이 패턴의 긴 입력도 결과가 정해진다 (걸린 시간은 단언하지 않는다 — D-902)', () => {
    expect(parseTikTokTarget('a'.repeat(1999) + '!')).toEqual({ error: 'INVALID' })
    expect(parseTikTokTarget('tiktok.com/' + '/@'.repeat(990))).toEqual({ error: 'INVALID' })
    expect(parseTikTokTarget('https://' + 'www.'.repeat(490) + 'tiktok.com/@a')).toEqual({ error: 'INVALID' })
  })

  it('바깥 호출·시계·난수를 쓰지 않는다 (같은 입력 → 같은 결과)', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('시계를 읽으면 안 된다')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('난수를 쓰면 안 된다')
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const input of ['@Seller_Kim', 'https://vm.tiktok.com/ZMabcdef/', 'https://www.tiktok.com/@seller_kim/live', '', '판매자']) {
      expect(parseTikTokTarget(input)).toEqual(parseTikTokTarget(input))
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('문자열이 아닌 입력은 INVALID', () => {
    for (const input of [undefined, null, 15, {}, ['seller_kim']]) expect(parseTikTokTarget(input)).toEqual({ error: 'INVALID' })
  })

  it('보이지 않는 글자·전각 글자·닮은 호스트·대문자 호스트만 적은 입력은 INVALID', () => {
    for (const input of ['​seller_kim', 'seller​_kim', 'ｓｅｌｌｅｒ＿ｋｉｍ', '@seller_kim x', 'WWW.TIKTOK.COM', 'TikTok.com', 'm.tiktok.com.evil.example/@seller_kim', 'https://www.tiktok.com@evil.example/@seller_kim']) {
      expect(parseTikTokTarget(input), JSON.stringify(input)).toEqual({ error: 'INVALID' })
    }
  })
})

describe('AC-N2b-1-11 해석 실패 문장·연결 시도 없음', () => {
  it('실패마다 코드와 문장을 함께 돌려준다 (문장은 그대로)', () => {
    expect(checkTikTokTarget('')).toEqual({ ok: false, error: 'EMPTY', message: '틱톡 아이디를 넣어 주세요.' })
    expect(checkTikTokTarget('seller kim')).toEqual({
      ok: false,
      error: 'INVALID',
      message: '틱톡 아이디나 방송 주소가 아니에요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
    })
    expect(checkTikTokTarget('https://vm.tiktok.com/ZMabcdef/')).toEqual({
      ok: false,
      error: 'SHORT_LINK',
      message: '짧은 공유 주소는 쓸 수 없어요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
    })
    expect(TIKTOK_TARGET_MESSAGES).toEqual({
      EMPTY: '틱톡 아이디를 넣어 주세요.',
      INVALID: '틱톡 아이디나 방송 주소가 아니에요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
      SHORT_LINK: '짧은 공유 주소는 쓸 수 없어요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
    })
  })

  it('성공하면 연결 대상(소문자 아이디)을 돌려준다', () => {
    const checked = checkTikTokTarget('  https://www.tiktok.com/@Seller_Kim/live ')
    expect(checked).toEqual({ ok: true, target: { uniqueId: 'seller_kim' } })
    expect(checked.ok && isTikTokTarget(checked.target)).toBe(true)
  })

  it('해석에 실패한 입력으로는 연결 객체를 만들 수 없고, 가짜 웹캐스트 연결 시도는 0', () => {
    const fake = new FakeWebcast().account('seller_kim', 'LIVE')
    const settings = readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' })
    const forged: unknown[] = [
      { uniqueId: 'Seller Kim' },
      { uniqueId: '@seller_kim' },
      { uniqueId: 'https://www.tiktok.com/@seller_kim' },
      { uniqueId: 'a' },
      { uniqueId: '' },
      'seller_kim',
      null,
      { error: 'INVALID' },
      checkTikTokTarget('https://vm.tiktok.com/x/'),
    ]
    for (const target of forged) {
      expect(() =>
        createTikTokConnection({ sellerId: 's1', target: target as TikTokTarget, webcast: fake.factory, onRecord: () => undefined, settings, consent: async () => true }),
      ).toThrow(TypeError)
    }
    expect(fake.created).toBe(0)
    expect(fake.attempts).toBe(0)
  })
})

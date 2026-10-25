// 틱톡 라이브 댓글 읽기 (AC-TTX-02~07) — 가짜 틱톡 페이지(D-TTX-11)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readComment, screenOf, tiktokPageOf, TikTokReader, type TikTokItem } from '../src/tiktok-reader.ts'
import { TT_NOT_COMMENTS } from '../src/tiktok-selectors.ts'
import { TikTokWatcher, TT_CHECK_MS, TT_STATUS_MS, type IntervalTimers } from '../src/tiktok-watch.ts'
import { appendComments, commentElement, loadFakeTikTok, notCommentElement, OTHER_URL, OWN_URL } from './fake-tiktok.ts'

let received: TikTokItem[] = []
let reader: TikTokReader
let list: HTMLElement

beforeEach(() => {
  received = []
  list = loadFakeTikTok()
  reader = new TikTokReader({ document, onComments: (items) => received.push(...items) })
})

afterEach(() => {
  reader.stop()
})

describe('새로 붙은 일반 댓글만 읽는다', () => {
  it('AC-TTX-02: 댓글 3개 → 대기열에 3개, 댓글 ID·숫자 사용자 ID·아이디·닉네임·본문, 붙은 순서 그대로, 시각 칸 없음', () => {
    expect(reader.start()).toBe(true)
    appendComments(
      list,
      { commentId: '7301000000000000101', userId: '7101000000000000101', uniqueId: 'buyer_a', nickname: '홍길동', text: '15' },
      { commentId: '7301000000000000102', userId: '7101000000000000102', uniqueId: 'buyer_b', nickname: '<img src=x onerror=alert(1)>', text: '16번 주세요' },
      { commentId: '7301000000000000103', userId: '7101000000000000103', uniqueId: 'Buyer_C', nickname: null, text: '17' },
    )
    reader.flush()
    expect(received).toEqual([
      { commentId: '7301000000000000101', userId: '7101000000000000101', uniqueId: 'buyer_a', nickname: '홍길동', text: '15' },
      { commentId: '7301000000000000102', userId: '7101000000000000102', uniqueId: 'buyer_b', nickname: '<img src=x onerror=alert(1)>', text: '16번 주세요' },
      { commentId: '7301000000000000103', userId: '7101000000000000103', uniqueId: 'Buyer_C', nickname: '', text: '17' },
    ])
    for (const item of received) expect(Object.keys(item).sort()).toEqual(['commentId', 'nickname', 'text', 'uniqueId', 'userId'])
    expect(reader.counts).toEqual({ read: 3, unread: 0 })
  })

  it('MutationObserver가 스스로 알린다 (flush 없이)', async () => {
    reader.start()
    appendComments(list, { text: '15' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(received.map((item) => item.text)).toEqual(['15'])
  })

  it('AC-TTX-03: 시작 전에 있던 5개는 보내지 않고 그 뒤 붙은 2개만', () => {
    expect(list.querySelectorAll('.tt-comment')).toHaveLength(5)
    reader.start()
    reader.flush()
    expect(received).toEqual([])
    appendComments(list, { text: '8' }, { text: '9' })
    reader.flush()
    expect(received.map((item) => item.text)).toEqual(['8', '9'])
  })

  it('AC-TTX-04: 필수 값 하나라도 못 읽으면 보내지 않고 읽지 못함 +1, 닉네임은 없어도 된다', () => {
    reader.start()
    const cases = [{ commentId: null }, { userId: null }, { uniqueId: null }, { text: null }, { text: '   ' }, { commentId: '0123' }, { userId: 'abc' }, { commentId: '9'.repeat(33) }, { uniqueId: '   ' }]
    for (const [i, c] of cases.entries()) {
      appendComments(list, c)
      reader.flush()
      expect(received).toEqual([])
      expect(reader.counts.unread).toBe(i + 1)
    }
    appendComments(list, { nickname: null, text: '15' })
    reader.flush()
    expect(received).toHaveLength(1)
  })

  it('AC-TTX-04: 선물·입장·좋아요·시스템 알림은 대기열 0, 읽지 못함도 늘지 않는다', () => {
    reader.start()
    for (const selector of TT_NOT_COMMENTS) list.append(notCommentElement(document, selector))
    reader.flush()
    expect(received).toEqual([])
    expect(reader.counts).toEqual({ read: 0, unread: 0 })
  })

  it('AC-TTX-05: 같은 요소가 지워졌다 다시 붙거나 같은 댓글 ID가 두 번 붙으면 1개', () => {
    reader.start()
    const [element] = appendComments(list, { commentId: '7301000000000000201', text: '15' })
    reader.flush()
    element?.remove()
    if (element !== undefined) list.append(element)
    appendComments(list, { commentId: '7301000000000000201', text: '15' })
    reader.flush()
    expect(received).toHaveLength(1)
    // 시작 전에 있던 댓글이 다시 그려져(새 요소, 같은 ID) 붙어도 보내지 않는다
    appendComments(list, { commentId: '7300000000000000003', text: '5' })
    reader.flush()
    expect(received).toHaveLength(1)
  })

  it('목록이 통째로 다시 그려지면 그 안의 새 댓글도 읽는다', () => {
    reader.start()
    const wrapper = document.createElement('div')
    wrapper.append(commentElement(document, { text: '21' }))
    list.append(wrapper)
    reader.flush()
    expect(received.map((item) => item.text)).toEqual(['21'])
  })

  it('본문의 이모지 그림은 대체 글자로, 아주 긴 글은 서버가 버릴 수 있게 500자 넘게 남긴다', () => {
    const element = commentElement(document, { text: '15' })
    const img = document.createElement('img')
    img.setAttribute('alt', '😀')
    element.querySelector('.tt-text')?.append(img)
    expect(readComment(element)).toMatchObject({ kind: 'comment', item: { text: '15😀' } })
    const long = commentElement(document, { text: '가'.repeat(5000) })
    const result = readComment(long)
    expect(result.kind).toBe('comment')
    if (result.kind === 'comment') expect(Array.from(result.item.text).length).toBeGreaterThan(500)
  })
})

describe('AC-TTX-06: 어느 화면에서 관찰하나', () => {
  it.each([
    ['https://www.tiktok.com/@seller_kim/live', 'OWN'],
    ['https://www.tiktok.com/@Seller_Kim/live', 'OWN'],
    ['https://www.tiktok.com/@seller_kim/live/', 'OWN'],
    ['https://www.tiktok.com/@seller_kim/live?lang=ko', 'OWN'],
    ['https://www.tiktok.com/@seller_kim/live#x', 'OWN'],
    ['https://www.tiktok.com/@other_seller/live', 'OTHER'],
    ['https://www.tiktok.com/@seller_kim', 'ELSEWHERE'],
    ['https://www.tiktok.com/foryou', 'ELSEWHERE'],
    ['https://www.tiktok.com/@seller_kim/video/1', 'ELSEWHERE'],
    ['https://www.tiktok.com/@seller_kim/live/extra', 'ELSEWHERE'],
  ])('%s → %s', (href, screen) => {
    expect(screenOf(tiktokPageOf(href), 'seller_kim')).toBe(screen)
  })

  it('틱톡이 아닌 곳·m.tiktok.com·http는 틱톡 화면이 아니다', () => {
    expect(tiktokPageOf('https://m.tiktok.com/@seller_kim/live')).toBeNull()
    expect(tiktokPageOf('http://www.tiktok.com/@seller_kim/live')).toBeNull()
    expect(tiktokPageOf('https://www.tiktok.com.evil.example/@seller_kim/live')).toBeNull()
    expect(tiktokPageOf('https://www.youtube.com/live_chat?v=abcdEFGH123')).toBeNull()
  })

  it('판매자 아이디가 없으면 내 방송이라고 하지 않는다', () => {
    expect(screenOf(tiktokPageOf(OWN_URL), null)).toBe('OTHER')
  })
})

/** 손으로 돌리는 반복 타이머 */
class FakeIntervals implements IntervalTimers {
  #next = 1
  readonly jobs = new Map<number, { fn: () => void; ms: number; left: number }>()
  every(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.jobs.set(id, { fn, ms, left: ms })
    return id
  }
  cancel(handle: unknown): void {
    this.jobs.delete(handle as number)
  }
  /** ms만큼 흘린다 */
  async advance(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      for (const job of [...this.jobs.values()]) {
        job.left -= 100
        if (job.left <= 0) {
          job.left = job.ms
          job.fn()
        }
      }
      await settle()
    }
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

interface Sent {
  readonly type: string
  readonly [key: string]: unknown
}

function watcherWith(initial: string, tiktokId: string | null = 'seller_kim', connected = true) {
  const sent: Sent[] = []
  let href = initial
  const timers = new FakeIntervals()
  const watcher = new TikTokWatcher({
    document,
    href: () => href,
    ask: (message) => {
      sent.push(message as Sent)
      const type = (message as Sent).type
      return Promise.resolve(type === 'ttInfo' || type === 'ttStatus' ? { connected, tiktokId } : undefined)
    },
    timers,
  })
  return {
    watcher,
    sent,
    timers,
    go: (next: string) => {
      href = next
    },
    chats: () => sent.filter((m) => m.type === 'ttChats'),
  }
}

describe('관찰 켜고 끄기 (TikTokWatcher)', () => {
  it('AC-TTX-06: 내 방송이면 관찰하고 화면 아이디(적힌 그대로)와 함께 보낸다', async () => {
    const w = watcherWith('https://www.tiktok.com/@Seller_Kim/live?lang=ko')
    await w.watcher.start()
    expect(w.watcher.observing).toBe('Seller_Kim')
    appendComments(list, { text: '15' })
    w.watcher.reader.flush()
    expect(w.chats()).toEqual([{ type: 'ttChats', pageId: 'Seller_Kim', items: [expect.objectContaining({ text: '15' })] }])
    expect(w.sent.find((m) => m.type === 'ttStatus')).toMatchObject({ screen: 'OWN', hidden: false, read: 0, unread: 0 })
    w.watcher.stop()
  })

  it.each([
    ['남의 방송', OTHER_URL, 'seller_kim', true, 'OTHER'],
    ['프로필', 'https://www.tiktok.com/@seller_kim', 'seller_kim', true, 'ELSEWHERE'],
    ['추천', 'https://www.tiktok.com/foryou', 'seller_kim', true, 'ELSEWHERE'],
    ['영상', 'https://www.tiktok.com/@seller_kim/video/1', 'seller_kim', true, 'ELSEWHERE'],
    ['판매자 아이디 없음', OWN_URL, null, true, 'OTHER'],
    ['라이브지니와 연결 전', OWN_URL, null, false, 'OTHER'],
  ])('AC-TTX-06: %s → 관찰·보내기 0', async (_name, href, tiktokId, connected, screen) => {
    const w = watcherWith(href, tiktokId, connected)
    await w.watcher.start()
    expect(w.watcher.observing).toBeNull()
    expect(w.watcher.reader.running).toBe(false)
    appendComments(list, { text: '15' })
    await w.timers.advance(TT_STATUS_MS)
    expect(w.chats()).toEqual([])
    expect(w.sent.find((m) => m.type === 'ttStatus')).toMatchObject({ screen })
    w.watcher.stop()
  })

  it('AC-TTX-07: 주소만 남의 방송으로 바뀌면 2초 안에 관찰을 멈추고, 바뀐 뒤 붙은 것은 보내지 않는다. 돌아오면 그 뒤 새로 붙은 것만', async () => {
    const w = watcherWith(OWN_URL)
    await w.watcher.start()
    appendComments(list, { text: '15' })
    w.watcher.reader.flush()
    expect(w.chats()).toHaveLength(1)
    // 한 화면 앱 이동 흉내: 주소가 바뀌고 새 화면의 댓글이 붙는다 (관찰 콜백이 먼저 와도 보내지 않는다)
    w.go(OTHER_URL)
    appendComments(list, { text: '16' })
    w.watcher.reader.flush()
    await settle()
    expect(w.chats()).toHaveLength(1)
    await w.timers.advance(2 * TT_CHECK_MS)
    expect(w.watcher.reader.running).toBe(false)
    expect(w.sent.filter((m) => m.type === 'ttLeave')).toHaveLength(1)
    expect(w.sent.filter((m) => m.type === 'ttStatus').at(-1)).toMatchObject({ screen: 'OTHER' })
    appendComments(list, { text: '17' })
    await settle()
    expect(w.chats()).toHaveLength(1)
    // 다시 내 방송으로 → 그 뒤 새로 붙은 것만
    w.go(OWN_URL)
    await w.timers.advance(TT_CHECK_MS)
    expect(w.watcher.observing).toBe('seller_kim')
    appendComments(list, { text: '18' })
    w.watcher.reader.flush()
    expect(w.chats().map((m) => (m['items'] as TikTokItem[]).map((item) => item.text))).toEqual([['15'], ['18']])
    w.watcher.stop()
  })

  it('10초마다 상태를 보낸다 (읽은 수·읽지 못한 수 누적)', async () => {
    const w = watcherWith(OWN_URL)
    await w.watcher.start()
    appendComments(list, { text: '15' }, { userId: null })
    w.watcher.reader.flush()
    const before = w.sent.filter((m) => m.type === 'ttStatus').length
    await w.timers.advance(TT_STATUS_MS)
    const statuses = w.sent.filter((m) => m.type === 'ttStatus')
    expect(statuses.length).toBe(before + 1)
    expect(statuses.at(-1)).toMatchObject({ screen: 'OWN', read: 1, unread: 1 })
    w.watcher.stop()
  })

  it('서버가 판매자 아이디를 나중에 알려 주면 그때 관찰을 켠다', async () => {
    const sent: Sent[] = []
    let id: string | null = null
    const timers = new FakeIntervals()
    const watcher = new TikTokWatcher({
      document,
      href: () => OWN_URL,
      ask: (message) => {
        sent.push(message as Sent)
        return Promise.resolve({ connected: true, tiktokId: id })
      },
      timers,
    })
    await watcher.start()
    expect(watcher.observing).toBeNull()
    id = 'seller_kim'
    await timers.advance(TT_STATUS_MS)
    expect(watcher.observing).toBe('seller_kim')
    watcher.stop()
  })
})

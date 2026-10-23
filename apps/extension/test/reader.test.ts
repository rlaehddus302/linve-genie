// 유튜브 채팅 읽기 (AC-X1-01~05·19, YT-10 AC1·AC2) — 가짜 채팅 페이지(D-X1-15)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installBridge, handleBridge } from '../src/page-bridge.ts'
import { ChatReader, isLiveChatPage, readMessage, videoIdOf, type ChatMessage } from '../src/reader.ts'
import { BRIDGE_EVENT, SKIPPED_TAGS } from '../src/selectors.ts'
import { append, CHAT_URL, loadFakeChat, messageElement, POSTED_AT } from './fake-chat.ts'

let received: ChatMessage[] = []
let reader: ChatReader
let list: HTMLElement

beforeEach(() => {
  received = []
  list = loadFakeChat()
  installBridge(document)
  reader = new ChatReader({ document, onMessages: (messages) => received.push(...messages), now: () => 42 })
})

afterEach(() => {
  reader.stop()
  document.removeEventListener(BRIDGE_EVENT, handleBridge, true)
})

describe('새로 붙은 일반 채팅만 읽는다', () => {
  it('AC-X1-01: 일반 채팅 3개 → 3개, 메시지 ID·채널 ID·닉네임·본문·게시 시각', () => {
    expect(reader.start(CHAT_URL)).toBe(true)
    append(
      list,
      { id: 'ChwKGkNJTXNhMDAxMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCaaaaaaaaaaaaaaaaaaaaaa', nick: '초록손님', body: '3번' },
      { id: 'ChwKGkNJTXNhMDAyMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCbbbbbbbbbbbbbbbbbbbbbb', nick: '@다육사랑', body: ['5번 ', { emoji: '😀' }, ' 주세요'] },
      { id: 'ChwKGkNJTXNhMDAzMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCcccccccccccccccccccccc', nick: '<script>alert(1)</script>', body: '7번' },
    )
    reader.flush()
    expect(received).toEqual([
      { id: 'ChwKGkNJTXNhMDAxMDAwMDAwMDAwMDAwMDAwMDA', ch: 'UCaaaaaaaaaaaaaaaaaaaaaa', nick: '초록손님', text: '3번', at: POSTED_AT },
      { id: 'ChwKGkNJTXNhMDAyMDAwMDAwMDAwMDAwMDAwMDA', ch: 'UCbbbbbbbbbbbbbbbbbbbbbb', nick: '@다육사랑', text: '5번 😀 주세요', at: POSTED_AT },
      { id: 'ChwKGkNJTXNhMDAzMDAwMDAwMDAwMDAwMDAwMDA', ch: 'UCcccccccccccccccccccccc', nick: '<script>alert(1)</script>', text: '7번', at: POSTED_AT },
    ])
    expect(reader.counts).toEqual({ read: 3, unread: 0 })
  })

  it('D-X1-29: 방송자 글(주인 배지·author-type=owner)에는 방송자 표시를 붙여 보내고, 일반 시청자 글에는 붙이지 않는다', () => {
    reader.start(CHAT_URL)
    const [owned] = append(
      list,
      { id: 'ChwKGkNJTXNvMDAxMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCsellerchannel000000001', nick: '판매자', body: '3번 마감', owner: true },
      { id: 'ChwKGkNJTXNvMDAyMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCaaaaaaaaaaaaaaaaaaaaaa', body: '3번' },
    )
    // author-type만 있고 배지가 없어도 방송자 표시
    const typed = messageElement(document, { id: 'ChwKGkNJTXNvMDAzMDAwMDAwMDAwMDAwMDAwMDA', channel: 'UCsellerchannel000000001', body: '4번' })
    typed.setAttribute('author-type', 'owner')
    list.append(typed)
    reader.flush()
    expect(received.map((m) => m.owner)).toEqual([true, undefined, true])
    expect(owned?.hasAttribute('data-livegenie-owner-msg')).toBe(false)
  })

  it('AC-X1-01: MutationObserver가 스스로 알린다 (flush 없이)', async () => {
    reader.start(CHAT_URL)
    append(list, { body: '3번' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(received.map((m) => m.text)).toEqual(['3번'])
  })

  it('AC-X1-02: 슈퍼챗·멤버십·시스템 메시지는 읽지 않는다 (읽지 못함으로도 세지 않는다)', () => {
    reader.start(CHAT_URL)
    append(list, ...SKIPPED_TAGS.map((tag, i) => ({ tag: tag.toLowerCase(), id: `ChwKGkskip${String(i)}`, body: '3번' })))
    reader.flush()
    expect(received).toEqual([])
    expect(reader.counts).toEqual({ read: 0, unread: 0 })
  })

  it('AC-X1-03: 메시지 ID나 채널 ID가 없으면 보내지 않고 읽지 못함 +1', () => {
    reader.start(CHAT_URL)
    append(list, { id: null, body: '3번' })
    reader.flush()
    expect(received).toEqual([])
    expect(reader.counts.unread).toBe(1)
    append(list, { id: 'ChwKGkNJTXNiMDAxMDAwMDAwMDAwMDAwMDAwMDA', channel: null, body: '3번' })
    reader.flush()
    expect(received).toEqual([])
    expect(reader.counts.unread).toBe(2)
    // 화면이 바뀌어 요소 데이터를 못 읽는 경우(페이지 쪽 다리가 없음)도 같다
    document.removeEventListener(BRIDGE_EVENT, handleBridge, true)
    append(list, { id: 'ChwKGkNJTXNiMDAyMDAwMDAwMDAwMDAwMDAwMDA', body: '3번' })
    reader.flush()
    expect(reader.counts).toEqual({ read: 0, unread: 3 })
  })

  it('AC-X1-04: 시작 전에 있던 5개는 보내지 않고, 그 뒤 붙은 것만', () => {
    expect(document.querySelectorAll('yt-live-chat-text-message-renderer.old')).toHaveLength(5)
    reader.start(CHAT_URL)
    reader.flush()
    expect(received).toEqual([])
    append(list, { id: 'ChwKGkNJTXNjMDAxMDAwMDAwMDAwMDAwMDAwMDA', body: '9번' })
    reader.flush()
    expect(received.map((m) => m.text)).toEqual(['9번'])
    // 이미 있던 요소를 다시 붙여도(목록을 다시 그림) 보내지 않는다
    const old = document.querySelector('yt-live-chat-text-message-renderer.old') as Element
    list.append(old)
    reader.flush()
    expect(received).toHaveLength(1)
  })

  it('같은 메시지 ID가 다시 붙으면 한 번만', () => {
    reader.start(CHAT_URL)
    append(list, { id: 'ChwKGkNJTXNkMDAx', body: '3번' })
    append(list, { id: 'ChwKGkNJTXNkMDAx', body: '3번' })
    reader.flush()
    expect(received).toHaveLength(1)
  })

  it('목록이 통째로 다시 그려지면 그 안의 새 메시지도 읽는다', () => {
    reader.start(CHAT_URL)
    const wrapper = document.createElement('div')
    wrapper.append(messageElement(document, { id: 'ChwKGkNJTXNlMDAx', body: '4번' }))
    list.append(wrapper)
    reader.flush()
    expect(received.map((m) => m.text)).toEqual(['4번'])
  })

  it('AC-X1-24(D-X1-28): 게시 시각이 없으면 지금 시각으로 채우지 않고 "읽지 못함", 빈 본문은 보내지 않는다, 붙였던 속성은 지운다', () => {
    const element = messageElement(document, { usec: null, body: '3번' })
    list.append(element)
    const result = readMessage(element, () => 42)
    expect(result).toEqual({ kind: 'unread' })
    reader.start(CHAT_URL)
    const counted = messageElement(document, { id: 'ChwKGkNJTXNub3RpbWUx', usec: null, body: '4번' })
    const sent = received.length
    list.append(counted)
    reader.flush()
    expect(received).toHaveLength(sent)
    expect(reader.counts.unread).toBe(1)
    expect(element.hasAttribute('data-livegenie-ch')).toBe(false)
    expect(element.hasAttribute('data-livegenie-at')).toBe(false)
    const blank = messageElement(document, { body: '   ' })
    list.append(blank)
    expect(readMessage(blank, () => 42)).toEqual({ kind: 'skip' })
  })
})

describe('AC-X1-05: 읽는 곳', () => {
  it.each([
    ['https://www.youtube.com/live_chat?v=abcdEFGH123', true],
    ['https://www.youtube.com/live_chat?is_popout=1&v=abcdEFGH123', true],
    ['https://www.youtube.com/live_chat?continuation=0ofMyAN', true],
    ['https://www.youtube.com/live_chat_replay?continuation=0ofMyAN', false],
    ['https://www.youtube.com/watch?v=abcdEFGH123', false],
    ['https://www.youtube.com/', false],
    ['https://m.youtube.com/live_chat?v=abcdEFGH123', false],
    ['http://www.youtube.com/live_chat?v=abcdEFGH123', false],
    ['https://www.youtube.com.evil.example/live_chat?v=abcdEFGH123', false],
    ['https://example.com/live_chat?v=abcdEFGH123', false],
  ])('%s → %s', (href, expected) => {
    expect(isLiveChatPage(href)).toBe(expected)
  })

  it('다시 보기·다른 페이지에서는 관찰을 시작하지 않는다', () => {
    expect(reader.start('https://www.youtube.com/live_chat_replay?v=abcdEFGH123')).toBe(false)
    expect(reader.running).toBe(false)
    append(list, { body: '3번' })
    reader.flush()
    expect(received).toEqual([])
  })

  it('영상 ID: 채팅 주소의 v=, 없으면 바깥 시청 페이지', () => {
    expect(videoIdOf(CHAT_URL, null)).toBe('abcdEFGH123')
    expect(videoIdOf('https://www.youtube.com/live_chat?continuation=x', 'https://www.youtube.com/watch?v=zzzzYYYY_-1')).toBe('zzzzYYYY_-1')
    expect(videoIdOf('https://www.youtube.com/live_chat?continuation=x', 'https://www.youtube.com/live/zzzzYYYY_-1')).toBe('zzzzYYYY_-1')
    expect(videoIdOf('https://www.youtube.com/live_chat?continuation=x', null)).toBeNull()
    expect(videoIdOf('https://www.youtube.com/live_chat?v=bad', 'https://evil.example/watch?v=zzzzYYYY_-1')).toBeNull()
  })
})

// 가짜 유튜브 채팅 페이지 도우미 (D-X1-15): 고정 HTML을 jsdom 문서에 넣고, 실제 유튜브처럼 새 메시지 요소를 목록 끝에 붙인다.
import { ITEM_LIST } from '../src/selectors.ts'
import FIXTURE from './fixtures/live-chat.html?raw'

export const CHAT_URL = 'https://www.youtube.com/live_chat?is_popout=1&v=abcdEFGH123'
export const POSTED_AT = 1_761_200_000_123

export function loadFakeChat(doc: Document = document): HTMLElement {
  doc.body.innerHTML = FIXTURE
  setInputOwner(doc, true)
  return doc.querySelector(ITEM_LIST) as HTMLElement
}

export const OWNER_BADGES = [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' }, tooltip: '소유자' } }]

/**
 * 입력 칸 묶음의 data — 실제 유튜브 모양(HG-X1 실물 확인, D-X1-29): 채널 ID가 없고 authorBadges만 있다.
 * owner = 로그인 계정이 방송 채널 주인(OWNER 배지)인가
 */
export function setInputOwner(doc: Document, owner: boolean): void {
  const input = doc.querySelector('yt-live-chat-message-input-renderer')
  if (input === null) return
  ;(input as unknown as { data: unknown }).data = {
    authorName: { simpleText: '판매자' },
    inputField: {},
    sendButton: {},
    pickers: [],
    pickerButtons: [],
    authorPhoto: {},
    authorBadges: owner ? OWNER_BADGES : [],
    targetId: 'live-chat-message-input',
    emojiPickerButton: {},
  }
}

export interface FakeMessage {
  readonly id?: string | null
  readonly channel?: string | null
  readonly nick?: string
  /** 글자와 이모지(alt) — 문자열이면 글자 하나 */
  readonly body?: string | readonly ({ readonly emoji: string } | string)[]
  readonly usec?: string | null
  readonly tag?: string
  /** 방송자 글 (실제 유튜브: author-type="owner", 이름에 class owner, data.authorBadges에 OWNER) */
  readonly owner?: boolean
}

/** 메시지 요소 만들기 (실제 유튜브처럼 id 속성 = 메시지 ID, data = { authorExternalChannelId, timestampUsec }) */
export function messageElement(doc: Document, message: FakeMessage): HTMLElement {
  const element = doc.createElement(message.tag ?? 'yt-live-chat-text-message-renderer')
  if (message.id !== null) element.id = message.id ?? 'ChwKGkNJTXN0ZXN0MDAwMDAwMDAwMDAwMDAwMDA'
  const content = doc.createElement('div')
  content.id = 'content'
  const name = doc.createElement('span')
  name.id = 'author-name'
  name.textContent = message.nick ?? '초록손님'
  const body = doc.createElement('span')
  body.id = 'message'
  const parts = typeof message.body === 'string' || message.body === undefined ? [message.body ?? '3번'] : message.body
  for (const part of parts) {
    if (typeof part === 'string') body.append(doc.createTextNode(part))
    else {
      const img = doc.createElement('img')
      img.className = 'emoji'
      img.setAttribute('alt', part.emoji)
      body.append(img)
    }
  }
  if (message.owner === true) {
    element.setAttribute('author-type', 'owner')
    name.className = 'owner'
  }
  content.append(name, body)
  element.append(content)
  const data: Record<string, unknown> = {}
  if (message.channel !== null) data['authorExternalChannelId'] = message.channel ?? 'UCabcdefghijklmnopqrstuv'
  if (message.owner === true) data['authorBadges'] = OWNER_BADGES
  if (message.usec !== null) data['timestampUsec'] = message.usec ?? String(POSTED_AT * 1000 + 456)
  ;(element as unknown as { data: unknown }).data = data
  return element
}

export function append(list: HTMLElement, ...messages: FakeMessage[]): HTMLElement[] {
  const elements = messages.map((message) => messageElement(list.ownerDocument, message))
  list.append(...elements)
  return elements
}

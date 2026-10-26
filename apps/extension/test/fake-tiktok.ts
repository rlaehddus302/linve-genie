// 가짜 틱톡 라이브 페이지 도우미 (TTX D-TTX-11): 고정 HTML을 jsdom 문서에 넣고 새 댓글 요소를 목록 끝에 붙인다.
// 이름은 src/tiktok-selectors.ts의 것만 쓴다 — 실제 틱톡 구조를 지어내지 않는다.
import { TT_COMMENT, TT_COMMENT_LIST, TT_COMMENT_ID_ATTR, TT_NICKNAME, TT_TEXT, TT_UNIQUE_ID_ATTR, TT_USER_ID_ATTR } from '../src/tiktok-selectors.ts'
import FIXTURE from './fixtures/tiktok-live.html?raw'

export const OWN_URL = 'https://www.tiktok.com/@seller_kim/live'
export const OTHER_URL = 'https://www.tiktok.com/@other_seller/live'

export function loadFakeTikTok(doc: Document = document): HTMLElement {
  doc.body.innerHTML = FIXTURE
  return doc.querySelector(TT_COMMENT_LIST) as HTMLElement
}

export interface FakeComment {
  readonly commentId?: string | null
  readonly userId?: string | null
  readonly uniqueId?: string | null
  readonly nickname?: string | null
  readonly text?: string | null
}

const cls = (selector: string) => selector.replace(/^\./, '')

let n = 100
/** 댓글 요소 만들기 (값을 null로 주면 그 칸이 없다) */
export function commentElement(doc: Document, c: FakeComment = {}): HTMLElement {
  n += 1
  const element = doc.createElement('div')
  element.className = cls(TT_COMMENT)
  const commentId = c.commentId === undefined ? `73010000000000${String(n).padStart(5, '0')}` : c.commentId
  const userId = c.userId === undefined ? `71010000000000${String(n).padStart(5, '0')}` : c.userId
  const uniqueId = c.uniqueId === undefined ? `buyer_${String(n)}` : c.uniqueId
  if (commentId !== null) element.setAttribute(TT_COMMENT_ID_ATTR, commentId)
  if (userId !== null) element.setAttribute(TT_USER_ID_ATTR, userId)
  if (uniqueId !== null) element.setAttribute(TT_UNIQUE_ID_ATTR, uniqueId)
  if (c.nickname !== null) {
    const nick = doc.createElement('span')
    nick.className = cls(TT_NICKNAME)
    nick.textContent = c.nickname ?? '홍길동'
    element.append(nick)
  }
  if (c.text !== null) {
    const text = doc.createElement('span')
    text.className = cls(TT_TEXT)
    text.textContent = c.text ?? '15'
    element.append(text)
  }
  return element
}

export function appendComments(list: HTMLElement, ...comments: FakeComment[]): HTMLElement[] {
  const elements = comments.map((c) => commentElement(list.ownerDocument, c))
  list.append(...elements)
  return elements
}

/** 댓글이 아닌 요소 (선물·입장·좋아요·시스템 흉내) */
export function notCommentElement(doc: Document, selector: string): HTMLElement {
  const element = doc.createElement('div')
  element.className = cls(selector)
  element.textContent = '선물을 보냈어요 15'
  return element
}

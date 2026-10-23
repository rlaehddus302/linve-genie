// 페이지 쪽 스크립트 (X1 D-X1-03): 유튜브 채팅 요소의 데이터에서 작성자 채널 ID·게시 시각만 꺼내 그 요소에 잠깐 속성으로 붙인다.
// 확장(content script)은 페이지의 자바스크립트 값을 볼 수 없어서, 요청 이벤트를 받을 때만 이 일을 한다.
// 감사 올리기(AC12)를 위해 "로그인한 채널·방송 채널" 물음(livegenie-who)에도 채널 ID 두 개만 답한다.
// 하는 일은 이것뿐이다 — 유튜브 요청을 가로채거나 부르지 않고, 누르거나 입력하지 않고, 닉네임·본문을 다루지 않는다.
import {
  BRIDGE_EVENT,
  CHANNEL_ATTR,
  DATA_BADGES_KEY,
  DATA_CHANNEL_KEY,
  DATA_TIMESTAMP_KEY,
  INPUT_RENDERER,
  ME_ATTR,
  ME_DATA_PATHS,
  OWNER_ATTR,
  OWNER_BADGE_ICON,
  OWNER_GLOBAL_PATHS,
  POSTED_AT_ATTR,
  TEXT_MESSAGE_TAG,
  WHO_EVENT,
} from './selectors.ts'

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null

/** 요소의 데이터 (Polymer: element.data, 옛 모양: element.__data.data) */
function dataOf(element: Element): Bag | null {
  const own = element as unknown as Bag
  if (isBag(own['data'])) return own['data']
  const inner = own['__data']
  if (isBag(inner) && isBag(inner['data'])) return inner['data']
  return null
}

const CHANNEL_RE = /^[A-Za-z0-9_-]{1,64}$/

function at(root: unknown, path: readonly string[]): unknown {
  let value = root
  for (const key of path) {
    if (!isBag(value)) return undefined
    value = value[key]
  }
  return value
}

const channelOrNull = (value: unknown): string | null => (typeof value === 'string' && CHANNEL_RE.test(value) ? value : null)

/** 주인 배지가 붙은 메시지인가 (data.authorBadges[].liveChatAuthorBadgeRenderer.icon.iconType === OWNER) */
function ownerBadged(data: Bag): boolean {
  const badges = data[DATA_BADGES_KEY]
  if (!Array.isArray(badges)) return false
  return badges.some((badge) => at(badge, ['liveChatAuthorBadgeRenderer', 'icon', 'iconType']) === OWNER_BADGE_ICON)
}

/** 본 적 있는 방송 채널 (주인 배지 메시지는 화면에서 밀려나도 기억한다) */
let seenOwner: string | null = null

function noteOwner(data: Bag): void {
  if (!ownerBadged(data)) return
  const channel = channelOrNull(data[DATA_CHANNEL_KEY])
  if (channel !== null) seenOwner = channel
}

/** 로그인한 채널·방송 채널 (못 읽으면 null) */
export function readIdentity(doc: Document, win: unknown = globalThis): { readonly me: string | null; readonly owner: string | null } {
  let me: string | null = null
  const input = doc.querySelector(INPUT_RENDERER)
  const inputData = input === null ? null : dataOf(input)
  if (inputData !== null) {
    for (const path of ME_DATA_PATHS) {
      me = channelOrNull(at(inputData, path))
      if (me !== null) break
    }
  }
  for (const element of Array.from(doc.getElementsByTagName(TEXT_MESSAGE_TAG.toLowerCase()))) {
    const data = dataOf(element)
    if (data !== null) noteOwner(data)
  }
  let owner = seenOwner
  if (owner === null) {
    for (const path of OWNER_GLOBAL_PATHS) {
      owner = channelOrNull(at(win, path))
      if (owner !== null) break
    }
  }
  return { me, owner }
}

/** 시험용: 기억한 방송 채널 지우기 */
export function forgetOwner(): void {
  seenOwner = null
}

/** 물음 이벤트를 받으면 문서 맨 바깥 요소에 두 채널 ID를 잠깐 붙인다 (content script가 읽고 지운다) */
export function handleWho(event: Event): void {
  const doc = (event.target as Node | null)?.ownerDocument ?? (event.target as Document | null)
  if (doc === null || typeof (doc as Document).querySelector !== 'function') return
  const { me, owner } = readIdentity(doc as Document, (doc as Document).defaultView ?? globalThis)
  const root = (doc as Document).documentElement
  if (me !== null) root.setAttribute(ME_ATTR, me)
  if (owner !== null) root.setAttribute(OWNER_ATTR, owner)
}

/** 요청 이벤트를 받으면 채널 ID·게시 시각(밀리초)을 속성으로 붙인다 */
export function handleBridge(event: Event): void {
  const target = event.target
  if (typeof target !== 'object' || target === null || (target as Element).tagName !== TEXT_MESSAGE_TAG) return
  const element = target as Element
  const data = dataOf(element)
  if (data === null) return
  noteOwner(data)
  const channel = data[DATA_CHANNEL_KEY]
  if (typeof channel === 'string') element.setAttribute(CHANNEL_ATTR, channel)
  const usec = data[DATA_TIMESTAMP_KEY]
  if (typeof usec === 'string' && /^\d{1,19}$/.test(usec)) element.setAttribute(POSTED_AT_ATTR, String(Math.floor(Number(usec) / 1000)))
}

export function installBridge(doc: Document): void {
  doc.addEventListener(BRIDGE_EVENT, handleBridge, true)
  doc.addEventListener(WHO_EVENT, handleWho, true)
}

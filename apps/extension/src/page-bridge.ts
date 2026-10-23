// 페이지 쪽 스크립트 (X1 D-X1-03): 유튜브 채팅 요소의 데이터에서 작성자 채널 ID·게시 시각만 꺼내 그 요소에 잠깐 속성으로 붙인다.
// 확장(content script)은 페이지의 자바스크립트 값을 볼 수 없어서, 요청 이벤트를 받을 때만 이 일을 한다.
// 하는 일은 이것뿐이다 — 유튜브 요청을 가로채거나 부르지 않고, 누르거나 입력하지 않고, 닉네임·본문을 다루지 않는다.
import { BRIDGE_EVENT, CHANNEL_ATTR, DATA_CHANNEL_KEY, DATA_TIMESTAMP_KEY, POSTED_AT_ATTR, TEXT_MESSAGE_TAG } from './selectors.ts'

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

/** 요청 이벤트를 받으면 채널 ID·게시 시각(밀리초)을 속성으로 붙인다 */
export function handleBridge(event: Event): void {
  const target = event.target
  if (typeof target !== 'object' || target === null || (target as Element).tagName !== TEXT_MESSAGE_TAG) return
  const element = target as Element
  const data = dataOf(element)
  if (data === null) return
  const channel = data[DATA_CHANNEL_KEY]
  if (typeof channel === 'string') element.setAttribute(CHANNEL_ATTR, channel)
  const usec = data[DATA_TIMESTAMP_KEY]
  if (typeof usec === 'string' && /^\d{1,19}$/.test(usec)) element.setAttribute(POSTED_AT_ATTR, String(Math.floor(Number(usec) / 1000)))
}

export function installBridge(doc: Document): void {
  doc.addEventListener(BRIDGE_EVENT, handleBridge, true)
}

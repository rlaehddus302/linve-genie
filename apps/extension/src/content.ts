// content script (유튜브 live_chat 페이지, 시청 페이지 안 iframe 포함). 읽기만 한다 — reader.ts.
// 새 채팅은 서비스 워커로 넘기고, 10초마다·탭이 숨거나 보일 때 상태(숨음·읽은 수·읽지 못한 수)를 넘긴다.
import { chromeApi } from './chrome.ts'
import { ChatReader, isLiveChatPage, videoIdOf } from './reader.ts'

const STATUS_MS = 10_000

function topHref(): string | null {
  try {
    return window.top === window ? null : (window.top?.location.href ?? null)
  } catch {
    return null
  }
}

function main(): void {
  if (!isLiveChatPage(location.href)) return
  const chrome = chromeApi()
  const v = videoIdOf(location.href, topHref())
  const send = (message: unknown) => {
    chrome.runtime.sendMessage(message).catch(() => undefined)
  }
  const reader = new ChatReader({
    document,
    onMessages: (messages) => {
      if (v !== null) send({ type: 'chats', v, messages })
    },
  })
  const status = () => send({ type: 'status', v, hidden: document.hidden, ...reader.counts })
  const begin = () => {
    if (!reader.start(location.href)) return
    status()
    setInterval(status, STATUS_MS)
    document.addEventListener('visibilitychange', status)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true })
  else begin()
}

main()

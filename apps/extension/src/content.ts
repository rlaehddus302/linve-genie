// content script (유튜브 live_chat 페이지, 시청 페이지 안 iframe 포함).
// - 읽기(reader.ts): 새 채팅은 서비스 워커로 넘기고, 10초마다·탭이 숨거나 보일 때 상태(숨음·읽은 수·읽지 못한 수)를 넘긴다.
// - 감사 올리기(poster.ts, 선택 기능): 서버가 켜져 있다고 할 때만 서버가 준 감사 글을 입력 칸에 넣고 보낸다.
import { chromeApi } from './chrome.ts'
import { ThanksPoster } from './poster.ts'
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
  const ask = async (message: unknown): Promise<unknown> => {
    try {
      return await chrome.runtime.sendMessage(message)
    } catch {
      return undefined
    }
  }
  const poster =
    v === null
      ? null
      : new ThanksPoster({
          document,
          video: v,
          ask,
          timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
        })
  const reader = new ChatReader({
    document,
    onMessages: (messages) => {
      if (v !== null) send({ type: 'chats', v, messages })
      poster?.onMessages(messages)
    },
  })
  const status = () => send({ type: 'status', v, hidden: document.hidden, ...reader.counts })
  const begin = () => {
    if (!reader.start(location.href)) return
    status()
    setInterval(status, STATUS_MS)
    document.addEventListener('visibilitychange', status)
    poster?.start()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true })
  else begin()
}

main()

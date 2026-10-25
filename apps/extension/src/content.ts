// content script (유튜브 live_chat 페이지, 시청 페이지 안 iframe 포함).
// - 읽기(reader.ts): 새 채팅은 서비스 워커로 넘기고, 10초마다·탭이 숨거나 보일 때 상태(숨음·읽은 수·읽지 못한 수)를 넘긴다.
// - 감사 올리기(poster.ts, 선택 기능): 서버가 켜져 있다고 할 때만 서버가 준 감사 글을 입력 칸에 넣고 보낸다.
import { ASK_STATUS, chromeApi } from './chrome.ts'
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

/** 바깥 시청 페이지 주소: window.top이 안 되면 이 iframe을 연 페이지(referrer — 같은 사이트라 전체 주소) */
function outerHref(): string | null {
  return topHref() ?? (document.referrer === '' ? null : document.referrer)
}

function main(): void {
  if (!isLiveChatPage(location.href)) return
  const chrome = chromeApi()
  let v = videoIdOf(location.href, topHref()) ?? videoIdOf(location.href, outerHref())
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
  let poster: ThanksPoster | null = null
  let started = false
  const makePoster = () => {
    if (v === null || poster !== null) return
    poster = new ThanksPoster({
      document,
      video: v,
      ask,
      timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    })
    if (started) poster.start()
  }
  makePoster()
  const reader = new ChatReader({
    document,
    onMessages: (messages) => {
      if (v !== null) send({ type: 'chats', v, messages })
      poster?.onMessages(messages)
    },
  })
  // 영상 ID를 못 꺼냈으면 서비스 워커가 보낸 탭 주소로 정해 준 것을 받아 쓴다
  const status = () => {
    void ask({ type: 'status', v, hidden: document.hidden, ...reader.counts }).then((reply) => {
      const known = typeof reply === 'object' && reply !== null ? (reply as { frameVideo?: unknown }).frameVideo : undefined
      if (v === null && typeof known === 'string') {
        v = known
        makePoster()
      }
    })
  }
  const begin = () => {
    if (!reader.start(location.href)) return
    status()
    setInterval(status, STATUS_MS)
    document.addEventListener('visibilitychange', status)
    // 워커가 쉬었다 깨어나 프레임을 모르면 팝업을 열 때 묻는다 — 이 확장이 물은 것에만 답한다
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== chrome.runtime.id) return undefined
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === ASK_STATUS) status()
      return undefined
    })
    started = true
    poster?.start()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true })
  else begin()
}

main()

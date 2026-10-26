// 틱톡 content script 진입점 (www.tiktok.com 전체에 들어가고, 내 방송 화면일 때만 관찰한다 — D-TTX-02). 일은 tiktok-watch.ts.
// 페이지 쪽 스크립트는 없다 — 화면 요소의 글자·속성만 읽는다(요청 가로채기·누르기·입력·쿠키 없음, D-TTX-01·04).
import { chromeApi } from './chrome.ts'
import { isTikTokPage } from './tiktok-reader.ts'
import { TikTokWatcher } from './tiktok-watch.ts'

function main(): void {
  if (window.top !== window || !isTikTokPage(location.href)) return
  const chrome = chromeApi()
  const watcher = new TikTokWatcher({
    document,
    href: () => location.href,
    ask: async (message) => {
      try {
        return await chrome.runtime.sendMessage(message)
      } catch {
        return undefined
      }
    },
    timers: { every: (fn, ms) => setInterval(fn, ms), cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
  })
  const begin = () => void watcher.start()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true })
  else begin()
}

main()

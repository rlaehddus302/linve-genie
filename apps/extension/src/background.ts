// 서비스 워커 진입점 (MV3). 일은 hub.ts가 한다.
import { chromeApi } from './chrome.ts'
import { SERVER_ORIGIN } from './config.ts'
import { Hub } from './hub.ts'

const chrome = chromeApi()
const hub = new Hub(chrome, SERVER_ORIGIN)

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // 이 확장의 페이지(팝업·content script)가 보낸 것만 받는다. 어느 쪽 메시지인지는 hub가 보낸 곳 주소로 다시 본다(RA-X1-04)
  if (sender.id !== chrome.runtime.id) return undefined
  void hub.handle(message, sender).then(respond, () => respond(undefined))
  return true
})

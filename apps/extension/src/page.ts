// 페이지 쪽 스크립트 진입점 (매니페스트 world: MAIN, live_chat 페이지만). 일은 page-bridge.ts.
import { isLiveChatPage } from './reader.ts'
import { installBridge } from './page-bridge.ts'

if (isLiveChatPage(location.href)) installBridge(document)

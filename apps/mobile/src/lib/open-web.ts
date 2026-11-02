// 앱 밖으로 나가는 링크 (APP-01 AC4): "웹으로 열기"와 바깥 주소는 앱 안이 아니라 기기 브라우저로 연다.
// 여는 함수는 바꿔 끼울 수 있다(앱은 React Native Linking.openURL, 시험은 가짜).
import { withFromApp } from '@livejjim/web/src/lib/app-tab.ts'
import { apiConfig, webUrl } from '../api/config.ts'

type Opener = (url: string) => Promise<void>

let opener: Opener = async () => {
  // 앱 시작 때 Linking.openURL로 바꿔 끼운다 (app/_layout.tsx)
}

export function setWebOpener(next: Opener): void {
  opener = next
}

/** 웹 화면 경로(`/settlements?date=…`)를 기기 브라우저로 연다 — 주소에 `from=app`이 붙는다(PAY2 BL-11 3.1, webUrl) */
export function openWeb(path: string): Promise<void> {
  return opener(webUrl(path))
}

/** 바깥 주소(개인정보처리방침 등)를 기기 브라우저로 연다. 라이브지니 서버 주소면 `from=app`을 붙이고, 밖 주소는 그대로 연다 (BL-11 3.1) */
export function openExternal(url: string): Promise<void> {
  return opener(withFromApp(url, apiConfig().baseUrl))
}

/** 앱에 아직 없는 화면의 웹 경로 (APP-01 "그 밖 화면은 웹으로 열기") */
export const WEB_SCREENS: readonly { readonly key: string; readonly word: string; readonly path: string }[] = [
  { key: 'buyers', word: '구매자', path: '/buyers' },
  { key: 'ledger', word: '판매대장·영수증', path: '/receipts' },
  { key: 'shop', word: '가게·설정 전체', path: '/settings' },
  { key: 'sms', word: '문자찜 입력(전체)', path: '/sms' },
]

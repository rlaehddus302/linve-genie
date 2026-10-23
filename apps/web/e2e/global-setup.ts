// E2E 시작 전 확인 (AC-S05-91): 크로미움이 없으면 설치 명령을 알려 주고 멈춘다.
// WebKit(아이폰 크기 묶음 webkit-iphone, D-I5-08)이 없으면 설치 명령을 먼저 알린다(SA-I5-01). 멈추지는 않는다 — 크로미움 묶음만 도는 실행을
// 막지 않고, 그 묶음은 브라우저를 열지 못해 스스로 실패한다(건너뛰지 않음, AC-I5-90).
import { existsSync } from 'node:fs'
import { chromium, webkit } from '@playwright/test'

export const CHROMIUM_MISSING = 'Playwright 크로미움이 설치되어 있지 않아요. 먼저 이 명령을 실행해 주세요: pnpm exec playwright install chromium (아이폰 크기 시험도 돌리려면 pnpm exec playwright install webkit 도 함께)'
export const WEBKIT_MISSING = 'Playwright WebKit이 설치되어 있지 않아요. 아이폰 크기 시험(webkit-iphone)은 실패해요. 이 명령을 실행해 주세요: pnpm exec playwright install webkit'

function installed(executable: () => string): boolean {
  try {
    return existsSync(executable())
  } catch {
    return false
  }
}

export default function globalSetup(): void {
  if (!installed(() => chromium.executablePath())) throw new Error(CHROMIUM_MISSING)
  if (!installed(() => webkit.executablePath())) console.warn(WEBKIT_MISSING)
}

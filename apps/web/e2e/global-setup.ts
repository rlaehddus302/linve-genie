// E2E 시작 전 확인 (AC-S05-91): 크로미움이 없으면 설치 명령을 알려 주고 멈춘다.
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

export default function globalSetup(): void {
  const executable = chromium.executablePath()
  if (!existsSync(executable)) {
    throw new Error('Playwright 크로미움이 설치되어 있지 않아요. 먼저 이 명령을 실행해 주세요: pnpm exec playwright install chromium')
  }
}

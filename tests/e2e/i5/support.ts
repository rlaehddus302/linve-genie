// I5 E2E 공용 도우미 (test-e2e): 사파리 흉내 가짜 인식 (acceptance AC-I5-20의 모양).
// - webkitSpeechRecognition만 있고 SpeechRecognition은 undefined.
// - interimResults를 무시한다(시험이 일부러 isFinal false를 보낼 때만 중간 결과가 간다 — AC-I5-22).
// - 최종 결과 하나 뒤 곧(FINAL_END_MS) onend, 말이 없으면 연 지 silenceMs 뒤 onend. 시각은 페이지의 Date.now·setTimeout(page.clock이 당긴다).
// 화면 코드에 시험용 갈림길·전역 훅은 없다 — 이 스크립트는 addInitScript로 페이지 전역 생성자만 바꾼다.
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { login, openNewBroadcast, uniqueDate } from '../i4/support.ts'

export * from '../i4/support.ts'

/** 최종 결과 뒤 onend까지 (사파리는 최종 결과 뒤 곧 끝난다) */
export const FINAL_END_MS = 100

export interface SafariSpeechOptions {
  /** 그 기기에 안내 확인을 미리 남긴다 */
  readonly consent?: boolean
  /** 그 기기의 음성 설정 */
  readonly settings?: unknown
  /** 말이 없으면 연 지 이만큼 뒤 onend (기본 3000) */
  readonly silenceMs?: number
  /** 홈 화면 앱 흉내 (navigator.standalone = true) */
  readonly standalone?: boolean
  /** 두 생성자를 모두 지운다 (지원 안 함) */
  readonly unsupported?: boolean
}

export async function installSafariSpeech(target: Page | BrowserContext, options: SafariSpeechOptions = {}): Promise<void> {
  await target.addInitScript((opts: SafariSpeechOptions) => {
    interface Rec {
      lang: string
      continuous: boolean
      interimResults: boolean
      onresult: ((event: unknown) => void) | null
      onerror: ((event: unknown) => void) | null
      onend: (() => void) | null
      results: { isFinal: boolean; length: number; 0: { transcript: string } }[]
      startedAt: number
      ended: boolean
      timer: ReturnType<typeof setTimeout> | null
    }
    const state = { instances: [] as Rec[], starts: 0, stops: 0, aborts: 0, getUserMedia: 0, constructed: 0, silenceMs: opts.silenceMs ?? 3000 }
    ;(window as unknown as { __speech: typeof state }).__speech = state
    try {
      if (opts.consent === true) window.localStorage.setItem('livejjim.voiceConsent', 'yes')
      if (opts.settings !== undefined) window.localStorage.setItem('livejjim.voiceSettings', JSON.stringify(opts.settings))
    } catch {
      // 첫 페이지(about:blank)는 저장소가 없다
    }
    if (opts.standalone === true) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    const media = navigator.mediaDevices as MediaDevices | undefined
    if (media !== undefined) {
      const original = media.getUserMedia?.bind(media)
      media.getUserMedia = (constraints?: MediaStreamConstraints) => {
        state.getUserMedia++
        return original === undefined ? Promise.reject(new Error('없음')) : original(constraints)
      }
    }
    const w = window as unknown as Record<string, unknown>
    delete w['SpeechRecognition']
    delete w['webkitSpeechRecognition']
    w['SpeechRecognition'] = undefined
    w['webkitSpeechRecognition'] = undefined
    if (opts.unsupported === true) return
    class SafariRecognition implements Rec {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onend: (() => void) | null = null
      results: Rec['results'] = []
      startedAt = 0
      ended = false
      timer: ReturnType<typeof setTimeout> | null = null
      constructor() {
        state.constructed++
        state.instances.push(this)
      }
      start(): void {
        state.starts++
        this.startedAt = Date.now()
        // 말이 없으면 silenceMs 뒤 저절로 끝난다
        this.timer = setTimeout(() => this.end(), state.silenceMs)
      }
      stop(): void {
        state.stops++
        this.end()
      }
      abort(): void {
        state.aborts++
        this.end()
      }
      end(): void {
        if (this.ended) return
        this.ended = true
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = null
        this.onend?.()
      }
    }
    w['webkitSpeechRecognition'] = SafariRecognition
  }, options)
}

/**
 * 마지막(열린) 인식 객체가 결과 하나를 낸다. final이면 FINAL_END_MS 뒤 onend(사파리처럼).
 * final false면 그 자리를 중간 결과로 두고 endSoon이면 FINAL_END_MS 뒤 onend(최종 표시 없이 끝남, AC-I5-22).
 */
export async function safariSay(page: Page, text: string, options: { final?: boolean; endSoon?: boolean } = {}): Promise<void> {
  await page.evaluate(({ text, final, endSoon, ms }) => {
    interface R { ended: boolean; timer: ReturnType<typeof setTimeout> | null; results: { isFinal: boolean; length: number; 0: { transcript: string } }[]; onresult: ((e: unknown) => void) | null; end(): void }
    const s = (window as unknown as { __speech: { instances: R[] } }).__speech
    const rec = s.instances.at(-1)
    if (rec === undefined || rec.ended) throw new Error('열린 인식 객체가 없다')
    const last = rec.results.at(-1)
    if (last !== undefined && !last.isFinal) rec.results.pop()
    const resultIndex = rec.results.length
    rec.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
    // 말이 들렸다 — 조용함 타이머는 멈춘다
    if (rec.timer !== null) clearTimeout(rec.timer)
    rec.timer = null
    rec.onresult?.({ resultIndex, results: rec.results })
    if (final || endSoon) rec.timer = setTimeout(() => rec.end(), ms)
  }, { text, final: options.final ?? true, endSoon: options.endSoon ?? false, ms: FINAL_END_MS })
}

/** 마지막 인식 객체가 오류를 내고 끝난다 (사파리: 오류 뒤 onend) */
export async function safariError(page: Page, error: string): Promise<void> {
  await page.evaluate((error) => {
    interface R { onerror: ((e: unknown) => void) | null; end(): void }
    const s = (window as unknown as { __speech: { instances: R[] } }).__speech
    const rec = s.instances.at(-1)
    if (rec === undefined) throw new Error('인식 객체가 없다')
    rec.onerror?.({ error })
    rec.end()
  }, error)
}

/** 마지막 인식 객체가 바로(연 지 0초) 끝난다 */
export async function safariEndNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface R { end(): void }
    const s = (window as unknown as { __speech: { instances: R[] } }).__speech
    s.instances.at(-1)?.end()
  })
}

export async function safariCounts(page: Page): Promise<{ constructed: number; starts: number; getUserMedia: number }> {
  return await page.evaluate(() => {
    const s = (window as unknown as { __speech?: { constructed: number; starts: number; getUserMedia: number } }).__speech
    return s === undefined ? { constructed: 0, starts: 0, getUserMedia: 0 } : { constructed: s.constructed, starts: s.starts, getUserMedia: s.getUserMedia }
  })
}

/** 오류 문장 (AC-I5-06 글자 그대로) */
export const MSG = {
  UNSUPPORTED: '이 기기에서는 음성이 어려워요. PC 크롬이나 안드로이드 크롬에서 켜 주세요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.',
  PERMISSION_DENIED: '마이크 사용이 막혀 있어요. PC·안드로이드 크롬은 주소창 왼쪽 자물쇠에서, 아이폰은 설정 > 사파리 > 마이크에서 허용해 주세요.',
  SERVICE_OFF: '이 기기에서 음성 인식이 꺼져 있어요. 아이폰은 설정에서 Siri와 받아쓰기를 켜 주세요. 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.',
  RESTART_BLOCKED: "이 기기는 음성이 저절로 다시 켜지지 않아요. 말하기 전에 '음성 켜기'를 다시 눌러 주세요.",
  KEEPS_STOPPING: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.',
} as const

export const SENT = '음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.'
export const OLD_SENT = '음성은 인식을 위해 구글로 보내져요.'
export const CONSENT_SENT = '음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브찜은 음성을 녹음하거나 저장하지 않아요.'
export const STANDALONE = '홈 화면 앱에서는 음성이 자주 끊길 수 있어요. 안 되면 사파리에서 열어 주세요.'
export const AUTO_ON = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }

/** 상태 글자 (음성 칸의 첫 status) */
export function voiceStatus(page: Page) {
  return page.getByRole('region', { name: '음성 등록' }).getByRole('status').first()
}

/** 시계를 깔고(흐르는 채) 로그인·새 방송 콘솔 */
export async function clockConsole(page: Page): Promise<{ b: string; date: string }> {
  await page.clock.install()
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  return { b, date }
}

/** 시계를 지금에서 멈춘다 (그 뒤 runFor로만 흐른다) */
export async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 10)
}

/** 음성 칸 알림이 그 문장 */
export async function expectAlert(page: Page, text: string): Promise<void> {
  await expect(page.getByRole('region', { name: '음성 등록' }).getByRole('alert').filter({ hasText: text })).toBeVisible()
}

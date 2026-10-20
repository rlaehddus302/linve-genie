// I4 E2E 공용 도우미 (test-e2e): 가짜 음성 인식(시험 계약 — acceptance.md "가짜 음성 인식"), 음성 칸 선택자.
// 화면은 "음성 켜기"를 누를 때 globalThis에서 SpeechRecognition·webkitSpeechRecognition을 찾는다. 시험은 페이지를 열기 전에 addInitScript로 바꾼다.
import { expect, type BrowserContext, type Page } from '@playwright/test'

export * from '../s06/support.ts'

export interface FakeSpeechOptions {
  /** 생성자를 둘 다 지운다 (지원하지 않는 브라우저) */
  readonly unsupported?: boolean
  /** 그 기기에 안내 확인을 미리 남긴다 */
  readonly consent?: boolean
  /** 그 기기의 음성 설정 (그대로 JSON으로 저장) */
  readonly settings?: unknown
  /** localStorage 읽기·쓰기가 예외 */
  readonly blockStorage?: boolean
}

/** 페이지를 열기 전에 부른다 (컨텍스트 또는 페이지) */
export async function installFakeSpeech(target: Page | BrowserContext, options: FakeSpeechOptions = {}): Promise<void> {
  await target.addInitScript((opts: FakeSpeechOptions) => {
    interface Rec {
      lang: string
      continuous: boolean
      interimResults: boolean
      onresult: ((event: unknown) => void) | null
      onerror: ((event: unknown) => void) | null
      onend: (() => void) | null
      results: { isFinal: boolean; length: number; 0: { transcript: string } }[]
      started: boolean
      stopped: boolean
    }
    const state = { instances: [] as Rec[], starts: 0, stops: 0, aborts: 0, getUserMedia: 0 }
    ;(window as unknown as { __speech: typeof state }).__speech = state
    try {
      if (opts.blockStorage === true) {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('막힘', 'SecurityError')
          },
        })
      } else {
        if (opts.consent === true) window.localStorage.setItem('livejjim.voiceConsent', 'yes')
        if (opts.settings !== undefined) window.localStorage.setItem('livejjim.voiceSettings', JSON.stringify(opts.settings))
      }
    } catch {
      // 첫 페이지(about:blank)는 저장소가 없다
    }
    const media = navigator.mediaDevices as MediaDevices | undefined
    if (media !== undefined) {
      const original = media.getUserMedia?.bind(media)
      media.getUserMedia = (constraints?: MediaStreamConstraints) => {
        state.getUserMedia++
        return original === undefined ? Promise.reject(new Error('없음')) : original(constraints)
      }
    }
    const w = window as unknown as Record<string, unknown>
    if (opts.unsupported === true) {
      delete w['SpeechRecognition']
      delete w['webkitSpeechRecognition']
      w['SpeechRecognition'] = undefined
      w['webkitSpeechRecognition'] = undefined
      return
    }
    class FakeRecognition implements Rec {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onend: (() => void) | null = null
      results: Rec['results'] = []
      started = false
      stopped = false
      constructor() {
        state.instances.push(this)
      }
      start(): void {
        state.starts++
        this.started = true
      }
      stop(): void {
        state.stops++
        this.stopped = true
      }
      abort(): void {
        state.aborts++
        this.stopped = true
      }
    }
    w['SpeechRecognition'] = FakeRecognition
    w['webkitSpeechRecognition'] = FakeRecognition
  }, options)
}

export interface SpeechCounts {
  readonly instances: number
  readonly starts: number
  readonly stops: number
  readonly aborts: number
  readonly getUserMedia: number
  readonly last: { readonly lang: string; readonly continuous: boolean; readonly interimResults: boolean } | null
}

export async function speechCounts(page: Page): Promise<SpeechCounts> {
  return await page.evaluate(() => {
    const s = (window as unknown as { __speech?: { instances: { lang: string; continuous: boolean; interimResults: boolean }[]; starts: number; stops: number; aborts: number; getUserMedia: number } }).__speech
    if (s === undefined) return { instances: 0, starts: 0, stops: 0, aborts: 0, getUserMedia: 0, last: null }
    const last = s.instances.at(-1)
    return { instances: s.instances.length, starts: s.starts, stops: s.stops, aborts: s.aborts, getUserMedia: s.getUserMedia, last: last === undefined ? null : { lang: last.lang, continuous: last.continuous, interimResults: last.interimResults } }
  })
}

/**
 * 마지막 인식 객체가 결과를 낸다. 중간 결과는 마지막 미확정 결과를 바꾸고, 최종 결과는 그 자리를 확정한다(크롬과 같은 모양).
 * 여러 문장을 한 번에 최종으로 내려면 texts에 여럿.
 */
export async function speak(page: Page, text: string | readonly string[], options: { final?: boolean; instance?: number } = {}): Promise<void> {
  const texts = typeof text === 'string' ? [text] : [...text]
  await page.evaluate(({ texts, final, instance }) => {
    const s = (window as unknown as { __speech: { instances: { onresult: ((e: unknown) => void) | null; results: { isFinal: boolean; length: number; 0: { transcript: string } }[] }[] } }).__speech
    const rec = instance === undefined ? s.instances.at(-1) : s.instances[instance]
    if (rec === undefined) throw new Error('인식 객체가 없다')
    const last = rec.results.at(-1)
    let resultIndex = rec.results.length
    if (last !== undefined && !last.isFinal) {
      rec.results.pop()
      resultIndex = rec.results.length
    }
    for (const t of texts) rec.results.push({ isFinal: final, length: 1, 0: { transcript: t } })
    if (rec.onresult === null) throw new Error('onresult가 없다')
    rec.onresult({ resultIndex, results: rec.results })
  }, { texts, final: options.final ?? true, instance: options.instance })
}

/** 마지막 인식 객체가 오류를 내고(선택) 끝난다 */
export async function speechError(page: Page, error: string, end = true): Promise<void> {
  await page.evaluate(({ error, end }) => {
    const s = (window as unknown as { __speech: { instances: { onerror: ((e: unknown) => void) | null; onend: (() => void) | null }[] } }).__speech
    const rec = s.instances.at(-1)
    if (rec === undefined) throw new Error('인식 객체가 없다')
    rec.onerror?.({ error })
    if (end) rec.onend?.()
  }, { error, end })
}

/** 마지막 인식 객체가 저절로 끝난다 */
export async function speechEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = (window as unknown as { __speech: { instances: { onend: (() => void) | null }[] } }).__speech
    s.instances.at(-1)?.onend?.()
  })
}

export function voiceRegion(page: Page) {
  return page.getByRole('region', { name: '음성 등록' })
}

export function cardList(page: Page) {
  return page.getByRole('list', { name: '음성 카드' })
}

/** 카드 (짧은 글 = describeCard에서 " — 등록할까요?"를 뗀 것) */
export function card(page: Page, short: string) {
  return cardList(page).getByRole('listitem', { name: `${short} 카드`, exact: true })
}

export function cardButton(page: Page, short: string, action: '등록' | '고치기' | '닫기' | '자동 등록 멈추기') {
  return page.getByRole('button', { name: `${short} ${action}`, exact: true })
}

/** 머리 줄(또는 창)의 "음성 켜기"를 눌러 켠다. 확인이 미리 있으면 창 없이 시작한다 */
export async function turnOnVoice(page: Page, options: { consent?: boolean } = {}): Promise<void> {
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  if (options.consent === true) {
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
  }
  await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
}

/** 서버로 간 쓰기·조회 요청을 모은다 (주소·본문) */
export function recordRequests(page: Page): { url: string; method: string; body: string }[] {
  const out: { url: string; method: string; body: string }[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/')) return
    out.push({ url, method: request.method(), body: request.postData() ?? '' })
  })
  return out
}

/** 음성 조각(누를 때만 받는 JS) 요청 */
export function recordVoiceChunk(page: Page): string[] {
  const out: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/^\/assets\/src-[^/]*\.js$/.test(url.pathname)) out.push(url.pathname)
  })
  return out
}

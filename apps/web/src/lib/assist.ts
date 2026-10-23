// AI 제안 (A1 CMT-06, R-20 10, D-A1-01·03·06·07, AC-A1-20·21·22). 제안은 판정이 아니다 — 판매자가 [이대로 주문]을 누를 때만 기존 바로잡기가 나간다.
// - 확인 필요 화면을 열 때 AI 제안 받기(POST /api/assist/suggest)를 그 화면(같은 범위)마다 한 번만 부른다. 실시간 알림으로 목록을 다시 읽어도 더 부르지 않는다.
//   화면을 떠났다 다시 열면 한 번 더. 결과가 오면 목록을 한 번 다시 읽는다.
//   진행 중(BUSY)이면 곧바로 한 번, 그 뒤 2초마다 목록만 다시 읽는다 — 많아야 8번, AI 제안 받기는 다시 보내지 않는다(D-A1-16).
// - 목록·"주문으로"·"주문 아님"은 이 요청을 기다리지 않는다.
// - 화면 글에는 영어 상태값·모델 이름·HTTP 상태를 넣지 않는다(AC-A1-24).
import { useCallback, useEffect, useRef, useState } from 'react'
import { get, isApiError, post, put, type ApiError } from '../api/client.ts'
import type { AssistResult, AssistSettings, AssistSuggestResponse, Product, ReviewSuggestion } from '../api/types.ts'
import { reviewsPath, type ReviewsQuery } from './reviews.ts'

export const ASSIST_READING = 'AI가 읽는 중이에요…'
export const ASSIST_FAILED = 'AI 제안을 지금 받지 못했어요. 직접 골라 주세요.'
export const ASSIST_LIMIT = (limit: number): string => `오늘 AI 제안을 다 썼어요(하루 ${String(limit)}번). 비슷한 글자로 찾은 제안만 보여요.`
/** 설정을 읽지 못해 상한을 모를 때 — "하루 0번"처럼 틀린 숫자를 보이지 않는다 (D-A1-17) */
export const ASSIST_LIMIT_UNKNOWN = '오늘 AI 제안을 다 썼어요. 비슷한 글자로 찾은 제안만 보여요.'
export const ASSIST_OFFER = '설정에서 AI 제안을 켤 수 있어요.'
/** 제안 출처 (RULE·AI는 화면에 보이지 않는다) */
export const SUGGESTION_SOURCE_WORD: Readonly<Record<ReviewSuggestion['source'], string>> = {
  RULE: '비슷한 글자로 찾음',
  AI: 'AI가 읽음',
}
/** 설정 칸 */
export const ASSIST_TITLE = 'AI 제안'
export const ASSIST_SWITCH = 'AI 제안 받기'
export const ASSIST_NOTICE = '확인 필요 댓글의 글이 AI 회사(Anthropic, 미국)로 보내져 읽혀요. 닉네임·전화번호는 빼고 보내요. 언제든 끌 수 있어요.'
export const ASSIST_CONSENT = '위 내용을 읽었고 동의해요'
export const ASSIST_UNAVAILABLE = '지금은 쓸 수 없어요.'
export const ASSIST_ON = (used: number, limit: number): string => `켜져 있어요 · 오늘 ${String(used)}번 썼어요 (하루 ${String(limit)}번까지)`
export const ASSIST_OFF_BUTTON = '끄기'
/** 꺼져 있을 때: 상태 글과 스위치의 보이는 글(누르면 될 일) — 접근성 이름은 ASSIST_SWITCH 그대로 (D-A1-18) */
export const ASSIST_OFF_STATE = '꺼져 있어요'
export const ASSIST_ON_BUTTON = '켜기'
/** 진행 중인 요청이 있을 때(BUSY) 목록을 다시 읽는 간격과 횟수 — 2초 × 8번 = 16초(서버 호출 시간 제한 15초를 덮는다, D-A1-16) */
export const ASSIST_BUSY_RELOAD_MS = 2_000
export const ASSIST_BUSY_RELOADS = 8

const productName = (product: Product): string => (product.name.trim() === '' ? '품종 미입력' : product.name)

export interface SuggestionView {
  /** "제안: 21번 반바지 M 1개" */
  readonly words: string
  /** "21번 반바지 M 1개" — [이대로 주문] 뒤 띠·결과 끝에 붙인다 (D-A1-14) */
  readonly choice: string
  readonly source: string
  readonly product: Product
  readonly options: Readonly<Record<string, string>>
  readonly qty: number
}

/**
 * 화면에 보일 제안 (그 방송의 지금 상품으로 다시 맞춰 본다 — 어긋나면 null: 보이지 않는 쪽이 안전하다).
 * 글: "제안: 21번 반바지 M 1개" (옵션은 상품의 항목 순서로).
 */
export function suggestionView(suggestion: ReviewSuggestion | null | undefined, broadcast: string, products: ReadonlyMap<string, Product>, maxQty: number): SuggestionView | null {
  if (suggestion === null || suggestion === undefined) return null
  const product = products.get(`${broadcast}/${String(suggestion.no)}`)
  if (product === undefined || product.broadcast !== broadcast) return null
  if (!Number.isInteger(suggestion.qty) || suggestion.qty < 1 || suggestion.qty > maxQty) return null
  const given = suggestion.options ?? {}
  if (Object.keys(given).length !== product.options.length) return null
  const options: Record<string, string> = {}
  for (const item of product.options) {
    const label = Object.hasOwn(given, item.name) ? given[item.name] : undefined
    if (label === undefined || !item.choices.some((choice) => choice.label === label)) return null
    options[item.name] = label
  }
  const parts = [`${String(product.no)}번`, productName(product), ...product.options.map((item) => options[item.name] ?? ''), `${String(suggestion.qty)}개`]
  const choice = parts.join(' ')
  return { words: `제안: ${choice}`, choice, source: SUGGESTION_SOURCE_WORD[suggestion.source], product, options, qty: suggestion.qty }
}

export interface AssistOnOpen {
  /** "AI가 읽는 중이에요…"를 보인다 (켜져 있고 결과가 아직 없다) */
  readonly reading: boolean
  /** 목록 위 한 줄 (상한·실패만) */
  readonly notice: string | null
  /** 목록 아래 "설정에서 AI 제안을 켤 수 있어요." (꺼져 있고 쓸 수 있다) */
  readonly offer: boolean
}

const QUIET: AssistOnOpen = { reading: false, notice: null, offer: false }

/** 확인 필요 화면을 열 때 AI 제안 받기를 한 번 (AC-A1-21) */
export function useAssistOnOpen(query: ReviewsQuery, reload: () => Promise<unknown>): AssistOnOpen {
  const key = reviewsPath(query)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [result, setResult] = useState<{ readonly key: string; readonly view: AssistOnOpen } | null>(null)
  const fired = useRef<string | null>(null)
  const keyRef = useRef(key)
  keyRef.current = key
  const mounted = useRef(true)
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (busyTimer.current !== undefined) clearTimeout(busyTimer.current)
      busyTimer.current = undefined
    }
  }, [])

  const run = useCallback(async (mine: string, body: { rehearsal: boolean; broadcast?: string }) => {
    const live = () => mounted.current && keyRef.current === mine
    const settings = get<AssistSettings>('/api/assist/settings').then(
      (value) => {
        if (live()) setEnabled(value.available && value.enabled)
        return value
      },
      () => null,
    )
    let code: AssistResult | 'ERROR' | 'QUIET'
    try {
      code = (await post<AssistSuggestResponse>('/api/assist/suggest', body)).result
    } catch (error) {
      // 서버에 닿지 못했거나 서버 오류면 실패 문장, 그 밖(보조자·없는 방송)은 아무 말 없음
      code = isApiError(error) && (error.network || error.status >= 500) ? 'ERROR' : 'QUIET'
    }
    const current = await settings
    if (!live()) return
    const view: AssistOnOpen =
      code === 'LIMIT'
        ? { ...QUIET, notice: current === null || !Number.isInteger(current.dailyLimit) ? ASSIST_LIMIT_UNKNOWN : ASSIST_LIMIT(current.dailyLimit) }
        : code === 'FAILED' || code === 'ERROR'
          ? { ...QUIET, notice: ASSIST_FAILED }
          : code === 'OFF'
            ? { ...QUIET, offer: current?.available === true }
            : QUIET
    setResult({ key: mine, view })
    void reloadRef.current()
    if (code === 'BUSY') {
      // 다른 화면(기기)의 요청이 끝나면 제안이 목록에 붙는다 — 목록만 2초마다 다시 읽는다(외부 호출 없음)
      if (busyTimer.current !== undefined) clearTimeout(busyTimer.current)
      let left = ASSIST_BUSY_RELOADS
      const tick = () => {
        busyTimer.current = undefined
        if (!live()) return
        void reloadRef.current()
        left -= 1
        if (left > 0) busyTimer.current = setTimeout(tick, ASSIST_BUSY_RELOAD_MS)
      }
      busyTimer.current = setTimeout(tick, ASSIST_BUSY_RELOAD_MS)
    }
  }, [])

  useEffect(() => {
    // 같은 화면·같은 범위에서 한 번 (StrictMode의 두 번 실행에도 한 번 — ref는 그대로 남는다)
    if (fired.current === key) return
    fired.current = key
    setEnabled(null)
    void run(key, { rehearsal: query.rehearsal, ...(query.broadcast === undefined ? {} : { broadcast: query.broadcast }) })
  }, [key, query.rehearsal, query.broadcast, run])

  if (result !== null && result.key === key) return result.view
  return { ...QUIET, reading: enabled === true }
}

export type AssistSettingsState =
  | { readonly state: 'loading' }
  | { readonly state: 'hidden' }
  | { readonly state: 'error'; readonly error: ApiError }
  | { readonly state: 'ready'; readonly settings: AssistSettings }

/** 설정의 AI 제안 칸 (GET /api/assist/settings) — 보조자(403)·없는 경로(404)면 칸이 없다 */
export function useAssistSettings(on: boolean): {
  readonly current: AssistSettingsState
  readonly reload: () => Promise<void>
  readonly change: (enabled: boolean, consent: boolean) => Promise<ApiError | null>
} {
  const [current, setCurrent] = useState<AssistSettingsState>({ state: 'loading' })
  const reload = useCallback(async () => {
    try {
      setCurrent({ state: 'ready', settings: await get<AssistSettings>('/api/assist/settings') })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 403 || error.status === 404) setCurrent({ state: 'hidden' })
      else setCurrent({ state: 'error', error })
    }
  }, [])
  useEffect(() => {
    if (on) void reload()
  }, [on, reload])
  /** 켜기·끄기 — 실패면 보일 오류, 성공이면 null */
  const change = useCallback(
    async (enabled: boolean, consent: boolean): Promise<ApiError | null> => {
      try {
        setCurrent({ state: 'ready', settings: await put<AssistSettings>('/api/assist/settings', enabled ? { enabled, consent } : { enabled }) })
        return null
      } catch (error) {
        if (!isApiError(error)) throw error
        // 키가 없는 서버: 칸을 "지금은 쓸 수 없어요."로 다시 그린다
        if (error.code === 'UNAVAILABLE') {
          await reload()
          return null
        }
        return error
      }
    },
    [reload],
  )
  return { current, reload, change }
}

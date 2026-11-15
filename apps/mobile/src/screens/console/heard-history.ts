// 들린 말(음성 인식) 탭의 서버 기록 (D-UX4-156, 사용자 지시 2026-11-16 "음성인식은 왜 끝난 라이브엔 볼 수 없어? 채팅처럼 다 저장해두는 거 아니야? 보이게 해줘"):
// 서버가 받아쓴 줄을 방송마다 남긴다(GET /api/broadcasts/:id/heard). 탭은 그 기록에 이 기기가 지금 받는 줄을 이어 붙여 보인다 —
// 끝난 라이브·앱을 다시 켠 뒤·다른 기기에서도 그 방송의 들린 말 전체가 시간순으로 나온다.
import { useEffect, useState } from 'react'
import { get } from '../../api/client.ts'

export interface HeardLine {
  /** 들린 시각 (UTC 밀리초) */
  readonly at: number
  readonly text: string
}

/** 라이브 중 서버 기록을 다시 받는 간격 (이 기기가 듣지 않는 동안 — 다른 기기·라이브 소리 — 들린 말도 보이게) */
export const HEARD_POLL_MS = 10_000
/** 이 기기 첫 줄 바로 앞 서버 줄은 같은 말일 수 있다 — 기기 시계가 조금 달라도 겹치지 않게 이만큼 앞까지만 서버 줄을 쓴다 */
export const HEARD_EDGE_MS = 1_000
/** 기기 첫 줄들과 글이 같은 서버 줄을 버리는 폭 (기기 시계가 빠를 때) */
const SAME_WINDOW_MS = 10_000

/**
 * 서버 기록 + 이 기기가 받은 줄 (순수 함수). 기기 줄이 시작된 뒤의 서버 줄은 기기 줄과 같은 말이라 쓰지 않는다(기기 줄이 먼저 온다).
 * 기기 줄이 없으면 서버 기록 그대로.
 */
export function mergeHeard(saved: readonly HeardLine[], local: readonly HeardLine[]): HeardLine[] {
  const first = local[0]
  if (first === undefined) return [...saved]
  const opening = new Set(local.slice(0, 5).map((line) => line.text))
  const before = saved.filter((line) => line.at < first.at - HEARD_EDGE_MS && !(line.at >= first.at - SAME_WINDOW_MS && opening.has(line.text)))
  return [...before, ...local]
}

/** 이 기기 음성 세션의 줄 (그 방송 것만) */
export function localHeard(view: { readonly broadcastId: string | null; readonly transcript: readonly string[]; readonly transcriptAt: readonly number[] }, broadcastId: string): HeardLine[] {
  if (view.broadcastId !== broadcastId) return []
  return view.transcript.flatMap((text, index) => {
    const at = view.transcriptAt[index]
    return at === undefined ? [] : [{ at, text }]
  })
}

function isLine(value: unknown): value is HeardLine {
  return typeof value === 'object' && value !== null && typeof (value as { at?: unknown }).at === 'number' && typeof (value as { text?: unknown }).text === 'string'
}

/** 서버의 그 방송 음성 인식 기록. 라이브 중이면 HEARD_POLL_MS마다 다시 받는다. loaded: 한 번이라도 받았거나 받지 못했다 */
export function useSavedHeard(broadcastId: string, live: boolean): { readonly lines: readonly HeardLine[]; readonly loaded: boolean } {
  const [state, setState] = useState<{ readonly b: string; readonly lines: readonly HeardLine[]; readonly loaded: boolean }>({ b: broadcastId, lines: [], loaded: false })
  useEffect(() => {
    let alive = true
    const read = () => {
      get<{ lines?: unknown }>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/heard`).then(
        (body) => {
          if (alive) setState({ b: broadcastId, lines: Array.isArray(body.lines) ? body.lines.filter(isLine) : [], loaded: true })
        },
        // 받지 못하면 이 기기 줄만 보인다 — 다음 차례에 다시 받는다
        () => {
          if (alive) setState((was) => (was.b === broadcastId ? { ...was, loaded: true } : { b: broadcastId, lines: [], loaded: true }))
        },
      )
    }
    read()
    const timer = live ? setInterval(read, HEARD_POLL_MS) : null
    return () => {
      alive = false
      if (timer !== null) clearInterval(timer)
    }
  }, [broadcastId, live])
  return state.b === broadcastId ? state : { lines: [], loaded: false }
}

/** 문장 끝을 못 찾은 긴 말은 이 글자 수 근처 띄어쓰기에서 나눈다 */
export const HEARD_SENTENCE_MAX = 48

/**
 * 받아쓴 한 조각을 문장으로 나눈다 (D-UX4-165, 사용자 2026-11-16 "음성인식이 끊기지 않고 계속 이어지면 너무 긴 문장으로 보내지는데"):
 * 받아쓰기는 쉬지 않고 말하면 20초까지 한 조각이라 한 줄이 문단처럼 길다. 화면에서만 . ? ! 뒤에서 나누고,
 * 문장 끝 없이 긴 말은 HEARD_SENTENCE_MAX 근처 띄어쓰기에서 나눈다. 받아쓰기·서버 기록은 그대로다.
 */
export function heardSentences(text: string): string[] {
  const out: string[] = []
  for (const part of text.trim().split(/(?<=[.?!。？！…])\s+/u)) {
    let rest = part.trim()
    while (rest.length > HEARD_SENTENCE_MAX) {
      const cut = rest.lastIndexOf(' ', HEARD_SENTENCE_MAX)
      if (cut <= 0) break
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut + 1).trim()
    }
    if (rest !== '') out.push(rest)
  }
  return out
}

/** 줄마다 문장으로 나눈다 — 나뉜 문장은 같은 시각을 갖는다 */
export function splitHeard(lines: readonly HeardLine[]): HeardLine[] {
  return lines.flatMap((line) => heardSentences(line.text).map((text) => ({ at: line.at, text })))
}

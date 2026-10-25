// 음성으로 등록·고친 기록 (V3 R-25, D-V3-65, AC-V3-71): 서버 GET /api/voice/log.
// - 정산 화면: 접힌 칸 "음성으로 등록·고친 기록 N건"(시각순·전→후·들은 말·표시 강조·[상품 보기]),
//   표시가 있는 건(크게 바뀜·찜 있을 때 고침)이 있으면 위에 노란 띠 "확인할 음성 고침 N건"(막지 않음).
// - 상품 자세히: 그 상품의 기록 줄.
// 들은 말·품종은 글자로만 그린다(이스케이프).
import { formatWon } from '@livejjim/core'
import { useEffect, useState } from 'react'
import { get, withQuery } from '../api/client.ts'
import { kstTime } from '../lib/kst.ts'

/** 서버 기록 한 줄 (dev-notes R-25) */
export interface VoiceLogEntry {
  readonly id: string | number
  readonly at: string
  readonly b: string
  readonly no: number
  readonly toNo: number | null
  readonly kind: 'REGISTER' | 'PRICE' | 'NAME' | 'RENUMBER' | 'UNDO'
  readonly before: { readonly no?: number; readonly name?: string; readonly price?: number } | null
  readonly after: { readonly no?: number; readonly name?: string; readonly price?: number } | null
  readonly claims: number
  readonly heard: string
  readonly big: boolean
  readonly withClaims: boolean
  readonly undone: boolean
  readonly failed: boolean
}

const KIND_WORD: Readonly<Record<VoiceLogEntry['kind'], string>> = {
  REGISTER: '등록',
  PRICE: '가격 고침',
  NAME: '품종 고침',
  RENUMBER: '번호 옮김',
  UNDO: '되돌림',
}

/** 정산 전에 다시 볼 건 (크게 바뀜·찜 있을 때 고침, 반영된 것만) */
export const needsCheck = (entry: VoiceLogEntry): boolean => !entry.failed && (entry.big || entry.withClaims)

export const voiceLogTitle = (count: number): string => `음성으로 등록·고친 기록 ${String(count)}건`
export const voiceCheckBand = (count: number): string => `확인할 음성 고침 ${String(count)}건`

function side(value: VoiceLogEntry['before']): string {
  if (value === null) return ''
  const parts: string[] = []
  if (value.no !== undefined) parts.push(`${String(value.no)}번`)
  if (value.name !== undefined) parts.push(value.name === '' ? '품종 미입력' : value.name)
  if (value.price !== undefined) parts.push(formatWon(value.price))
  return parts.join(' ')
}

/** "100,000원 → 120,000원" */
export function changeLine(entry: VoiceLogEntry): string {
  const before = side(entry.before)
  const after = side(entry.after)
  if (before === '') return after
  return `${before} → ${after}`
}

function marks(entry: VoiceLogEntry): string[] {
  const out: string[] = []
  if (entry.big) out.push('크게 바뀜')
  if (entry.withClaims) out.push(`찜 ${String(entry.claims)}개 있을 때 고침`)
  if (entry.undone) out.push('되돌림')
  if (entry.failed) out.push('반영 안 됨')
  return out
}

/** 기록 받기 (실패하면 null — 화면은 아무것도 그리지 않는다) */
export function useVoiceLog(query: Readonly<Record<string, string | number | boolean | undefined>> | null): readonly VoiceLogEntry[] | null {
  const [entries, setEntries] = useState<readonly VoiceLogEntry[] | null>(null)
  const key = query === null ? null : JSON.stringify(query)
  useEffect(() => {
    if (query === null) {
      setEntries(null)
      return
    }
    let cancelled = false
    get<{ entries?: unknown }>(withQuery('/api/voice/log', query)).then(
      (body) => {
        if (!cancelled) setEntries(Array.isArray(body.entries) ? (body.entries as VoiceLogEntry[]) : [])
      },
      () => {
        if (!cancelled) setEntries(null)
      },
    )
    return () => {
      cancelled = true
    }
    // key가 query 내용이다
  }, [key])
  return entries
}

function EntryLine({ entry, onOpen }: { readonly entry: VoiceLogEntry; readonly onOpen?: (entry: VoiceLogEntry) => void }) {
  const flagged = needsCheck(entry)
  const words = marks(entry)
  const no = entry.toNo !== null && entry.toNo !== entry.no ? `${String(entry.no)}번 → ${String(entry.toNo)}번` : `${String(entry.no)}번`
  return (
    <li className={flagged ? 'voice-log-entry voice-log-flagged' : 'voice-log-entry'}>
      <p>
        <span className="voice-log-time">{kstTime(entry.at).slice(0, 5)}</span> <strong>{no}</strong> {KIND_WORD[entry.kind]} {changeLine(entry)}
        {words.length > 0 ? <span className={flagged ? 'tag tag-waiting' : 'tag'}>{words.join(' · ')}</span> : null}
      </p>
      {/* 봉인된 날짜의 들은 말은 서버가 지운다 (R-25) */}
      <p className="hint">들은 말: {entry.heard === '' ? '(지움)' : entry.heard}</p>
      {onOpen !== undefined ? (
        <button type="button" className="button" onClick={() => onOpen(entry)}>
          상품 보기
        </button>
      ) : null}
    </li>
  )
}

/** 정산 화면: 노란 띠 + 접힌 칸 */
export function SettlementVoiceLog({ date, rehearsal, onOpen }: { readonly date: string; readonly rehearsal: boolean; readonly onOpen: (entry: VoiceLogEntry) => void }) {
  const entries = useVoiceLog({ date, rehearsal })
  if (entries === null || entries.length === 0) return null
  const flagged = entries.filter(needsCheck).length
  const sorted = [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return (
    <section className="voice-log-section" aria-label="음성 기록">
      {flagged > 0 ? (
        <p className="warning voice-check-band" role="status">
          {voiceCheckBand(flagged)}
        </p>
      ) : null}
      <details className="details">
        <summary>{voiceLogTitle(entries.length)}</summary>
        <ul className="voice-log-list">
          {sorted.map((entry) => (
            <EntryLine key={String(entry.id)} entry={entry} onOpen={onOpen} />
          ))}
        </ul>
      </details>
    </section>
  )
}

/** 상품 자세히: 그 상품의 음성 기록 */
export function ProductVoiceLog({ b, no }: { readonly b: string; readonly no: number }) {
  const entries = useVoiceLog({ b, no })
  if (entries === null || entries.length === 0) return null
  return (
    <section aria-label="음성 기록">
      <h3>음성으로 등록·고친 기록</h3>
      <ul className="voice-log-list">
        {entries.map((entry) => (
          <EntryLine key={String(entry.id)} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

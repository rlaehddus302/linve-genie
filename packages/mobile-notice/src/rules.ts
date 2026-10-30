// 기기 안 거르기 (SMS3) — 인증번호·광고처럼 서버에 갈 까닭이 없는 알림은 휴대폰 밖으로 내보내지 않는다.
// 규칙 목록은 서버가 내려줄 자리만 둔다(setFilterRules). 내려온 것이 없으면 아래 기본 규칙을 쓴다.
// 세 플랫폼(TS 가짜·Kotlin·Swift)이 같게 거르도록 규칙 말은 일부러 작다: 칸(body·source) · 방법(contains·startsWith) · 낱말.
// 비교 전에 양쪽 글에서 모든 빈칸을 빼고 영문자를 소문자로 바꾼다("인증 번호" = "인증번호", "Verification Code" = "verificationcode").
import type { NoticeKindHint } from './contract.ts'

export interface NoticeFilterRule {
  /** 규칙 이름 (건수 셈·서버 갱신용, 영문·숫자·_-) */
  readonly id: string
  readonly field: 'body' | 'source'
  readonly op: 'contains' | 'startsWith'
  readonly value: string
  /** 이 규칙을 쓸 종류 (없으면 둘 다) */
  readonly kinds?: readonly NoticeKindHint[]
}

/** 기본 규칙 — 인증번호(본인 확인 숫자는 기기 밖으로 내보내지 않는다)·광고(법정 표시 "(광고)"·수신 거부 안내) */
const DEFAULT_RULES: NoticeFilterRule[] = [
  { id: 'otp-ko', field: 'body', op: 'contains', value: '인증번호' },
  { id: 'otp-ko-code', field: 'body', op: 'contains', value: '인증코드' },
  { id: 'otp-ko-confirm', field: 'body', op: 'contains', value: '확인코드' },
  { id: 'otp-ko-auth', field: 'body', op: 'contains', value: '본인확인' },
  { id: 'otp-en', field: 'body', op: 'contains', value: 'verification code' },
  { id: 'ad-mark', field: 'body', op: 'contains', value: '(광고)' },
  { id: 'ad-optout', field: 'body', op: 'contains', value: '무료수신거부' },
  { id: 'ad-optout-short', field: 'body', op: 'contains', value: '무료거부' },
]
export const DEFAULT_FILTER_RULES: readonly NoticeFilterRule[] = Object.freeze(DEFAULT_RULES.map((rule) => Object.freeze(rule)))

export const FILTER_RULES_MAX = 200
export const FILTER_RULE_VALUE_MAX = 100
const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** 비교용 글: 모든 빈칸(줄바꿈·전각 빈칸 포함)을 빼고 영문자만 소문자로 */
export function normalizeForRule(text: string): string {
  let out = ''
  for (const ch of text) {
    if (/\s/u.test(ch)) continue
    out += ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch
  }
  return out
}

/** 서버가 내려준 규칙 목록 검사 — 하나라도 틀리면 null(기본 규칙을 그대로 쓴다) */
export function parseFilterRules(value: unknown): NoticeFilterRule[] | null {
  if (!Array.isArray(value) || value.length > FILTER_RULES_MAX) return null
  const out: NoticeFilterRule[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !RULE_ID.test(r.id)) return null
    if (r.field !== 'body' && r.field !== 'source') return null
    if (r.op !== 'contains' && r.op !== 'startsWith') return null
    if (typeof r.value !== 'string' || normalizeForRule(r.value).length === 0 || r.value.length > FILTER_RULE_VALUE_MAX) return null
    let kinds: NoticeKindHint[] | undefined
    if (r.kinds !== undefined) {
      if (!Array.isArray(r.kinds) || r.kinds.length === 0 || !r.kinds.every((k) => k === 'sms' || k === 'bank')) return null
      kinds = [...new Set(r.kinds as NoticeKindHint[])]
    }
    out.push(kinds === undefined ? { id: r.id, field: r.field, op: r.op, value: r.value } : { id: r.id, field: r.field, op: r.op, value: r.value, kinds })
  }
  return out
}

/** 걸린 규칙 id (없으면 null) */
export function matchFilterRule(rules: readonly NoticeFilterRule[], notice: { readonly kindHint: NoticeKindHint; readonly source: string; readonly body: string }): string | null {
  const body = normalizeForRule(notice.body)
  const source = normalizeForRule(notice.source)
  for (const rule of rules) {
    if (rule.kinds !== undefined && !rule.kinds.includes(notice.kindHint)) continue
    const text = rule.field === 'body' ? body : source
    const needle = normalizeForRule(rule.value)
    if (needle.length === 0) continue
    if (rule.op === 'contains' ? text.includes(needle) : text.startsWith(needle)) return rule.id
  }
  return null
}

/** 네이티브에 넘기는 글 (JSON 배열) */
export function serializeFilterRules(rules: readonly NoticeFilterRule[]): string {
  return JSON.stringify(rules.map((r) => (r.kinds === undefined ? { id: r.id, field: r.field, op: r.op, value: r.value } : { id: r.id, field: r.field, op: r.op, value: r.value, kinds: [...r.kinds] })))
}

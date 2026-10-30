// 공용 사례(test-vectors/notice-vectors.json)를 TS 본이 그대로 내는지 — Kotlin·Swift 시험도 같은 파일을 읽는다.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyIntakeResponse,
  cutUtf16,
  extractNotice,
  localIdOf,
  matchFilterRule,
  normalizeForRule,
  parseFilterRules,
  phoneDigits,
  senderOf,
  sha256Hex,
  shortcutCandidate,
  DEFAULT_FILTER_RULES,
  ENVELOPE_FIELDS,
  isNoticeEnvelope,
  type NoticeKindHint,
  type RawNotice,
} from '../src/index.ts'

interface Vectors {
  localId: { packageName: string; source: string; receivedAtMs: number; body: string; localId: string }[]
  phone: { input: string; output: string | null }[]
  sender: { name: string | null; uri: string | null; output: string }[]
  normalize: { input: string; output: string }[]
  cut: { input: string; max: number; output: string }[]
  filter: { rules: unknown; kindHint: NoticeKindHint; source: string; body: string; rule: string | null }[]
  classify: { status: number | null; action: string }[]
  extract: { name: string; enabledAtMs: number; raw: RawNotice; skipped: string | null; tooOld: number; candidates: unknown[] }[]
  shortcut: { input: { sender: string; body: string; kind: NoticeKindHint }; nowMs: number; candidate: unknown }[]
  envelope: { json: Record<string, unknown> }
}

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'test-vectors', 'notice-vectors.json'), 'utf8')) as Vectors

describe('SHA-256 순수 구현 = node:crypto', () => {
  it.each(['', 'abc', '찜 3번 김민지', '🌵'.repeat(40), 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)])('%#', (text) => {
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  })
})

describe('공용 사례', () => {
  it.each(vectors.localId)('localId $localId', (v) => {
    expect(localIdOf(v.packageName, v.source, v.receivedAtMs, v.body)).toBe(v.localId)
  })
  it.each(vectors.phone)('전화번호 $input', (v) => {
    expect(phoneDigits(v.input)).toBe(v.output)
  })
  it.each(vectors.sender)('보낸 사람 $name $uri', (v) => {
    expect(senderOf(v.name, v.uri)).toBe(v.output)
  })
  it.each(vectors.normalize)('비교용 글 $input', (v) => {
    expect(normalizeForRule(v.input)).toBe(v.output)
  })
  it.each(vectors.cut)('자르기 $input $max', (v) => {
    expect(cutUtf16(v.input, v.max)).toBe(v.output)
  })
  it.each(vectors.filter)('거르기 $body', (v) => {
    const rules = v.rules === null ? DEFAULT_FILTER_RULES : parseFilterRules(v.rules)
    expect(rules).not.toBeNull()
    expect(matchFilterRule(rules ?? [], v)).toBe(v.rule)
  })
  it.each(vectors.classify)('서버 답 $status', (v) => {
    expect(classifyIntakeResponse(v.status)).toBe(v.action)
  })
  it.each(vectors.extract)('꺼내기: $name', (v) => {
    const result = extractNotice(v.raw, v.enabledAtMs)
    expect(result.skipped).toBe(v.skipped)
    expect(result.tooOld).toBe(v.tooOld)
    expect(result.candidates).toEqual(v.candidates)
  })
  it.each(vectors.shortcut)('단축어 $input.body', (v) => {
    expect(shortcutCandidate(v.input, v.nowMs)).toEqual(v.candidate)
  })
  it('봉투 사례는 약속 모양이고 칸 순서가 ENVELOPE_FIELDS와 같다', () => {
    expect(Object.keys(vectors.envelope.json)).toEqual([...ENVELOPE_FIELDS])
    // 사례 본문은 따옴표·줄바꿈·탭·역빗금이 있다 (네이티브 JSON 이스케이프 시험)
    expect(isNoticeEnvelope({ ...vectors.envelope.json })).toBe(true)
  })
})

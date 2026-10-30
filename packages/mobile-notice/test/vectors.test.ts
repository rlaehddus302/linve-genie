// 공용 사례(test-vectors/notice-vectors.json)를 TS 본이 그대로 내는지 — Kotlin·Swift 시험도 같은 파일을 읽는다.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  INBOX_MESSAGE_FIELDS,
  channelForPackage,
  classifyIntakeResponse,
  cutUtf16,
  extractNotice,
  inboxRequestJson,
  isInboxRequest,
  lowerAscii,
  messageIdOf,
  parseInboxResponse,
  parseNoticeFilters,
  phoneDigits,
  senderOf,
  sha256Hex,
  shortcutCandidate,
  skipWordIn,
  type InboxChannel,
  type InboxMessage,
  type NoticeFilters,
  type RawNotice,
} from '../src/index.ts'

interface Vectors {
  messageId: { packageName: string; from: string | null; receivedAt: number; title: string | null; text: string; id: string }[]
  phone: { input: string; output: string | null }[]
  sender: { name: string | null; uri: string | null; output: string | null }[]
  cut: { input: string; max: number; output: string }[]
  lowerAscii: { input: string; output: string }[]
  skip: { filters: NoticeFilters | null; text: string; word: string | null }[]
  filters: { input: unknown; output: NoticeFilters | null }[]
  channel: { packageName: string; smsApp: string | null; filters: NoticeFilters | null; channel: InboxChannel | null }[]
  classify: { status: number | null; action: string }[]
  extract: { name: string; channel: InboxChannel; enabledAtMs: number; raw: RawNotice; skipped: string | null; tooOld: number; candidates: unknown[] }[]
  shortcut: { input: { sender: string; body: string }; nowMs: number; candidate: unknown }[]
  request: { device: string; messages: InboxMessage[] }
  response: { body: string; results: Record<string, string>; filters: NoticeFilters | null }[]
}

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'test-vectors', 'notice-vectors.json'), 'utf8')) as Vectors

describe('SHA-256 순수 구현 = node:crypto', () => {
  it.each(['', 'abc', '찜 3번 김민지', '🌵'.repeat(40), 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)])('%#', (text) => {
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  })
})

describe('공용 사례', () => {
  it.each(vectors.messageId)('id $id', (v) => {
    expect(messageIdOf(v.packageName, v.from, v.receivedAt, v.title, v.text)).toBe(v.id)
  })
  it.each(vectors.phone)('전화번호 $input', (v) => {
    expect(phoneDigits(v.input)).toBe(v.output)
  })
  it.each(vectors.sender)('보낸 곳 $name $uri', (v) => {
    expect(senderOf(v.name, v.uri)).toBe(v.output)
  })
  it.each(vectors.cut)('자르기 $input $max', (v) => {
    expect(cutUtf16(v.input, v.max)).toBe(v.output)
  })
  it.each(vectors.lowerAscii)('영문 소문자 $input', (v) => {
    expect(lowerAscii(v.input)).toBe(v.output)
  })
  it.each(vectors.skip)('거를 낱말 $text', (v) => {
    expect(skipWordIn(v.text, v.filters)).toBe(v.word)
  })
  it.each(vectors.filters)('filters 읽기 %#', (v) => {
    expect(parseNoticeFilters(v.input)).toEqual(v.output)
  })
  it.each(vectors.channel)('읽을 앱 $packageName (기본 문자 앱 $smsApp)', (v) => {
    expect(channelForPackage(v.packageName, v.smsApp, v.filters)).toBe(v.channel)
  })
  it.each(vectors.classify)('서버 답 $status', (v) => {
    expect(classifyIntakeResponse(v.status)).toBe(v.action)
  })
  it.each(vectors.extract)('꺼내기: $name', (v) => {
    const result = extractNotice(v.raw, v.channel, v.enabledAtMs)
    expect(result.skipped).toBe(v.skipped)
    expect(result.tooOld).toBe(v.tooOld)
    expect(result.candidates).toEqual(v.candidates)
  })
  it.each(vectors.shortcut)('단축어 $input.body', (v) => {
    expect(shortcutCandidate(v.input, v.nowMs)).toEqual(v.candidate)
  })
  it('요청 본문: 약속 모양, 칸 순서, 따옴표·줄바꿈·탭·역빗금·U+2028이 그대로 돌아온다', () => {
    const json = inboxRequestJson(vectors.request.device, vectors.request.messages)
    const parsed = JSON.parse(json) as { device: string; messages: Record<string, unknown>[] }
    expect(Object.keys(parsed)).toEqual(['device', 'messages'])
    expect(isInboxRequest(parsed)).toBe(true)
    expect(parsed.device).toBe(vectors.request.device)
    for (const [i, m] of parsed.messages.entries()) {
      expect(Object.keys(m)).toEqual([...INBOX_MESSAGE_FIELDS])
      expect(m).toEqual(vectors.request.messages[i])
    }
  })
  it.each(vectors.response)('응답 읽기 %#', (v) => {
    const got = parseInboxResponse(v.body)
    expect(Object.fromEntries(got.results)).toEqual(v.results)
    expect(got.filters).toEqual(v.filters)
  })
})

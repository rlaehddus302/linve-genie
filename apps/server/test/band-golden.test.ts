// 밴드 골든 시험 (BND1, AC-BND1-90, D-BND1-03~07). tests/golden/band/의 모든 *.json을 읽어 tests/golden/README.md "밴드 골든" 형식 계약을 검사하고
// (모르는 키·모르는 kind·id 형식·겹친 id·빈 refs·out 모양), 사례를 밴드 모듈의 순수 함수로 모두 돌린다.
// 합계를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다. 골든 파일은 고치지 않는다(spec-keeper 소유).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bandBatch, bandComment } from '../src/band/comment.ts'

const DIR = new URL('../../../tests/golden/band/', import.meta.url)
const FILE_KEYS = ['kind', 'about', 'cases']
const CASE_KEYS = ['id', 'title', 'refs', 'note', 'in', 'out']
const IN_KEYS: Record<string, readonly string[]> = { comment: ['sellerUserKey', 'postKey', 'item'], batch: ['sellerUserKey', 'postKey', 'known', 'items'] }
const KINDS = ['comment', 'batch'] as const
const CHAT_KEYS = ['id', 'ch', 'nick', 'text', 'owner']
const SKIPS = new Set(['BAD_COMMENT_KEY', 'NO_AUTHOR', 'SELLER', 'BAD_TIME', 'NO_TEXT', 'TEXT_TOO_LONG'])
const ID_RE = /^G-BND-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-[0-9]{2,}$/

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isChat = (v: unknown): boolean =>
  isObj(v) && Object.keys(v).length === CHAT_KEYS.length && CHAT_KEYS.every((k) => k in v) && ['id', 'ch', 'nick', 'text'].every((k) => typeof v[k] === 'string') && v['owner'] === false

function contractProblems(files: readonly { file: string; data: unknown }[]): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const { file, data } of files) {
    if (!isObj(data)) {
      problems.push(`${file}: 객체가 아님`)
      continue
    }
    for (const key of Object.keys(data)) if (!FILE_KEYS.includes(key)) problems.push(`${file}: 모르는 키 ${key}`)
    const kind = data['kind']
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      problems.push(`${file}: 모르는 kind`)
      continue
    }
    if (typeof data['about'] !== 'string') problems.push(`${file}: about 없음`)
    const cases = data['cases']
    if (!Array.isArray(cases) || cases.length === 0) {
      problems.push(`${file}: cases 없음`)
      continue
    }
    cases.forEach((c: unknown, index) => {
      const at = `${file}#${String(index)}`
      if (!isObj(c)) return problems.push(`${at}: 객체가 아님`)
      for (const key of Object.keys(c)) if (!CASE_KEYS.includes(key)) problems.push(`${at}: 모르는 키 ${key}`)
      const id = c['id']
      if (typeof id !== 'string' || !ID_RE.test(id)) problems.push(`${at}: id 형식`)
      else if (ids.has(id)) problems.push(`${at}: 겹친 id ${id}`)
      else ids.add(id)
      if (typeof c['title'] !== 'string' || c['title'] === '') problems.push(`${at}: title`)
      const refs = c['refs']
      if (!Array.isArray(refs) || refs.length === 0 || !refs.every((r) => typeof r === 'string' && r !== '')) problems.push(`${at}: refs`)
      if ('note' in c && typeof c['note'] !== 'string') problems.push(`${at}: note`)
      const input = c['in']
      if (!isObj(input) || Object.keys(input).some((k) => !(IN_KEYS[kind] ?? []).includes(k)) || typeof input['sellerUserKey'] !== 'string' || typeof input['postKey'] !== 'string') {
        problems.push(`${at}: in 모양`)
      } else if (kind === 'batch' && (!Array.isArray(input['known']) || !input['known'].every((k) => typeof k === 'string') || !Array.isArray(input['items']))) {
        problems.push(`${at}: in 모양`)
      }
      const out = c['out']
      if (kind === 'comment') {
        const ok = isObj(out) && Object.keys(out).length === 1 && (isChat(out['chat']) || (typeof out['skip'] === 'string' && SKIPS.has(out['skip'])))
        if (!ok) problems.push(`${at}: out 모양`)
      } else {
        const ok =
          isObj(out) &&
          Object.keys(out).length === 2 &&
          Array.isArray(out['record']) &&
          out['record'].every(isChat) &&
          Array.isArray(out['skip']) &&
          out['skip'].every((s: unknown) => isObj(s) && Object.keys(s).length === 2 && (typeof s['key'] === 'string' || s['key'] === null) && typeof s['code'] === 'string' && (SKIPS.has(s['code']) || s['code'] === 'DUPLICATE'))
        if (!ok) problems.push(`${at}: out 모양`)
      }
    })
  }
  return problems
}

function load(): { file: string; data: unknown }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as unknown }))
}

const files = load()

describe('AC-BND1-90 밴드 골든 — 형식 계약', () => {
  it('파일 목록·사례 합계 고정 (batch.json·comment.json, 43 = comment 36 · batch 7)', () => {
    expect(files.map((f) => f.file)).toEqual(['batch.json', 'comment.json'])
    const count = (kind: string) => files.filter((f) => isObj(f.data) && f.data['kind'] === kind).reduce((n, f) => n + ((f.data as Json)['cases'] as unknown[]).length, 0)
    expect(count('comment')).toBe(36)
    expect(count('batch')).toBe(7)
    expect(count('comment') + count('batch')).toBe(43)
  })

  it('형식 계약 위반이 없다', () => {
    expect(contractProblems(files)).toEqual([])
  })

  it('계약 검사기가 틀린 모양을 잡는다 (모르는 키·모르는 kind·id 형식·겹친 id·out 모양)', () => {
    const base = { id: 'G-BND-BND1-01', title: 't', refs: ['R'], in: { sellerUserKey: 'S', postKey: 'P', item: {} }, out: { skip: 'NO_TEXT' } }
    expect(contractProblems([{ file: 'x', data: { kind: 'comment', about: 'a', cases: [base], extra: 1 } }])).toContain('x: 모르는 키 extra')
    expect(contractProblems([{ file: 'x', data: { kind: 'nope', about: 'a', cases: [base] } }])).toContain('x: 모르는 kind')
    expect(contractProblems([{ file: 'x', data: { kind: 'comment', about: 'a', cases: [{ ...base, id: 'G-BND-1' }] } }])).toContain('x#0: id 형식')
    expect(contractProblems([{ file: 'x', data: { kind: 'comment', about: 'a', cases: [base, base] } }])).toContain('x#1: 겹친 id G-BND-BND1-01')
    expect(contractProblems([{ file: 'x', data: { kind: 'comment', about: 'a', cases: [{ ...base, out: { chat: { id: 'a', ch: 'b', nick: 'c', text: 'd', owner: false, publishedAt: 1 } } }] } }])).toContain('x#0: out 모양')
    expect(contractProblems([{ file: 'x', data: { kind: 'comment', about: 'a', cases: [{ ...base, surprise: true }] } }])).toContain('x#0: 모르는 키 surprise')
  })
})

describe('AC-BND1-90 밴드 골든 — 사례', () => {
  const cases = files.flatMap((f) => ((f.data as Json)['cases'] as Json[]).map((c) => ({ kind: (f.data as Json)['kind'] as string, c })))
  it.each(cases.map(({ kind, c }) => [c['id'] as string, kind, c] as const))('%s (%s)', (_id, kind, c) => {
    const input = c['in'] as Json
    if (kind === 'comment') {
      expect(bandComment({ sellerUserKey: input['sellerUserKey'] as string, postKey: input['postKey'] as string, item: input['item'] })).toEqual(c['out'])
    } else {
      const result = bandBatch({ sellerUserKey: input['sellerUserKey'] as string, postKey: input['postKey'] as string, known: input['known'] as string[], items: input['items'] as unknown[] })
      // 기록 차례의 chat 다섯 칸만 비교한다 (key·작성 시각은 서버가 본 댓글 표·차례에 쓰는 값)
      expect({ record: result.record.map((r) => r.chat), skip: result.skip }).toEqual(c['out'])
      for (const r of result.record) expect(Object.keys(r.chat).sort()).toEqual([...CHAT_KEYS].sort())
    }
  })
})

// 틱톡 골든 시험 (N2b-1, AC-N2b-1-10·20·90, D-N2b-1-07). tests/golden/tiktok/의 모든 *.json을 읽어
// tests/golden/README.md "틱톡 골든" 형식 계약을 검사하고(모르는 키·모르는 kind·id 형식·겹친 id·빈 refs·out 모양·events와 out 길이), 사례를 모두 돌린다.
// 합계를 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다. 골든 파일은 고치지 않는다(spec-keeper 소유).
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCommentFilter, parseTikTokTarget } from '../src/tiktok/index.ts'

const DIR = new URL('../../../tests/golden/tiktok/', import.meta.url)

const FILE_KEYS = ['kind', 'about', 'cases']
const COMMON_KEYS = ['id', 'title', 'refs', 'note', 'out']
const CASE_KEYS: Record<string, readonly string[]> = { target: [...COMMON_KEYS, 'in'], comment: [...COMMON_KEYS, 'target', 'events'] }
const RAW_KEYS = new Set(['msgId', 'userId', 'uniqueId', 'nickname', 'comment', 'createTime'])
const RECORD_KEYS = ['platform', 'commentId', 'userId', 'nickname', 'text', 'receivedAt', 'owner']
const TARGET_ERRORS = new Set(['EMPTY', 'INVALID', 'SHORT_LINK'])
const DROPS = new Set(['BAD_COMMENT_ID', 'BAD_USER_ID', 'NO_TEXT', 'TEXT_TOO_LONG', 'DUPLICATE'])
const ID_RE = /^G-TTK-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-[0-9]{2,}$/
const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DECIMAL_RE = /^[1-9][0-9]{0,31}$/

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

interface Loaded {
  readonly file: string
  readonly kind: 'target' | 'comment'
  readonly cases: readonly Json[]
}

/** 형식 계약 위반 목록 (빈 목록이면 통과) */
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
    if (kind !== 'target' && kind !== 'comment') {
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
      for (const key of Object.keys(c)) if (!(CASE_KEYS[kind] ?? []).includes(key)) problems.push(`${at}: 모르는 키 ${key}`)
      const id = c['id']
      if (typeof id !== 'string' || !ID_RE.test(id)) problems.push(`${at}: id 형식`)
      else if (ids.has(id)) problems.push(`${at}: 겹친 id ${id}`)
      else ids.add(id)
      if (typeof c['title'] !== 'string' || c['title'] === '') problems.push(`${at}: title`)
      const refs = c['refs']
      if (!Array.isArray(refs) || refs.length === 0 || !refs.every((r) => typeof r === 'string' && r !== '')) problems.push(`${at}: refs`)
      if ('note' in c && typeof c['note'] !== 'string') problems.push(`${at}: note`)
      if (kind === 'target') {
        if (typeof c['in'] !== 'string') problems.push(`${at}: in`)
        const out = c['out']
        const ok =
          isObj(out) &&
          Object.keys(out).length === 1 &&
          (typeof out['uniqueId'] === 'string' || (typeof out['error'] === 'string' && TARGET_ERRORS.has(out['error'])))
        if (!ok) problems.push(`${at}: out 모양`)
      } else {
        if (typeof c['target'] !== 'string') problems.push(`${at}: target`)
        const events = c['events']
        const out = c['out']
        if (!Array.isArray(events) || events.length === 0) problems.push(`${at}: events`)
        else
          events.forEach((e: unknown, i) => {
            const ok =
              isObj(e) &&
              Object.keys(e).length === 2 &&
              typeof e['receivedAt'] === 'string' &&
              ISO_MS_RE.test(e['receivedAt']) &&
              isObj(e['raw']) &&
              Object.keys(e['raw']).every((k) => RAW_KEYS.has(k))
            if (!ok) problems.push(`${at}.events[${String(i)}]: 모양`)
          })
        if (!Array.isArray(out)) problems.push(`${at}: out`)
        else {
          if (!Array.isArray(events) || out.length !== events.length) problems.push(`${at}: events와 out 길이 다름`)
          out.forEach((o: unknown, i) => {
            const where = `${at}.out[${String(i)}]`
            if (!isObj(o) || Object.keys(o).length !== 1) return problems.push(`${where}: 모양`)
            if ('drop' in o) {
              if (typeof o['drop'] !== 'string' || !DROPS.has(o['drop'])) problems.push(`${where}: 버림 코드`)
              return
            }
            const r = o['record']
            const ok =
              isObj(r) &&
              Object.keys(r).length === RECORD_KEYS.length &&
              RECORD_KEYS.every((k) => k in r) &&
              r['platform'] === 'TIKTOK' &&
              typeof r['commentId'] === 'string' &&
              DECIMAL_RE.test(r['commentId']) &&
              typeof r['userId'] === 'string' &&
              DECIMAL_RE.test(r['userId']) &&
              typeof r['nickname'] === 'string' &&
              typeof r['text'] === 'string' &&
              typeof r['receivedAt'] === 'string' &&
              ISO_MS_RE.test(r['receivedAt']) &&
              typeof r['owner'] === 'boolean'
            if (!ok) problems.push(`${where}: 레코드 모양`)
          })
        }
      }
      return undefined
    })
  }
  return problems
}

const fileNames = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
const rawFiles = fileNames.map((file) => ({ file, data: JSON.parse(readFileSync(new URL(file, DIR), 'utf8')) as unknown }))
const loaded: Loaded[] = rawFiles.filter((f): f is { file: string; data: Json } => isObj(f.data)).map((f) => ({
  file: f.file,
  kind: f.data['kind'] as 'target' | 'comment',
  cases: (f.data['cases'] as Json[]) ?? [],
}))
const targetCases = loaded.filter((f) => f.kind === 'target').flatMap((f) => f.cases)
const commentCases = loaded.filter((f) => f.kind === 'comment').flatMap((f) => f.cases)

describe('AC-N2b-1-90 틱톡 골든 형식 계약과 합계', () => {
  it('README 형식 계약을 지킨다', () => {
    expect(contractProblems(rawFiles)).toEqual([])
  })

  it('합계: 파일 2 · 사례 58(target 40 · comment 18) · 댓글 65', () => {
    expect(fileNames).toEqual(['comment.json', 'target.json'])
    expect(targetCases.length + commentCases.length).toBe(58)
    expect(targetCases).toHaveLength(40)
    expect(commentCases).toHaveLength(18)
    expect(commentCases.reduce((sum, c) => sum + (c['events'] as unknown[]).length, 0)).toBe(65)
  })

  it('형식 검사가 위반을 잡는다 (모르는 키·모르는 kind·id 형식·겹친 id·빈 refs·out 모양·길이 다름)', () => {
    const good = { id: 'G-TTK-N2b-1-01', title: 't', refs: ['PLT-02'], in: 'a', out: { error: 'INVALID' } }
    const goodComment = {
      id: 'G-TTK-N2b-1-41',
      title: 't',
      refs: ['PLT-02'],
      target: 'seller_kim',
      events: [{ receivedAt: '2026-10-20T11:00:00.000Z', raw: { msgId: '1' } }],
      out: [{ drop: 'BAD_USER_ID' }],
    }
    expect(contractProblems([{ file: 'a.json', data: { kind: 'target', about: '', cases: [good] } }])).toEqual([])
    expect(contractProblems([{ file: 'a.json', data: { kind: 'comment', about: '', cases: [goodComment] } }])).toEqual([])
    const bad: Array<[string, unknown]> = [
      ['모르는 파일 키', { kind: 'target', about: '', cases: [good], extra: 1 }],
      ['모르는 kind', { kind: 'label', about: '', cases: [good] }],
      ['모르는 사례 키', { kind: 'target', about: '', cases: [{ ...good, expect: 1 }] }],
      ['id 형식', { kind: 'target', about: '', cases: [{ ...good, id: 'G-TTK-1' }] }],
      ['겹친 id', { kind: 'target', about: '', cases: [good, good] }],
      ['빈 refs', { kind: 'target', about: '', cases: [{ ...good, refs: [] }] }],
      ['out 두 키', { kind: 'target', about: '', cases: [{ ...good, out: { uniqueId: 'a', error: 'EMPTY' } }] }],
      ['모르는 오류 코드', { kind: 'target', about: '', cases: [{ ...good, out: { error: 'NOPE' } }] }],
      ['길이 다름', { kind: 'comment', about: '', cases: [{ ...goodComment, out: [] }] }],
      ['모르는 raw 키', { kind: 'comment', about: '', cases: [{ ...goodComment, events: [{ receivedAt: '2026-10-20T11:00:00.000Z', raw: { secUid: 'x' } }] }] }],
      ['시각 형식', { kind: 'comment', about: '', cases: [{ ...goodComment, events: [{ receivedAt: '2026-10-20T11:00:00Z', raw: {} }] }] }],
      ['레코드 여덟 칸', { kind: 'comment', about: '', cases: [{ ...goodComment, out: [{ record: { platform: 'TIKTOK', commentId: '1', userId: '1', nickname: '', text: 'a', receivedAt: '2026-10-20T11:00:00.000Z', owner: false, extra: 1 } }] }] }],
      ['모르는 버림 코드', { kind: 'comment', about: '', cases: [{ ...goodComment, out: [{ drop: 'SPAM' }] }] }],
    ]
    for (const [label, data] of bad) expect(contractProblems([{ file: 'a.json', data }]).length, label).toBeGreaterThan(0)
  })
})

describe('AC-N2b-1-10 아이디·주소 해석 골든 (G-TTK-N2b-1-01~40)', () => {
  for (const c of targetCases) {
    it(`${String(c['id'])} ${String(c['title'])}`, () => {
      expect(parseTikTokTarget(c['in'])).toEqual(c['out'])
    })
  }
})

describe('AC-N2b-1-20 댓글 → 공통 레코드 골든 (G-TTK-N2b-1-41~58)', () => {
  for (const c of commentCases) {
    it(`${String(c['id'])} ${String(c['title'])}`, () => {
      const filter = createCommentFilter(c['target'] as string)
      const events = c['events'] as Array<{ receivedAt: string; raw: unknown }>
      const actual = events.map((e) => filter.accept(e.raw, new Date(e.receivedAt)))
      expect(actual).toEqual(c['out'])
      for (const outcome of actual) if ('record' in outcome) expect(Object.keys(outcome.record)).toEqual(RECORD_KEYS)
    })
  }
})

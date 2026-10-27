// compare: result.json(서버가 만든 상품·음성 기록) ↔ truth.json(영수증에서 만든 정답) → report.md + score.json.
// 번호마다 음성 기록(등록·값·이름·번호 옮김·되돌리기)과 받아쓴 말로 이력을 만들고, 정답 번호를 이력으로 나눈다:
//   OK_FIRST(처음부터 맞음) · OK_AFTER_FIX(틀렸다가 고쳐 맞음) · BROKEN_BY_FIX(맞았다가 나중 바뀜으로 틀림) · WRONG(한 번도 안 맞음) · MISSING(없음)
// 정답에 없는 상품은 "더 있는 상품"으로 적기만 한다(팔리지 않은 상품은 영수증이 없으므로 틀림으로 세지 않는다).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { writeJson } from './lib/common.mjs'

const CONTEXT_SEC = 20

// ── 글 맞추기 ────────────────────────────────────────────────
export const normName = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
const DIG = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
/** 1~9999 한국어 읽기 ("이백오십일") */
export function koreanNumber(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 9999) return null
  const units = [['천', 1000], ['백', 100], ['십', 10]]
  let out = ''
  let rest = n
  for (const [u, v] of units) {
    const d = Math.floor(rest / v)
    rest %= v
    if (d === 0) continue
    out += (d === 1 ? '' : DIG[d]) + u
  }
  return out + DIG[rest]
}
/** 그 번호를 말한 것 같은가 (숫자 또는 한국어 읽기, 공백 무시) */
export function mentions(text, no) {
  if (typeof text !== 'string' || !Number.isInteger(no)) return false
  if (new RegExp(`(?<!\\d)${no}(?!\\d)`).test(text.replace(/(\d),(\d)/g, '$1$2'))) return true
  const k = koreanNumber(no)
  if (k === null) return false
  const flat = text.replace(/\s+/g, '')
  const at = flat.indexOf(k)
  if (at < 0) return false
  // "이백오십일"이 "이백오십일만"처럼 더 긴 수의 앞부분이면 아님 (다음 글자가 수 글자)
  const next = flat[at + k.length] ?? ''
  return !/[일이삼사오육칠팔구십백천만]/.test(next) || next === '번'
}

// ── 받아쓴 말 ────────────────────────────────────────────────
/** transcript.jsonl → 결과 줄 [{t, a, final, text}] (같은 글이 이어지면 하나로) */
export function readTranscript(file) {
  if (file === null || !existsSync(file)) return []
  const out = []
  let last = ''
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (raw.trim() === '') continue
    let line
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line.type !== 'event' || line.ev !== 'result') continue
    const fresh = line.results.slice(line.resultIndex)
    const text = fresh.map((r) => r.alts[0]?.[0] ?? '').join(' ').trim()
    const final = fresh.length > 0 && fresh.every((r) => r.f)
    if (text === '' || `${final}${text}` === last) continue
    last = `${final}${text}`
    out.push({ t: line.t, a: line.a, final, text })
  }
  return out
}

/**
 * 보기 좋게 줄이기: 이어지는 중간 결과는 마지막 것만, 바로 뒤 최종과 같은 중간 결과는 뺀다.
 */
export function condense(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const next = lines[i + 1]
    if (!l.final) {
      if (next !== undefined && !next.final && next.text.replace(/\s+/g, '').startsWith(l.text.replace(/\s+/g, '').slice(0, 2))) continue
      if (next !== undefined && next.final && next.text.replace(/\s+/g, '') === l.text.replace(/\s+/g, '')) continue
    }
    out.push(l)
  }
  return out
}

// ── 이력 ─────────────────────────────────────────────────────
const right = (v, truth) => v !== null && v !== undefined && normName(v.name) === normName(truth.variety) && v.price === truth.price

/**
 * 번호 하나의 이력: 그 번호에 닿은 음성 기록 줄(번호 = no, 옮겨 온 번호 = toNo)을 시각순으로, 단계마다 그 뒤 값.
 * 되돌리기(UNDO)는 값을 before로 돌린다.
 */
export function timelineOf(no, entries, toTranscriptTime) {
  const steps = []
  let value = null
  for (const e of entries) {
    const into = e.kind === 'RENUMBER' && e.toNo === no
    const outOf = e.kind === 'RENUMBER' && e.no === no && e.toNo !== no
    if (e.no !== no && !into) continue
    const before = value
    if (e.kind === 'UNDO') value = e.before === null ? null : { ...(value ?? {}), ...e.before }
    else if (outOf) value = null
    else if (into) value = { ...(e.before ?? {}), ...(e.after ?? {}), no }
    else value = { ...(value ?? {}), ...(e.before ?? {}), ...(e.after ?? {}) }
    if (e.failed === true) value = before
    steps.push({ at: e.at, t: toTranscriptTime(Date.parse(e.at)), kind: e.kind + (into ? `(${e.no}→${no})` : outOf ? `(${no}→${e.toNo})` : ''), before, after: value, heard: e.heard, undone: e.undone, failed: e.failed })
  }
  return steps
}

/** 정답 한 줄 판정 */
export function classify(truth, product, steps) {
  if (product === undefined || product === null) return { cls: 'MISSING', detail: steps.length > 0 ? '음성 기록은 있지만 지금 상품이 없음' : '' }
  const finalOk = right(product, truth)
  const states = steps.map((s) => s.after).filter((v) => v !== null)
  const first = states[0] ?? product
  const everRight = states.some((v) => right(v, truth)) || finalOk
  let cls
  if (finalOk) cls = right(first, truth) && states.every((v) => right(v, truth)) ? 'OK_FIRST' : 'OK_AFTER_FIX'
  else cls = everRight ? 'BROKEN_BY_FIX' : 'WRONG'
  const why = []
  if (!finalOk) {
    const got = normName(product.name)
    const want = normName(truth.variety)
    // 빈 품종은 어느 이름에도 '들어 있어' 비슷함으로 보이므로 따로 센다
    if (got !== want) why.push(got === '' ? 'NO_VARIETY' : got.includes(want) || want.includes(got) ? 'WRONG_VARIETY(비슷함)' : 'WRONG_VARIETY')
    if (product.price !== truth.price) why.push('WRONG_PRICE')
  }
  return { cls, detail: why.join(' ') }
}

const won = (n) => (typeof n === 'number' ? `${n.toLocaleString('ko-KR')}원` : '-')
const val = (v) => (v === null || v === undefined ? '없음' : `${v.name ?? '?'} ${won(v.price)}`)
const clock = (t) => (typeof t === 'number' && Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(11, 19) : '-')
const audioPos = (a) => (typeof a === 'number' ? `${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}` : '-')

/**
 * @param {{ resultFile: string, truthFile: string|null, transcriptFile: string|null, timemapFile?: string|null, outDir: string, label?: string }} o
 */
export function compare(o) {
  const result = JSON.parse(readFileSync(o.resultFile, 'utf8'))
  const truth = o.truthFile !== null && existsSync(o.truthFile) ? JSON.parse(readFileSync(o.truthFile, 'utf8')) : null
  const lines = readTranscript(o.transcriptFile)
  // 재생에서는 서버 시각(실제 시계)이 녹음 시각과 다르다 → 재생이 남긴 대응표로 녹음 시각으로 바꾼다
  const map = o.timemapFile && existsSync(o.timemapFile) ? JSON.parse(readFileSync(o.timemapFile, 'utf8')) : null
  const toT = (wall) => {
    if (map === null || map.length === 0) return wall
    let best = map[0]
    for (const m of map) if (m[0] <= wall) best = m
    return best[1] + (wall - best[0])
  }
  const audioAt = (t) => {
    let best = null
    for (const l of lines) if (l.t <= t && typeof l.a === 'number') best = l
    return best === null ? null : best.a + (t - best.t) / 1000
  }
  // 일부 구간만 녹음했으면(--from·--duration, 또는 끝까지 못 감) 그 구간에서 말하지도 등록하지도 않은 정답 번호는 세지 않는다
  const metaFile = o.transcriptFile === null ? null : join(dirname(o.transcriptFile), 'meta.json')
  const meta = metaFile !== null && existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null
  const partial = o.partial ?? (meta !== null && ((meta.from ?? 0) > 0 || (meta.duration ?? null) !== null || meta.done !== true))
  const entries = [...(result.voiceLog ?? [])].sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.id - y.id)
  const products = new Map(result.products.map((p) => [p.no, p]))
  const truthItems = truth?.items ?? []
  const truthNos = new Set(truthItems.map((t) => t.no))
  const around = (t) => (typeof t === 'number' ? condense(lines.filter((l) => Math.abs(l.t - t) <= CONTEXT_SEC * 1000)) : [])
  const firstMention = (no, regT) => {
    if (typeof regT !== 'number') return null
    const hit = lines.find((l) => l.t <= regT + 2000 && l.t >= regT - 180_000 && mentions(l.text, no))
    return hit ?? null
  }

  const rows = truthItems.map((t) => {
    const steps = timelineOf(t.no, entries, toT)
    const product = products.get(t.no)
    const spoken = lines.find((l) => mentions(l.text, t.no)) ?? null
    const c = partial && product === undefined && steps.length === 0 && spoken === null ? { cls: 'OUT_OF_RANGE', detail: '녹음 구간 밖 (세지 않음)' } : classify(t, product, steps)
    const reg = steps.find((s) => s.kind.startsWith('REGISTER') || s.kind.startsWith('RENUMBER'))
    const mention = firstMention(t.no, reg?.t)
    const ttr = reg !== undefined && mention !== null ? Math.round((reg.t - mention.t) / 100) / 10 : null
    // 같은 품종·값이 다른 번호에 있으면 번호를 잘못 들었을 수 있다
    const elsewhere = c.cls === 'MISSING' || c.cls === 'WRONG' ? result.products.filter((p) => p.no !== t.no && normName(p.name) === normName(t.variety) && p.price === t.price && !truthNos.has(p.no)).map((p) => p.no) : []
    return { no: t.no, truth: { variety: t.variety, price: t.price, qty: t.qty, unsure: t.unsure === true }, product: product ?? null, ...c, numberSuspect: elsewhere, timeToRegisterSec: ttr, steps, mentionT: mention?.t ?? spoken?.t ?? null }
  })
  const extras = result.products
    .filter((p) => !truthNos.has(p.no))
    .map((p) => {
      const steps = timelineOf(p.no, entries, toT)
      const reg = steps.find((s) => s.kind.startsWith('REGISTER') || s.kind.startsWith('RENUMBER'))
      const mention = firstMention(p.no, reg?.t)
      return { no: p.no, product: p, steps, mentionT: mention?.t ?? null, timeToRegisterSec: reg !== undefined && mention !== null ? Math.round((reg.t - mention.t) / 100) / 10 : null }
    })

  const counts = { OK_FIRST: 0, OK_AFTER_FIX: 0, BROKEN_BY_FIX: 0, WRONG: 0, MISSING: 0 }
  let outOfRange = 0
  for (const r of rows) {
    if (r.cls === 'OUT_OF_RANGE') outOfRange++
    else counts[r.cls]++
  }
  const scored = rows.length - outOfRange
  const detailCounts = {}
  for (const r of rows) for (const d of r.detail.split(' ').filter((x) => x.startsWith('WRONG_'))) detailCounts[d] = (detailCounts[d] ?? 0) + 1
  const ttrs = rows.map((r) => r.timeToRegisterSec).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  const score = {
    label: o.label ?? '',
    at: new Date().toISOString(),
    truth: truth === null ? null : truthItems.length,
    products: result.products.length,
    extras: extras.length,
    voiceLog: entries.length,
    partial,
    scored,
    outOfRange,
    counts,
    correct: counts.OK_FIRST + counts.OK_AFTER_FIX,
    accuracy: scored === 0 ? null : Math.round(((counts.OK_FIRST + counts.OK_AFTER_FIX) / scored) * 1000) / 1000,
    detailCounts,
    numberSuspect: rows.filter((r) => r.numberSuspect.length > 0).length,
    timeToRegister: ttrs.length === 0 ? null : { n: ttrs.length, median: ttrs[Math.floor(ttrs.length / 2)], max: ttrs.at(-1) },
    items: rows.map((r) => ({ no: r.no, cls: r.cls, detail: r.detail, ttr: r.timeToRegisterSec, steps: r.steps.length })),
    extraItems: extras.map((x) => ({ no: x.no, name: x.product.name, price: x.product.price, ttr: x.timeToRegisterSec, steps: x.steps.length })),
  }
  writeJson(join(o.outDir, 'score.json'), score)

  // ── report.md ──
  const md = []
  md.push(`# 재생 비교 ${o.label ?? ''}`, '')
  md.push(`- 결과: ${o.resultFile}`, `- 정답: ${truth === null ? '없음 (등록 목록만)' : `${o.truthFile} (${truthItems.length}개)`}`, `- 받아쓴 말: ${lines.length}줄`, `- 상품 ${result.products.length}개, 음성 기록 ${entries.length}줄, 정답에 없는 상품 ${extras.length}개`, '')
  if (truth !== null) {
    md.push('## 점수', '', '| 나눔 | 개수 |', '|---|---|')
    for (const [k, v] of Object.entries(counts)) md.push(`| ${k} | ${v} |`)
    md.push(`| 맞음(합) | ${score.correct}/${scored} |`, '')
    if (outOfRange > 0) md.push(`일부 구간 녹음이라 그 구간에서 말하지도 등록하지도 않은 정답 ${outOfRange}개는 세지 않았어요 (OUT_OF_RANGE).`, '')
    if (Object.keys(detailCounts).length > 0) md.push(`틀린 까닭: ${Object.entries(detailCounts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '')
    if (score.timeToRegister !== null) md.push(`처음 말한 때부터 등록까지: 중앙값 ${score.timeToRegister.median}초, 가장 긴 것 ${score.timeToRegister.max}초 (${score.timeToRegister.n}개)`, '')
    md.push('## 정답 번호별', '', '| 번호 | 나눔 | 정답 | 지금 상품 | 까닭 | 등록까지(초) | 단계 |', '|---|---|---|---|---|---|---|')
    const order = { BROKEN_BY_FIX: 0, WRONG: 1, MISSING: 2, OK_AFTER_FIX: 3, OK_FIRST: 4, OUT_OF_RANGE: 5 }
    const sorted = [...rows].sort((x, y) => order[x.cls] - order[y.cls] || x.no - y.no)
    for (const r of sorted) md.push(`| ${r.no} | ${r.cls} | ${r.truth.variety} ${won(r.truth.price)}${r.truth.unsure ? ' (불확실)' : ''} | ${val(r.product)} | ${r.detail}${r.numberSuspect.length > 0 ? ` 번호 의심→${r.numberSuspect.join(',')}` : ''} | ${r.timeToRegisterSec ?? '-'} | ${r.steps.length} |`)
    md.push('')
    md.push('## 이력 (BROKEN_BY_FIX·WRONG·MISSING 먼저)', '')
    for (const r of sorted) {
      if (r.cls === 'OUT_OF_RANGE') continue
      md.push(`### ${r.no}번 — ${r.cls} ${r.detail}`, '', `정답: ${r.truth.variety} ${won(r.truth.price)} · 지금: ${val(r.product)}`, '')
      pushSteps(md, r.steps, around, audioAt, r.no, r.mentionT)
    }
  }
  md.push('## 정답에 없는 상품 (틀림으로 세지 않음)', '')
  if (extras.length === 0) md.push('없음', '')
  else {
    md.push('| 번호 | 상품 | 단계 | 등록까지(초) | 처음 들은 말 |', '|---|---|---|---|---|')
    for (const x of extras) md.push(`| ${x.no} | ${val(x.product)} | ${x.steps.length} | ${x.timeToRegisterSec ?? '-'} | ${(x.steps[0]?.heard ?? '').replace(/\|/g, '/').slice(0, 80)} |`)
    md.push('')
    md.push('### 이력', '')
    for (const x of extras) {
      md.push(`#### ${x.no}번 — ${val(x.product)}`, '')
      pushSteps(md, x.steps, around, audioAt, x.no, x.mentionT)
    }
  }
  writeFileSync(join(o.outDir, 'report.md'), `${md.join('\n')}\n`)
  return score
}

function pushSteps(md, steps, around, audioAt, no, mentionT) {
  if (steps.length === 0) {
    md.push(mentionT === null ? '음성 기록 없음, 받아쓴 말에도 그 번호가 없음 (못 알아들었거나 다른 번호로 들음)' : '음성 기록 없음 — 받아쓴 말에는 그 번호가 있음 (알아들었지만 등록되지 않음)', '')
    if (mentionT !== null) {
      md.push(`<details><summary>받아쓴 말 ±${CONTEXT_SEC}초 (처음 말한 때)</summary>`, '', '```')
      for (const l of around(mentionT).slice(0, 60)) md.push(`${clock(l.t)} ${audioPos(l.a)} ${l.final ? 'F' : 'i'}${mentions(l.text, no) ? '*' : ' '} ${l.text}`)
      md.push('```', '', '</details>', '')
    }
    return
  }
  md.push('| 시각 | 소리 위치 | 단계 | 전 → 후 | 들은 말 |', '|---|---|---|---|---|')
  for (const s of steps) md.push(`| ${clock(s.t)} | ${audioPos(audioAt(s.t))} | ${s.kind}${s.undone ? ' (되돌려짐)' : ''}${s.failed ? ' (실패)' : ''} | ${val(s.before)} → ${val(s.after)} | ${String(s.heard ?? '').replace(/\|/g, '/').slice(0, 120)} |`)
  md.push('')
  const anchor = mentionT ?? steps[0].t
  const ctx = around(anchor)
  const later = steps.slice(1).filter((s) => Math.abs(s.t - anchor) > CONTEXT_SEC * 1000)
  if (ctx.length > 0) {
    md.push(`<details><summary>받아쓴 말 ±${CONTEXT_SEC}초 (처음 말한 때/등록 무렵)</summary>`, '', '```')
    for (const l of ctx.slice(0, 60)) md.push(`${clock(l.t)} ${audioPos(l.a)} ${l.final ? 'F' : 'i'}${mentions(l.text, no) ? '*' : ' '} ${l.text}`)
    md.push('```', '', '</details>', '')
  }
  for (const s of later) {
    const c = around(s.t)
    if (c.length === 0) continue
    md.push(`<details><summary>받아쓴 말 ±${CONTEXT_SEC}초 (${s.kind} ${clock(s.t)})</summary>`, '', '```')
    for (const l of c.slice(0, 60)) md.push(`${clock(l.t)} ${audioPos(l.a)} ${l.final ? 'F' : 'i'}${mentions(l.text, no) ? '*' : ' '} ${l.text}`)
    md.push('```', '', '</details>', '')
  }
}

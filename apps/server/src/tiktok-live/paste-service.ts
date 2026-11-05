// 댓글 붙여넣기 — 미리 보기·넣기 (PLT-02, ORD-08, R-3·R-4·R-11, D-N2b-2-07·D-N2b-2-08, AC-N2b-2-56~59).
// - 미리 보기는 아무것도 기록하지 않는다. 넣기는 글을 다시 읽고(미리 보기 결과를 믿지 않는다) 주문 줄의 번호마다 sms 하나를 한 트랜잭션으로 기록한다.
// - 한 번 넣기 안에서 닉네임이 처음 나온 sms는 새 문자 구매자, 같은 닉네임의 뒤 sms는 그 구매자(sms:<처음 ref>)를 지정 구매자로.
//   앞선 붙여넣기·틱톡·인스타·유튜브 구매자에는 저절로 잇지 않는다(같은 사람이면 판매자가 합치기, D-051).
// - ref = 요청 번호·줄·번호 순서로 정한다 — 같은 요청 번호로 다시 보내도 같은 ref(재전송 사본). ref에는 닉네임·글이 들어가지 않는다.
// - 권한·회차는 문자찜 입력과 같다: 판매자는 실제·리허설, 보조자는 실제 회차만, 끝난 회차도 받는다.
// - 붙여 넣은 글은 저장하지 않는다(요약값만 — 같은 요청 번호에 다른 글인지 보려고). 로그·오류 응답에 쓰지 않는다.
//   재전송 응답용으로 두는 결과도 닉네임·댓글을 뺀 뼈대(줄 번호·결과 코드·번호·안내 문구·넣은 수)뿐이다. 같은 요청 번호 재전송은
//   요약값이 같아 같은 글이 오므로, 닉네임·댓글은 그 글을 다시 읽어 줄 번호로 채운다 (DAT-06·D-079, SA/RA-N2b-2-01).
// - 겹침 (D-N2b-2-14, AC-N2b-2-54): 그 회차(같은 범위)의 그 번호에 활성 찜이 있고 그 찜을 만든 입력의 이름(채팅 = 닉네임, 문자찜 = 메모 — 같은 정리)이
//   줄의 정리한 닉네임과 같으면 그 번호는 기본으로 넣지 않는다. 넣기는 고른 줄(includeOverlaps)의 겹친 번호도 넣는다.
//   넣기는 락 안에서 겹침을 다시 본다(그 사이 들어온 채팅도). 요약값에 고른 줄을 넣는다 — 같은 요청 번호에 고르기만 달라도 REQUEST_REUSED.
import { createHash } from 'node:crypto'
import { getBroadcast, listClaims, type EngineState } from '@livejjim/core'
import type { Db } from '../db/database.ts'
import type { LinkOutcome } from '../live-links.ts'
import { sha256Hex } from '../secrets.ts'
import { findBroadcast, type BroadcastRow } from '../store.ts'
import { kstTime } from '../time.ts'
import type { Actor, Draft, Rejection, ScopeWriter } from '../writer.ts'
import { applyOverlaps, classifyPaste, insertNumbers, overlapCandidates, parsePaste, PASTE_MESSAGES, type OverlapCandidate, type PasteLineView, type PastePlan, type PasteRow } from './paste.ts'
import { findPasteRequest, inputNamesBySeq, insertPasteRequest } from './store.ts'

export interface PasteServiceOptions {
  readonly db: Db
  readonly writer: ScopeWriter
}

const error = (status: number, code: string, message: string, problems: readonly { field: string | null; message: string }[] = []): LinkOutcome => ({
  status,
  body: { error: { code, message, ...(problems.length > 0 ? { problems } : {}) } },
})
const notFound = error(404, 'NOT_FOUND', '찾을 수 없어요.')
const rejection = (status: number, code: Rejection['code'], message: string): Rejection => ({ status, code, message, problems: [] })

/** ref = pst + (판매자·요청 번호의 요약값을 영문 소문자 16자로) + -줄 + -번호 순서. 숫자는 줄·순서뿐이라 휴대폰 번호가 될 수 없다 */
export function pasteRef(sellerId: string, requestId: string, line: number, order: number): string {
  const hash = createHash('sha256').update(`paste\u0000${sellerId}\u0000${requestId}`).digest()
  let letters = ''
  for (let i = 0; i < 16; i += 1) letters += String.fromCharCode(97 + ((hash[i] as number) % 26))
  return `pst${letters}-${String(line)}-${String(order)}`
}

/** 응답 본문 (미리 보기·넣기 같은 모양 — 넣기는 added가 더 있다) */
function planBody(plan: PastePlan): Record<string, unknown> {
  return { rows: plan.rows, groups: plan.groups, total: plan.total }
}

/** 저장용 뼈대: 줄에서 닉네임·댓글을, 묶음에서 닉네임을 뺀다 (묶음의 닉네임은 첫 줄의 닉네임과 같다) */
interface StoredInsert {
  readonly rows: readonly Omit<PasteLineView, 'nickname' | 'text'>[]
  readonly groups: readonly { readonly lines: readonly number[]; readonly claims: number; readonly message: string | null }[]
  readonly total: number
  readonly added: number
}

export function pasteSkeleton(plan: PastePlan, added: number): StoredInsert {
  return {
    rows: plan.rows.map((row) => ({
      line: row.line,
      result: row.result,
      numbers: row.numbers,
      message: row.message,
      ...(row.overlaps === undefined ? {} : { overlaps: row.overlaps, overlapMessage: row.overlapMessage }),
    })),
    groups: plan.groups.map((group) => ({ lines: group.lines, claims: group.claims, message: group.message })),
    total: plan.total,
    added,
  }
}

/** 뼈대 + 다시 읽은 글 → 처음 응답과 같은 본문. 닉네임·댓글은 줄 번호로 찾는다 (주문·취소·주문 아님 줄만 닉네임·댓글이 있었다) */
export function pasteRehydrate(stored: StoredInsert, parsed: readonly PasteRow[]): Record<string, unknown> {
  const byLine = new Map<number, { nickname: string; text: string }>()
  for (const row of parsed) if (!('error' in row)) byLine.set(row.line, { nickname: row.nickname, text: row.text })
  const rows: PasteLineView[] = stored.rows.map((row) => {
    const source = row.result === 'ORDER' || row.result === 'CANCEL_NOT_SUPPORTED' || row.result === 'NOT_ORDER' ? byLine.get(row.line) : undefined
    if (source === undefined) return { ...row }
    const { line, result, numbers, message, ...overlap } = row
    return { line, nickname: source.nickname, text: source.text, result, numbers, message, ...overlap }
  })
  const groups = stored.groups.map((group) => ({ nickname: byLine.get(group.lines[0] as number)?.nickname ?? '', lines: group.lines, claims: group.claims, message: group.message }))
  return { rows, groups, total: stored.total, added: stored.added }
}

/** 겹침 재료: 그 번호의 활성 찜과 그 찜을 만든 입력의 이름 (seq → 이름) */
interface OverlapInputs {
  readonly candidates: readonly OverlapCandidate[]
  readonly names: ReadonlyMap<number, string>
}

export class PasteService {
  readonly #options: PasteServiceOptions

  constructor(options: PasteServiceOptions) {
    this.#options = options
  }

  /** 회차 */
  async #broadcast(sellerId: string, broadcastId: string): Promise<BroadcastRow | LinkOutcome> {
    const row = await findBroadcast(this.#options.db, sellerId, broadcastId)
    if (row === null) return notFound
    return row
  }

  /** 미리 보기 (AC-N2b-2-56): 기록하지 않는다 */
  async preview(sellerId: string, broadcastId: string, text: string): Promise<LinkOutcome> {
    const row = await this.#broadcast(sellerId, broadcastId)
    if ('status' in row) return row
    const parsed = parsePaste(text)
    if ('error' in parsed) return error(400, parsed.error, PASTE_MESSAGES[parsed.error])
    const state = (await this.#options.writer.read(sellerId, row.date, row.rehearsal)).state
    const settings = getBroadcast(state, broadcastId)?.settings
    if (settings === undefined) return notFound
    const plan = classifyPaste(parsed.rows, settings)
    const candidates = overlapCandidates(listClaims(state), broadcastId, plan)
    const names = await inputNamesBySeq(this.#options.db, sellerId, row.date, row.rehearsal, candidates.map((candidate) => candidate.seq))
    return { status: 200, body: planBody(applyOverlaps(plan, candidates, names, new Set())) }
  }

  /** 락 안에서 따라잡은 상태로 겹침 재료를 읽는다 (넣기의 guard — build는 같은 상태를 받는다) */
  async #overlapInputs(tx: Db, state: EngineState, sellerId: string, row: BroadcastRow, broadcastId: string, rows: readonly PasteRow[]): Promise<OverlapInputs | null> {
    const settings = getBroadcast(state, broadcastId)?.settings
    if (settings === undefined) return null
    const candidates = overlapCandidates(listClaims(state), broadcastId, classifyPaste(rows, settings))
    const names = await inputNamesBySeq(tx, sellerId, row.date, row.rehearsal, candidates.map((candidate) => candidate.seq))
    return { candidates, names }
  }

  /** 넣기 (AC-N2b-2-57): 번호마다 문자찜 — 한 트랜잭션. 같은 요청 번호는 같은 글일 때 처음 응답, 다른 글이면 REQUEST_REUSED */
  async insert(
    sellerId: string,
    actor: Actor,
    requestId: string,
    broadcastId: string,
    text: string,
    includeOverlaps: readonly number[] = [],
  ): Promise<LinkOutcome> {
    const row = await this.#broadcast(sellerId, broadcastId)
    if ('status' in row) return row
    const include = [...new Set(includeOverlaps)].sort((a, b) => a - b)
    // 고른 줄이 없으면 예전 요약값과 같다 (고른 줄이 있을 때만 더한다)
    const digest = sha256Hex(JSON.stringify(include.length === 0 ? ['paste', broadcastId, text] : ['paste', broadcastId, text, include]))
    const again = async (): Promise<LinkOutcome> => {
      const prior = await findPasteRequest(this.#options.db, sellerId, requestId)
      if (prior !== null && prior.broadcastId === broadcastId && prior.digest === digest) {
        // 요약값이 같다 = 같은 글이다. 닉네임·댓글은 저장하지 않았으니 이 글을 다시 읽어 채운다
        const reparsed = parsePaste(text)
        const stored = JSON.parse(prior.result) as StoredInsert
        return { status: 200, body: pasteRehydrate(stored, 'error' in reparsed ? [] : reparsed.rows) }
      }
      return error(409, 'REQUEST_REUSED', '이미 보낸 내용이에요. 다시 미리 보기를 해 주세요.')
    }
    if ((await findPasteRequest(this.#options.db, sellerId, requestId)) !== null) return again()
    const parsed = parsePaste(text)
    if ('error' in parsed) return error(400, parsed.error, PASTE_MESSAGES[parsed.error])
    let result: LinkOutcome | null = null
    let stored: StoredInsert | null = null
    let overlap: OverlapInputs | null = null
    const outcome = await this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId,
      guard: async (tx, runtime) => {
        overlap = await this.#overlapInputs(tx, runtime.state, sellerId, row, broadcastId, parsed.rows)
        return null
      },
      build: (ctx) => {
        // 그때의 회차 스냅샷으로 다시 읽는다 (미리 보기와 넣기 사이에 바뀌었어도 지금 것)
        const settings = getBroadcast(ctx.state, broadcastId)?.settings
        if (settings === undefined) return rejection(404, 'NOT_FOUND', '찾을 수 없어요.')
        const inputs = overlap as OverlapInputs | null
        const plan = applyOverlaps(classifyPaste(parsed.rows, settings), inputs?.candidates ?? [], inputs?.names ?? new Map(), new Set(include))
        if (plan.total === 0) return rejection(409, 'NOTHING_TO_ADD', PASTE_MESSAGES.NOTHING_TO_ADD)
        // 수신 시각 = 넣기를 받은 서버 시각 (KST HH:MM:SS, 한 번 넣기에 같은 값 — D-089)
        const received = kstTime(ctx.at)
        const firstRef = new Map<string, string>()
        const drafts: Draft[] = []
        for (const line of plan.rows) {
          if (line.result !== 'ORDER' || line.nickname === undefined) continue
          const nickname = line.nickname
          const keep = new Set(insertNumbers(line))
          line.numbers.forEach((no, index) => {
            if (!keep.has(no)) return
            const ref = pasteRef(sellerId, requestId, line.line, index + 1)
            const first = firstRef.get(nickname)
            if (first === undefined) firstRef.set(nickname, ref)
            drafts.push({
              fields: { type: 'sms', b: broadcastId, ref, no, received, memo: nickname, ...(first === undefined ? {} : { buyer: `sms:${first}` }) },
              actor,
              smsRef: ref,
              ...(drafts.length === 0 ? { requestId } : {}),
            })
          })
        }
        result = { status: 200, body: { ...planBody(plan), added: drafts.length } }
        stored = pasteSkeleton(plan, drafts.length)
        return drafts
      },
      afterInsert: async (tx, _scopeId, _records, now) => {
        await insertPasteRequest(tx, { sellerId, requestId, broadcastId, digest, result: JSON.stringify(stored), now })
      },
    })
    switch (outcome.kind) {
      case 'ok':
        return result ?? error(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
      case 'duplicate':
        return again()
      case 'rejected':
        return error(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems)
      case 'not_found':
        return notFound
      case 'empty':
      case 'save_failed':
        return error(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    }
  }
}

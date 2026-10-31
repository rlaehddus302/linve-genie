// 화면 단위 시험 도우미: 실제 코어 엔진으로 도는 가짜 서버 (한 날짜·실제 범위, 방송 b1·b2).
// 서버 계약(harness/sprints/S04·S05·S06 dev-notes)의 모양대로 범위 조회·증분 조회·쓰기를 흉내 낸다 — 쓰기마다 SSE change 알림.
// 문자찜: ref는 서버가 만들고, phone은 정규화해 phoneKey·phoneLast4만 엔진에 넣는다(원문은 버린다), received를 비우면 '10:00:00'.
//   응답의 buyer는 그 이벤트를 적용한 뒤 상태의 코어 buyerOfRef (S06b 서버 계약, D-099).
// 합치기 미리 보기 GET /api/days/:date/merge-preview?from=&into= — 지금 상태로 코어 previewMerge, { date, rehearsal, seq, preview } (D-100).
// SRV1 (약속 1·2): 읽기 입구는 FakeServer가 서버와 같은 읽기 함수로 답한다. 쓰기는 친 글 원문을 받는다 — 빠른 입력 줄 `text`,
//   고치기 칸 `no`·`price` 글, 상품 고치기 `price` 글, 문자찜 `received` 글, 정산 `amount` 글(할인은 `sign: 'minus'`) — 서버처럼 같은 함수로 읽어 기록한다.
//   posts에는 받은 원문 본문 그대로 남는다.
import { applyEvent, buyerOfRef, getProduct, containsPhoneRun, isValidReceivedTime, listClaims, normalizePhone, phoneLast4, previewMerge, type EngineState, type SettingsOverride } from '@livejjim/core'
import type { Changes, WriteResult } from '../src/api/types.ts'
import { settlementKey } from '../src/lib/scope-data.ts'
import { T0, run, viewOf } from './engine.ts'
import { DATE, FakeEventSource, FakeServer, apiError, readRawWrite, type Reply } from './support.ts'
import type { QuickSettings, ReadProduct } from '../../../packages/voice-session/src/read/index.ts'

export const PHONE_SENTENCE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

type Lists = Record<string, Record<string, unknown>[]>
const KEY: Record<string, (item: Record<string, unknown>) => string> = {
  broadcasts: (item) => String(item.id),
  products: (item) => String(item.key),
  claims: (item) => String(item.id),
  pending: (item) => String(item.product),
  buyers: (item) => String(item.id),
  settlements: (item) => settlementKey(item as { buyer: string; date: string }),
  effects: (item) => String(item.id),
  cancelRequests: (item) => String(item.claim),
}

function lists(state: EngineState): Lists {
  const view = viewOf(state, 0) as unknown as Record<string, unknown>
  const out: Lists = {}
  for (const name of Object.keys(KEY)) out[name] = view[name] as Record<string, unknown>[]
  return out
}

export interface EngineServerOptions {
  readonly settings?: SettingsOverride
  readonly ended?: readonly string[]
  readonly delayMs?: number
}

export class EngineServer {
  readonly server = new FakeServer()
  /** 받아 기록한 쓰기 (요청 본문 + 원문 칸을 읽은 엔진 필드, SRV1) */
  readonly posts: Record<string, unknown>[] = []
  /** 음성 쓰기에 실려 온 기록 한 줄 (R-25) */
  readonly voiceLogs: unknown[] = []
  readonly #states: EngineState[]
  readonly #results = new Map<string, WriteResult>()
  #refs = 0
  /** 다음 쓰기를 이 응답으로 대신한다 (한 번) */
  failNext: Reply | null = null
  /** 받은 receivedLateOk 값들 (REL1) */
  readonly lateOks: unknown[] = []
  /** 쓰기가 서버에 닿지 않는다 (네트워크 오류) */
  down = false
  /** 쓰기는 서버에 닿아 기록되지만 응답을 잃는다 (네트워크 오류로 보임 — 같은 요청 번호는 한 번만 기록, MOB2 D-MOB2-14) */
  loseReply = false

  constructor(events: readonly Record<string, unknown>[] = [], options: EngineServerOptions = {}) {
    const first = run([], options.settings ?? {})
    this.#states = [first.state]
    for (const event of events) this.#apply(event)
    const ended = new Set(options.ended ?? [])
    // 가짜 읽기 입구도 엔진 상태의 상품으로 읽는다 (서버 readScope와 같다)
    this.server.findProduct = this.readProduct
    // 원문은 같은 요청 번호 확인(이미 기록한 요청이면 처음 결과) 뒤에 읽는다 — 실제 서버 기록 경로와 같은 차례
    this.server.decodeRawWrites = false
    this.server
      .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
      .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: options.delayMs ?? 60 } }))
      .on('GET', /^\/api\/broadcasts$/, () => ({
        body: {
          broadcasts: [
            { id: 'b1', date: DATE, title: '1부', rehearsal: false, ended: ended.has('b1'), endedAt: null },
            { id: 'b2', date: DATE, title: '2부', rehearsal: false, ended: ended.has('b2'), endedAt: null },
          ],
        },
      }))
      .on('GET', /^\/api\/days(\?rehearsal=true)?$/, (_call, match) => ({ body: { days: match[1] === undefined ? [{ date: DATE, rehearsal: false, seq: this.seq }] : [] } }))
      .on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: viewOf(this.state, this.seq) }))
      .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => ({ body: this.changes(Number(match[1])) }))
      .on('GET', new RegExp(`^/api/days/${DATE}/history\\?`), () => ({ body: { date: DATE, rehearsal: false, events: [] } }))
      .on('GET', /^\/api\/broadcasts\/[^/]+\/rehearsal\/generator$/, () => ({
        body: { generator: { running: false, sent: 0, total: 0, perSecond: 0, seed: null, duplicates: 0, failed: 0, stopReason: null } },
      }))
      .on('GET', new RegExp(`^/api/days/${DATE}/messages\\?`), () => ({ body: { date: DATE, rehearsal: false, seq: this.seq, messages: [], more: false } }))
      .on('GET', new RegExp(`^/api/days/${DATE}/merge-preview\\?`), (call) => this.mergePreview(call.path))
      .on('POST', /^\/api\/events/, (call) => this.#post(call.body ?? {}))
  }

  get state(): EngineState {
    return this.#states.at(-1) as EngineState
  }

  get seq(): number {
    return this.#states.length - 1
  }

  /** 다른 기기의 쓰기 (알림과 함께) */
  write(event: Record<string, unknown>): void {
    this.#apply(event)
    this.#notify(String(event.type))
  }

  /** 다른 기기의 쓰기 — 알림 없이 (화면이 아직 모른다) */
  writeQuietly(event: Record<string, unknown>): void {
    this.#apply(event)
  }

  #apply(event: Record<string, unknown>): boolean {
    const before = JSON.stringify(lists(this.state))
    const seq = this.#states.length
    const next = applyEvent(this.state, { ...event, seq, at: T0 + seq * 1000 } as never).state
    this.#states.push(next)
    return JSON.stringify(lists(next)) !== before
  }

  #notify(type: string): void {
    const stream = FakeEventSource.instances.at(-1)
    stream?.emit('change', { date: DATE, rehearsal: false, seq: this.seq, type })
  }

  #post(body: Record<string, unknown>): Reply {
    if (this.down) return { network: true }
    const reply = this.#handle(body)
    return this.loseReply ? { network: true } : reply
  }

  #handle(body: Record<string, unknown>): Reply {
    // voiceLog(R-25)는 엔진 필드가 아니다 — 실제 서버처럼 떼고 따로 남긴다
    // receivedLateOk(REL1)는 판매자가 늦은 받은 시각을 확인했다는 원문 칸이다 — 서버처럼 읽고 엔진 필드로 넘기지 않는다
    const { requestId, voiceLog, receivedLateOk, ...sent } = body
    if (receivedLateOk !== undefined) this.lateOks.push(receivedLateOk)
    if (voiceLog !== undefined) this.voiceLogs.push(voiceLog)
    const prior = this.#results.get(String(requestId))
    if (prior !== undefined) return { body: prior }
    if (this.failNext !== null) {
      const reply = this.failNext
      this.failNext = null
      return reply
    }
    this.posts.push(body)
    // 원문 칸은 서버처럼 같은 읽기 함수로 읽어 엔진 필드로 (SRV1 약속 2 — apps/server/src/raw-input.ts와 같은 약속)
    const raw = this.#readRaw(sent)
    if (!('event' in raw)) return raw
    const input = raw.event
    // posts에는 받은 원문 본문과 서버가 읽어 기록한 엔진 필드를 함께 남긴다 (원문 단언·기록 값 단언 둘 다)
    this.posts[this.posts.length - 1] = { ...body, ...input }
    let event: Record<string, unknown> = input
    let last4: string | null | undefined
    let ref: string | undefined
    // 정산 메모·사유의 전화번호: 서버가 지금 화면 문장으로 거절한다 (SRV1 AC-SRV1-08 — 화면은 먼저 막지 않는다)
    if (String(input.type).startsWith('settlement.')) {
      for (const field of ['memo', 'reason']) {
        const value = input[field]
        if (typeof value === 'string' && containsPhoneRun(value)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message: PHONE_SENTENCE }])
      }
    }
    if (input.type === 'sms') {
      if (typeof input.memo === 'string' && containsPhoneRun(input.memo)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'memo', message: PHONE_SENTENCE }])
      if (input.received !== undefined && !isValidReceivedTime(input.received)) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'received', message: '받은 시각을 확인해 주세요.' }])
      const { phone, last4: spoken, newBuyer, voice, ...rest } = input
      // 실제 서버와 같은 입력 검사 (RA-V1-003, service.ts #writeSms): 끝자리는 숫자 네 개 글만, 전화번호·지정 구매자와 함께 보내지 않는다. voice는 true만
      if (spoken !== undefined && (typeof spoken !== 'string' || !/^[0-9]{4}$/.test(spoken))) {
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'last4', message: '끝자리는 숫자 네 개로 적어 주세요.' }])
      }
      if (spoken !== undefined && (phone !== undefined || input.buyer !== undefined)) {
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'last4', message: '끝자리·전화번호·구매자 중 하나만 보내 주세요.' }])
      }
      if (voice !== undefined && voice !== true) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'voice', message: '음성으로 넣었는지는 예로만 적을 수 있어요.' }])
      const normalized = typeof phone === 'string' ? normalizePhone(phone) : null
      last4 = normalized === null ? null : phoneLast4(normalized)
      // V1 음성 문자찜의 끝자리 (서버 sms-last4 계약): 범위 안 문자 구매자 중 같은 끝자리(지금의 구매자로 셈) — 한 사람이면 buyer, 없으면 끝자리 키, 둘 이상이면 409
      let chosen: Record<string, unknown> = {}
      if (newBuyer !== undefined && (newBuyer !== true || typeof spoken !== 'string' || phone !== undefined || input.buyer !== undefined)) {
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'newBuyer', message: '새 손님으로 넣기는 끝자리와 함께 보내 주세요.' }])
      }
      if (typeof spoken === 'string' && newBuyer === true) {
        // 새 손님으로 넣기 (D-V1-14): 후보를 찾지 않고 그 문자찜 ref까지 담은 키
        chosen = { phoneKey: `last4-new-key-${spoken}-r${String(this.#refs + 1)}`, phoneLast4: spoken }
      } else if (typeof spoken === 'string') {
        const buyers = lists(this.state).buyers ?? []
        const found: string[] = []
        for (const buyer of buyers) {
          if (buyer.kind !== 'sms' || buyer.phoneLast4 !== spoken) continue
          const current = String(buyer.current)
          if (!found.includes(current)) found.push(current)
        }
        // 후보마다 그 범위의 활성 찜 번호 (D-V1-14 claims — 찜 생성 순서, 같은 번호는 한 번)
        const claimsOf = (id: string): number[] => {
          const out: number[] = []
          for (const claim of listClaims(this.state)) {
            if (claim.currentBuyer !== id || !['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'].includes(claim.status)) continue
            if (!out.includes(claim.no)) out.push(claim.no)
          }
          return out
        }
        const candidates = found.map((id) => {
          const buyer = buyers.find((item) => item.id === id)
          return { buyer: id, display: String(buyer?.display ?? ''), phoneLast4: spoken, claims: claimsOf(id) }
        })
        if (found.length > 1) {
          return { status: 409, body: { error: { code: 'BUYER_AMBIGUOUS', message: `끝자리 ${spoken} 손님이 여러 명이에요. 누구인지 골라 주세요.` }, candidates } }
        }
        // 이름을 함께 말했는데 한 사람인 후보의 표시 이름이 문자찜(<이름>)이 아니면 고르기 (D-V1-14)
        const name = typeof input.memo === 'string' ? input.memo.trim() : ''
        if (found.length === 1 && name !== '' && candidates[0]?.display !== `문자찜(${name})`) {
          return { status: 409, body: { error: { code: 'BUYER_AMBIGUOUS', message: `끝자리 ${spoken} 손님의 이름이 달라요. 누구인지 골라 주세요.` }, candidates } }
        }
        chosen = found.length === 1 ? { buyer: found[0] } : { phoneKey: `last4-scope-key-${spoken}`, phoneLast4: spoken }
      }
      this.#refs++
      ref = `r${String(this.#refs)}`
      event = {
        ...rest,
        ref,
        received: input.received ?? '10:00:00',
        ...(normalized === null ? {} : { phoneKey: `phonekey-${normalized}`, phoneLast4: last4 }),
        ...chosen,
      }
    }
    for (const field of ['reason', 'memo'] as const) {
      if (typeof event[field] === 'string' && containsPhoneRun(event[field])) return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message: PHONE_SENTENCE }])
    }
    const changed = this.#apply(event)
    const result: WriteResult = {
      date: DATE,
      rehearsal: false,
      seq: this.seq,
      type: String(input.type),
      changed,
      effects: [],
      ...(last4 === undefined ? {} : { phoneLast4: last4 }),
      ...(ref === undefined ? {} : { buyer: buyerOfRef(this.state, ref) }),
    }
    this.#results.set(String(requestId), result)
    queueMicrotask(() => this.#notify(String(input.type)))
    return { body: result }
  }

  /** 그 방송의 읽기 설정 (엔진 상태의 방송 설정) */
  #readSettings(b: unknown): QuickSettings {
    const view = viewOf(this.state, this.seq) as unknown as { broadcasts?: { id: string; settings?: { 'price.unit'?: QuickSettings['price.unit']; 'claim.maxNumber'?: number } }[] }
    const settings = view.broadcasts?.find((item) => item.id === b)?.settings
    return { 'price.unit': settings?.['price.unit'] ?? 'THOUSAND', 'claim.maxNumber': settings?.['claim.maxNumber'] ?? 999 }
  }

  /** 그 방송의 번호 → 읽기용 상품 (엔진 상태 — 판매 종료한 상품도 있다) */
  readProduct = (b: string, no: number): ReadProduct | undefined => {
    const product = getProduct(this.state, b, no)
    return product === null ? undefined : { id: product.id, no: product.no, name: product.name, price: product.price, closed: product.status === 'CLOSED' }
  }

  /** 원문 칸을 서버처럼 읽어 엔진 필드로 (support.ts readRawWrite — 서버 raw-input.ts와 같은 약속) */
  #readRaw(input: Record<string, unknown>): { event: Record<string, unknown> } | Reply {
    return readRawWrite(input, (b) => this.#readSettings(b), this.readProduct)
  }

  /** 받은 합치기 미리 보기 조회 수 */
  previews = 0
  /** 다음 합치기 미리 보기 조회를 이 응답으로 대신한다 (한 번) */
  failNextPreview: Reply | null = null

  /** 합치기 미리 보기: 지금 상태로 코어 previewMerge (서버와 같다) */
  mergePreview(path: string): Reply {
    this.previews++
    if (this.failNextPreview !== null) {
      const reply = this.failNextPreview
      this.failNextPreview = null
      return reply
    }
    const params = new URLSearchParams(path.slice(path.indexOf('?') + 1))
    const from = params.get('from') ?? ''
    const into = params.get('into') ?? ''
    if (from === '' || into === '') return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: from === '' ? 'from' : 'into', message: '구매자를 골라 주세요.' }])
    return { body: { date: DATE, rehearsal: false, seq: this.seq, preview: previewMerge(this.state, from, into) } }
  }

  /** 서버 증분 조회와 같은 방식 (키로 비교, 값이 같은 항목은 빼고, 사라진 키) */
  changes(since: number): Changes {
    const a = lists(this.#states[since] as EngineState)
    const b = lists(this.state)
    const out: Record<string, unknown> = { date: DATE, rehearsal: false, since, seq: this.seq, attention: [], messages: [], messagesMore: false }
    const removed: Record<string, unknown[]> = {}
    for (const name of Object.keys(KEY)) {
      const key = KEY[name] as (item: Record<string, unknown>) => string
      const old = new Map((a[name] ?? []).map((item) => [key(item), JSON.stringify(item)]))
      const now = new Map((b[name] ?? []).map((item) => [key(item), item]))
      out[name] = [...now.entries()].filter(([k, item]) => old.get(k) !== JSON.stringify(item)).map(([, item]) => item)
      removed[name] =
        name === 'settlements'
          ? (a[name] ?? []).filter((item) => !now.has(key(item))).map((item) => ({ buyer: item.buyer, date: item.date }))
          : [...old.keys()].filter((k) => !now.has(k))
    }
    out.removed = removed
    return out as unknown as Changes
  }
}

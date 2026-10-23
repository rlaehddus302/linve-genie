// 가짜 LLM 서버 (A1, D-A1-08, AC-A1-11): Anthropic Messages API(POST /v1/messages) 모양으로 답한다. 127.0.0.1에서만 연다.
// 실제 어댑터(anthropic.ts)는 주소만 바꿔 이 서버를 부른다 — 같은 머리글(x-api-key·anthropic-version)·본문·응답 모양(content[].text·usage).
// - 키 머리글이 없거나 틀리면 401.
// - 기본 답: 항목마다 상품(읽은 번호, 없으면 글에 이름이 든 첫 상품)의 모든 옵션 항목에서 글에 이름·별칭(비교 글자)이 든 선택지를 고른다
//   (선택지 하나뿐인 항목은 그것). 다 고르면 수량 1로 제안, 못 고르면 그 항목을 뺀다. 글마다 정해 둔 답(answers)이 먼저다.
// - 시험 조작(JSON, 다른 프로세스는 HTTP로): GET /_fake/requests · POST /_fake/answers · POST /_fake/fail · POST /_fake/reset. 같은 프로세스의 시험은 메서드로.
// - 연습 모드(practice): 조작 경로가 없고, basePath로 연습 서버 안 경로(/_try/llm) 밑에 놓는다(listen 없이 handle만).
// 받은 요청(본문·머리글)은 메모리에만 둔다 — 시험이 보낸 글을 확인하는 용도다.
import type { Server } from 'node:http'
import { compareChars, type OptionCatalogEntry } from '@livejjim/core'
import { createNodeServer } from '../node-server.ts'
import type { AssistSetup } from './service.ts'

export const FAKE_LLM_HOST = '127.0.0.1'
/** 시험·연습용 가짜 키 */
export const FAKE_ASSIST_KEY = 'fake-assist-key'

/** 다음 호출에 넣을 실패·이상한 답 */
export interface FakeLlmFault {
  /** status: 이 HTTP 상태 · not_json: 200인데 본문이 JSON 아님 · bad_shape: 모델 글이 suggestions 모양이 아님 · raw: 모델 글을 text 그대로 ·
   *  huge: 64KB 넘는 본문 · slow: delayMs 뒤 답(시간 초과 시험) · disconnect: 본문 도중 연결 끊김 */
  readonly kind: 'status' | 'not_json' | 'bad_shape' | 'raw' | 'huge' | 'slow' | 'disconnect'
  readonly status?: number
  readonly delayMs?: number
  readonly text?: string
}

export interface FakeLlmRequest {
  readonly at: number
  readonly headers: Readonly<Record<string, string>>
  /** 받은 본문 (JSON으로 읽은 것, 읽지 못하면 null) */
  readonly body: unknown
  /** 받은 본문 글 그대로 */
  readonly raw: string
}

export interface FakeLlmOptions {
  readonly port?: number
  readonly basePath?: string
  readonly practice?: boolean
  readonly apiKey?: string
  /** 지금 시각 (기록용 — 기본 Date.now) */
  readonly now?: () => number
}

type Json = Record<string, unknown>
const isObj = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 상품 목록 글(Products:\n[...])에서 목록을 꺼낸다 */
function catalogOf(body: Json): OptionCatalogEntry[] {
  const system = Array.isArray(body.system) ? body.system : []
  for (const block of system) {
    const text = isObj(block) && typeof block.text === 'string' ? block.text : ''
    if (!text.startsWith('Products:\n')) continue
    try {
      const parsed = JSON.parse(text.slice('Products:\n'.length)) as unknown
      return Array.isArray(parsed) ? (parsed as OptionCatalogEntry[]) : []
    } catch {
      return []
    }
  }
  return []
}

interface AskedItem {
  readonly id: string
  readonly no?: number
  readonly text: string
}

function itemsOf(body: Json): AskedItem[] {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const first = messages[0]
  const content = isObj(first) && typeof first.content === 'string' ? first.content : ''
  try {
    const parsed = JSON.parse(content) as unknown
    const items = isObj(parsed) && Array.isArray(parsed.items) ? parsed.items : []
    return items.filter((item): item is AskedItem => isObj(item) && typeof item.id === 'string' && typeof item.text === 'string')
  } catch {
    return []
  }
}

/** 기본 답 한 줄 (못 고르면 null) */
export function defaultAnswer(item: AskedItem, catalog: readonly OptionCatalogEntry[]): Json | null {
  const text = compareChars(item.text)
  const product = item.no !== undefined ? catalog.find((entry) => entry.no === item.no) : catalog.find((entry) => [entry.name, ...(entry.aliases ?? [])].some((name) => compareChars(name) !== '' && text.includes(compareChars(name))))
  if (product === undefined) return null
  const options: Record<string, string> = {}
  for (const option of product.options ?? []) {
    if (option.choices.length === 1) {
      options[option.name] = (option.choices[0] as { label: string }).label
      continue
    }
    const found = option.choices.filter((choice) => [choice.label, ...(choice.aliases ?? [])].some((name) => compareChars(name) !== '' && text.includes(compareChars(name))))
    if (found.length !== 1) return null
    options[option.name] = (found[0] as { label: string }).label
  }
  return { id: item.id, no: product.no, ...((product.options ?? []).length > 0 ? { options } : {}), qty: 1 }
}

export class FakeLlm {
  readonly basePath: string
  readonly practice: boolean
  readonly apiKey: string
  readonly requests: FakeLlmRequest[] = []
  readonly #answers = new Map<string, Json | null>()
  readonly #faults: { fault: FakeLlmFault; times: number }[] = []
  readonly #now: () => number
  #http: Server | null = null
  #url = ''
  #messageId = 0

  constructor(options: FakeLlmOptions = {}) {
    this.basePath = options.basePath ?? ''
    this.practice = options.practice === true
    this.apiKey = options.apiKey ?? FAKE_ASSIST_KEY
    this.#now = options.now ?? Date.now
  }

  /** 127.0.0.1의 그 포트(기본 0 = 빈 포트)에서 연다 */
  static async start(options: FakeLlmOptions = {}): Promise<FakeLlm> {
    const fake = new FakeLlm(options)
    await fake.listen(options.port ?? 0)
    return fake
  }

  async listen(port: number): Promise<void> {
    const http = createNodeServer({ app: { fetch: (request: Request) => this.handle(request) } })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(port, FAKE_LLM_HOST, () => {
        http.off('error', reject)
        resolve()
      })
    })
    const address = http.address()
    if (typeof address !== 'object' || address === null) throw new Error('가짜 LLM 서버 주소를 알 수 없다')
    this.#http = http
    this.#url = `http://${FAKE_LLM_HOST}:${String(address.port)}`
  }

  /** 연 주소 (http://127.0.0.1:<포트>) */
  get url(): string {
    return this.#url
  }

  /** 받은 Messages 요청 수 (키가 틀린 요청 포함) */
  get calls(): number {
    return this.requests.length
  }

  /** 서버 설정 (createServer의 assist): 이 서버 주소·가짜 키. base = 서버가 부르는 주소의 앞(기본 연 주소) */
  setup(options: { readonly base?: string; readonly dailyLimit?: number; readonly globalLimit?: number; readonly timeoutMs?: number; readonly model?: string } = {}): AssistSetup {
    return {
      apiKey: this.apiKey,
      baseUrl: `${options.base ?? this.#url}${this.basePath}`,
      allowInsecure: true,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.dailyLimit === undefined ? {} : { sellerDailyLimit: options.dailyLimit }),
      ...(options.globalLimit === undefined ? {} : { globalDailyLimit: options.globalLimit }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }
  }

  // ── 시험 조작 ────────────────────────────────────────────────────────

  /** 가린 글(text)에 정해 둔 답: 제안 줄(id는 알아서 채움) 또는 null(그 항목을 뺀다) */
  answer(text: string, suggestion: { readonly no: number; readonly options?: Readonly<Record<string, unknown>>; readonly qty: unknown } | null): void {
    this.#answers.set(text, suggestion === null ? null : { ...suggestion })
  }

  /** 다음 times번의 호출에 실패·이상한 답 */
  failNext(fault: FakeLlmFault, times = 1): void {
    this.#faults.push({ fault, times })
  }

  /** 받은 요청·정해 둔 답·넣은 실패를 지운다 */
  reset(): void {
    this.requests.length = 0
    this.#answers.clear()
    this.#faults.length = 0
  }

  #takeFault(): FakeLlmFault | null {
    const first = this.#faults[0]
    if (first === undefined) return null
    first.times--
    if (first.times <= 0) this.#faults.shift()
    return first.fault
  }

  /** 모델 글 (정해 둔 답 → 기본 답) */
  #modelText(body: Json): string {
    const catalog = catalogOf(body)
    const suggestions: Json[] = []
    for (const item of itemsOf(body)) {
      if (this.#answers.has(item.text)) {
        const fixed = this.#answers.get(item.text)
        if (fixed !== null && fixed !== undefined) suggestions.push({ id: item.id, ...fixed })
        continue
      }
      const line = defaultAnswer(item, catalog)
      if (line !== null) suggestions.push(line)
    }
    return JSON.stringify({ suggestions })
  }

  #messageResponse(text: string, raw: string): Response {
    this.#messageId++
    return jsonResponse({
      id: `msg_fake_${String(this.#messageId)}`,
      type: 'message',
      role: 'assistant',
      model: 'fake-model',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: Math.ceil(text.length / 4), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
  }

  async #messages(request: Request): Promise<Response> {
    const raw = await request.text()
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })
    this.requests.push({ at: this.#now(), headers, body, raw })
    if (request.headers.get('x-api-key') !== this.apiKey) return jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)
    if (!isObj(body)) return jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message: 'body' } }, 400)
    const fault = this.#takeFault()
    if (fault !== null) {
      switch (fault.kind) {
        case 'status':
          return jsonResponse({ type: 'error', error: { type: 'api_error', message: 'fake' } }, fault.status ?? 500)
        case 'not_json':
          return new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        case 'bad_shape':
          return this.#messageResponse('반바지 M 1개인 것 같아요', raw)
        case 'raw':
          return this.#messageResponse(fault.text ?? '', raw)
        case 'huge':
          return this.#messageResponse(`{"suggestions":[${'{"id":"1","no":1,"qty":1},'.repeat(4000)}{"id":"1","no":1,"qty":1}]}`, raw)
        case 'slow':
          await new Promise((resolve) => setTimeout(resolve, fault.delayMs ?? 20_000))
          return this.#messageResponse(this.#modelText(body), raw)
        case 'disconnect': {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"id":"msg_cut","content":[{"type":"text","text":"{\\"sugg'))
              setTimeout(() => controller.error(new Error('cut')), 10)
            },
          })
          return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })
        }
      }
    }
    return this.#messageResponse(this.#modelText(body), raw)
  }

  /** 요청 하나 처리 (연습 모드는 연습 서버가 이 함수로 넘긴다) */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(this.basePath)) return jsonResponse({ error: 'not_found' }, 404)
    const path = url.pathname.slice(this.basePath.length)
    if (path === '/v1/messages' && request.method === 'POST') return this.#messages(request)
    if (this.practice) return jsonResponse({ error: 'not_found' }, 404)
    if (path === '/_fake/requests' && request.method === 'GET') {
      return jsonResponse({ calls: this.calls, requests: this.requests.map((item) => ({ at: item.at, headers: item.headers, body: item.body })) })
    }
    if (path === '/_fake/answers' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as unknown
      if (!isObj(body) || typeof body.text !== 'string') return jsonResponse({ error: 'input' }, 400)
      const suggestion = body.suggestion
      if (suggestion !== null && !isObj(suggestion)) return jsonResponse({ error: 'input' }, 400)
      this.answer(body.text, suggestion as never)
      return jsonResponse({ ok: true })
    }
    if (path === '/_fake/fail' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as unknown
      const kinds = ['status', 'not_json', 'bad_shape', 'raw', 'huge', 'slow', 'disconnect']
      if (!isObj(body) || typeof body.kind !== 'string' || !kinds.includes(body.kind)) return jsonResponse({ error: 'input' }, 400)
      const times = typeof body.times === 'number' && Number.isSafeInteger(body.times) && body.times > 0 ? body.times : 1
      this.failNext(
        {
          kind: body.kind as FakeLlmFault['kind'],
          ...(typeof body.status === 'number' ? { status: body.status } : {}),
          ...(typeof body.delayMs === 'number' ? { delayMs: body.delayMs } : {}),
          ...(typeof body.text === 'string' ? { text: body.text } : {}),
        },
        times,
      )
      return jsonResponse({ ok: true })
    }
    if (path === '/_fake/reset' && request.method === 'POST') {
      this.reset()
      return jsonResponse({ ok: true })
    }
    return jsonResponse({ error: 'not_found' }, 404)
  }

  async close(): Promise<void> {
    const http = this.#http
    if (http === null) return
    this.#http = null
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}

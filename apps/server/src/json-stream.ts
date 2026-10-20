// JSON 하나를 조각 글(스트림)로 읽는 끌어오기 읽개 (I2 백업·복구 — RA-I2-005).
// 판매자의 전체 기록 파일은 V8 문자열 한도(약 512MB)를 넘을 수 있어 글 하나로 만들지 않는다. 바깥 구조(객체·배열의 키·자리)는 이 읽개로 따라가고,
// 안쪽 값(이벤트 하나·설정 하나처럼 작은 값)은 그 값의 글만 잘라 JSON.parse로 읽는다 — 값 하나의 글 길이에는 상한을 둔다.
// 잘못된 JSON·상한을 넘는 값·끝나지 않은 글은 JsonStreamError(쉬운 문장)로 던진다. 조각 읽기 자체의 오류(gzip 손상 등)는 그대로 던진다.

export class JsonStreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonStreamError'
  }
}

const NOT_JSON = '백업 파일의 내용을 읽지 못했어요(JSON이 아니에요).'
const VALUE_TOO_LONG = '백업 파일의 값 하나가 너무 커요(형식이 올바르지 않아요).'

/** 값 하나의 글 길이 상한 (UTF-16 단위) — 이벤트·방송 목록·설정처럼 작은 값만 통째로 읽는다 */
export const JSON_VALUE_MAX_LENGTH = 64 * 1024 * 1024
/** 읽은 앞부분을 버리는 기준 */
const COMPACT_AT = 1024 * 1024

const isWhitespace = (code: number): boolean => code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09

export class JsonPullReader {
  readonly #source: AsyncIterator<string>
  #buf = ''
  #pos = 0
  #done = false

  constructor(source: AsyncIterable<string>) {
    this.#source = source[Symbol.asyncIterator]()
  }

  /** 조각 하나를 더 읽는다 (끝이면 false) */
  async #more(): Promise<boolean> {
    if (this.#done) return false
    const next = await this.#source.next()
    if (next.done === true) {
      this.#done = true
      return false
    }
    if (this.#pos >= COMPACT_AT) {
      this.#buf = this.#buf.slice(this.#pos)
      this.#pos = 0
    }
    this.#buf += next.value
    return true
  }

  /** 공백을 건너뛴 다음 글자 (끝이면 null) — 읽은 자리는 그 글자 앞 */
  async peek(): Promise<string | null> {
    for (;;) {
      while (this.#pos < this.#buf.length && isWhitespace(this.#buf.charCodeAt(this.#pos))) this.#pos++
      if (this.#pos < this.#buf.length) return this.#buf[this.#pos] as string
      if (!(await this.#more())) return null
    }
  }

  /** 다음 글자가 char이면 읽고, 아니면 오류 */
  async expect(char: string, message = NOT_JSON): Promise<void> {
    if ((await this.peek()) !== char) throw new JsonStreamError(message)
    this.#pos++
  }

  /** 다음 글자가 char이면 읽고 true */
  async take(char: string): Promise<boolean> {
    if ((await this.peek()) !== char) return false
    this.#pos++
    return true
  }

  /** 값 하나(문자열·수·참거짓·null·객체·배열)의 글을 잘라 읽는다. 읽는 동안 값의 시작 = this.#pos (#more가 앞부분을 버려도 자리가 맞다) */
  async readValueText(maxLength = JSON_VALUE_MAX_LENGTH): Promise<string> {
    const first = await this.peek()
    if (first === null) throw new JsonStreamError(NOT_JSON)
    // rel = 값의 시작에서 몇 글자까지 훑었는지
    let rel = 0
    if (first === '"' || first === '{' || first === '[') {
      let depth = 0
      let inString = false
      let escaped = false
      for (;;) {
        const buf = this.#buf
        const base = this.#pos
        for (let i = base + rel; i < buf.length; i++) {
          const code = buf.charCodeAt(i)
          if (inString) {
            if (escaped) escaped = false
            else if (code === 0x5c) escaped = true
            else if (code === 0x22) {
              inString = false
              if (depth === 0) return this.#cut(i + 1, maxLength)
            }
            continue
          }
          if (code === 0x22) inString = true
          else if (code === 0x7b || code === 0x5b) depth++
          else if (code === 0x7d || code === 0x5d) {
            depth--
            if (depth === 0) return this.#cut(i + 1, maxLength)
            if (depth < 0) throw new JsonStreamError(NOT_JSON)
          }
        }
        rel = buf.length - base
        if (rel > maxLength) throw new JsonStreamError(VALUE_TOO_LONG)
        if (!(await this.#more())) throw new JsonStreamError(NOT_JSON)
      }
    }
    // 수·true·false·null: 구분 글자(, } ] 공백)나 끝까지
    for (;;) {
      const buf = this.#buf
      const base = this.#pos
      for (let i = base + rel; i < buf.length; i++) {
        const code = buf.charCodeAt(i)
        if (code === 0x2c || code === 0x7d || code === 0x5d || isWhitespace(code)) return this.#cut(i, maxLength)
      }
      rel = buf.length - base
      if (rel > maxLength) throw new JsonStreamError(VALUE_TOO_LONG)
      if (!(await this.#more())) return this.#cut(this.#pos + rel, maxLength)
    }
  }

  /** 값의 시작(this.#pos)부터 end 앞까지를 잘라 읽은 자리로 (상한을 넘으면 오류) */
  #cut(end: number, maxLength: number): string {
    if (end - this.#pos > maxLength) throw new JsonStreamError(VALUE_TOO_LONG)
    const text = this.#buf.slice(this.#pos, end)
    this.#pos = end
    return text
  }

  /** 값 하나를 읽어 JSON.parse */
  async readValue(maxLength = JSON_VALUE_MAX_LENGTH): Promise<unknown> {
    const text = await this.readValueText(maxLength)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new JsonStreamError(NOT_JSON)
    }
  }

  /** 객체의 키 하나와 ':' (키가 문자열이 아니면 오류) */
  async readKey(): Promise<string> {
    if ((await this.peek()) !== '"') throw new JsonStreamError(NOT_JSON)
    const key = await this.readValue(4096)
    if (typeof key !== 'string') throw new JsonStreamError(NOT_JSON)
    await this.expect(':')
    return key
  }

  /** 문서 끝: 공백 말고 남은 글이 없어야 한다 */
  async end(): Promise<void> {
    if ((await this.peek()) !== null) throw new JsonStreamError(NOT_JSON)
  }

  /** 읽기를 멈춘다 (중간에 그만둘 때 조각 공급원을 닫는다) */
  async close(): Promise<void> {
    this.#done = true
    this.#buf = ''
    this.#pos = 0
    await this.#source.return?.()
  }
}

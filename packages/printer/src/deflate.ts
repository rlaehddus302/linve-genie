// zlib 압축 — 창 1KiB (windowBits 10, 첫 바이트 28) (LABEL_RULES L-12 2 "YXQ 래스터", D-N1-02·09).
// Marklife YXQ 프린터는 기본 창(32KiB, 첫 바이트 78)으로 압축한 래스터를 받고도 버린다. 브라우저의 CompressionStream과
// fflate는 창 크기를 정할 수 없어 여기서 직접 만든다(새 의존성 없음 — RFC 1950·1951). 브라우저와 Node가 이 코드 하나를 쓴다.
// 결정적이다: 같은 입력이면 같은 바이트(시각·난수·실행 환경을 읽지 않는다).
// 방식: LZ77(해시 사슬) + 고정 허프만 블록 하나. 되짚기 거리는 zlib deflate(windowBits 10)가 내는 범위(창 − 262 = 762)를 넘지 않는다 —
// 1KiB 창으로 푸는 쪽(프린터)이 어떻게 만들었든 창 안의 바이트만 가리킨다.

/** 창 크기 2^10 = 1024바이트 */
export const ZLIB_WINDOW_BITS = 10
const WINDOW_SIZE = 1 << ZLIB_WINDOW_BITS
/** zlib deflate의 MIN_LOOKAHEAD (MAX_MATCH + MIN_MATCH + 1) — 이만큼 빼고 되짚는다 */
const MIN_LOOKAHEAD = 258 + 3 + 1
/** 가장 먼 되짚기 거리 = 1024 − 262 = 762 */
export const MAX_DISTANCE = WINDOW_SIZE - MIN_LOOKAHEAD
const MIN_MATCH = 3
const MAX_MATCH = 258
/** 해시 사슬을 몇 번까지 따라가는지 (속도 상한 — 결과는 결정적이다) */
const MAX_CHAIN = 64
const HASH_BITS = 12
const HASH_SIZE = 1 << HASH_BITS

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]

/** 바이트를 LSB부터 채우는 비트 쓰기 (deflate 비트 순서) */
class BitWriter {
  private bytes: Uint8Array
  private length = 0
  private bitBuf = 0
  private bitCount = 0

  constructor(capacity: number) {
    this.bytes = new Uint8Array(Math.max(16, capacity))
  }

  private push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2)
      grown.set(this.bytes)
      this.bytes = grown
    }
    this.bytes[this.length++] = byte
  }

  /** value의 아래 count비트를 LSB부터 */
  bits(value: number, count: number): void {
    this.bitBuf |= value << this.bitCount
    this.bitCount += count
    while (this.bitCount >= 8) {
      this.push(this.bitBuf & 0xff)
      this.bitBuf >>>= 8
      this.bitCount -= 8
    }
  }

  /** 허프만 부호는 MSB부터 쓴다 — 뒤집어 LSB부터 */
  code(code: number, count: number): void {
    let reversed = 0
    for (let i = 0; i < count; i++) reversed |= ((code >>> i) & 1) << (count - 1 - i)
    this.bits(reversed, count)
  }

  byte(value: number): void {
    this.flushBits()
    this.push(value & 0xff)
  }

  flushBits(): void {
    if (this.bitCount > 0) {
      this.push(this.bitBuf & 0xff)
      this.bitBuf = 0
      this.bitCount = 0
    }
  }

  result(): Uint8Array {
    this.flushBits()
    return this.bytes.slice(0, this.length)
  }
}

/** 고정 허프만 문자·길이 부호 (RFC 1951 3.2.6) */
function writeLiteral(w: BitWriter, symbol: number): void {
  if (symbol < 144) w.code(0x30 + symbol, 8)
  else if (symbol < 256) w.code(0x190 + (symbol - 144), 9)
  else if (symbol < 280) w.code(symbol - 256, 7)
  else w.code(0xc0 + (symbol - 280), 8)
}

function writeMatch(w: BitWriter, length: number, distance: number): void {
  let li = LENGTH_BASE.length - 1
  while ((LENGTH_BASE[li] as number) > length) li--
  writeLiteral(w, 257 + li)
  const lExtra = LENGTH_EXTRA[li] as number
  if (lExtra > 0) w.bits(length - (LENGTH_BASE[li] as number), lExtra)
  let di = DIST_BASE.length - 1
  while ((DIST_BASE[di] as number) > distance) di--
  w.code(di, 5)
  const dExtra = DIST_EXTRA[di] as number
  if (dExtra > 0) w.bits(distance - (DIST_BASE[di] as number), dExtra)
}

export function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  // 5552바이트마다 나머지를 구해도 넘치지 않는다 (zlib NMAX)
  for (let start = 0; start < data.length; start += 5552) {
    const end = Math.min(data.length, start + 5552)
    for (let i = start; i < end; i++) {
      a += data[i] as number
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

const hash3 = (data: Uint8Array, i: number): number => (((data[i] as number) << 8) ^ ((data[i + 1] as number) << 4) ^ (data[i + 2] as number)) & (HASH_SIZE - 1)

/**
 * zlib 스트림 (RFC 1950): CMF 28(deflate, 창 1KiB) · FLG(사전 없음, 31의 배수) · 고정 허프만 deflate 블록 하나 · Adler-32(BE).
 * Node `zlib.inflateSync(out, { windowBits: 10 })`로 풀면 data와 같다.
 */
export function zlibWindow1K(data: Uint8Array): Uint8Array {
  const w = new BitWriter(64 + (data.length >> 1))
  const cmf = ((ZLIB_WINDOW_BITS - 8) << 4) | 8 // 0x28
  let flg = 2 << 6 // FLEVEL 2(보통), FDICT 0
  flg += 31 - ((cmf * 256 + flg) % 31)
  w.byte(cmf)
  w.byte(flg)
  // BFINAL 1, BTYPE 01(고정 허프만)
  w.bits(1, 1)
  w.bits(1, 2)
  const head = new Int32Array(HASH_SIZE).fill(-1)
  const prev = new Int32Array(Math.max(1, data.length)).fill(-1)
  const insert = (i: number): void => {
    if (i + MIN_MATCH > data.length) return
    const h = hash3(data, i)
    prev[i] = head[h] as number
    head[h] = i
  }
  let i = 0
  while (i < data.length) {
    let bestLength = 0
    let bestDistance = 0
    if (i + MIN_MATCH <= data.length) {
      const limit = Math.min(MAX_MATCH, data.length - i)
      let candidate = head[hash3(data, i)] as number
      let chain = MAX_CHAIN
      while (candidate >= 0 && i - candidate <= MAX_DISTANCE && chain-- > 0) {
        let length = 0
        while (length < limit && data[candidate + length] === data[i + length]) length++
        if (length > bestLength) {
          bestLength = length
          bestDistance = i - candidate
          if (length === limit) break
        }
        candidate = prev[candidate] as number
      }
    }
    if (bestLength >= MIN_MATCH) {
      writeMatch(w, bestLength, bestDistance)
      for (let k = 0; k < bestLength; k++) insert(i + k)
      i += bestLength
    } else {
      writeLiteral(w, data[i] as number)
      insert(i)
      i++
    }
  }
  writeLiteral(w, 256)
  w.flushBits()
  const sum = adler32(data)
  w.byte(sum >>> 24)
  w.byte(sum >>> 16)
  w.byte(sum >>> 8)
  w.byte(sum)
  return w.result()
}

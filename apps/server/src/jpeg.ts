// 확인서 JPG (N4b D-N4b-03): 확인서 그림(packages/documents rasterizePage — 공유 PNG와 같은 회색조 화소)을 기본(baseline) JPEG로.
// - 형식: SOI · APP0(JFIF, 썸네일 없음) · DQT 2개 · SOF0(8비트, 구성 요소 3개 = Y·Cb·Cr, 표본 1×1 — 4:4:4) · DHT 4개(표준 허프만 표) · SOS · 데이터 · EOI.
//   점진(SOF2)·EXIF(APP1)·주석(COM)·그 밖의 메타데이터는 쓰지 않는다. 같은 화소면 같은 바이트다(시각·무작위 값 없음).
// - 품질 90 (IJG 방식으로 표준 양자화 표를 줄인다). 회색조 화소라 Y = 화소, Cb = Cr = 128(색 없음)이다.
// - 외부 의존성 없이 여기서 만든다 (서버 영역, D-N4b-03 "직접 구현 또는 허용 라이선스 라이브러리").

/** 지그재그 순서 → 블록 안 자리 (행 우선) */
const ZIGZAG = Uint8Array.of(
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31,
  39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
)

/** 표준 밝기 양자화 표 (ITU T.81 부록 K, 행 우선) */
const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64,
  78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]
/** 표준 색차 양자화 표 (행 우선) */
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]

// 표준 허프만 표 (ITU T.81 부록 K.3): 길이마다 부호 수(1~16)와 값
const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_LUMA_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33,
  0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const AC_CHROMA_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62,
  0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54,
  0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
  0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
]

/** JPEG 품질 (D-N4b-03) */
export const JPEG_QUALITY = 90

/** IJG 방식 품질 → 양자화 표 (행 우선, 1~255) */
function scaledTable(base: readonly number[], quality: number): Uint8Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2
  const out = new Uint8Array(64)
  for (let i = 0; i < 64; i++) out[i] = Math.min(255, Math.max(1, Math.floor(((base[i] as number) * scale + 50) / 100)))
  return out
}

interface Huffman {
  /** 값 → 부호 */
  readonly code: Uint16Array
  /** 값 → 부호 길이 (0 = 없음) */
  readonly length: Uint8Array
}

/** 길이별 부호 수와 값 → 정규 허프만 부호 */
function huffman(bits: readonly number[], values: readonly number[]): Huffman {
  const total = bits.reduce((sum, n) => sum + n, 0)
  if (total !== values.length) throw new Error('허프만 표의 길이가 맞지 않다')
  const code = new Uint16Array(256)
  const length = new Uint8Array(256)
  let next = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < (bits[len - 1] as number); i++) {
      const value = values[k++] as number
      code[value] = next
      length[value] = len
      next++
    }
    next <<= 1
  }
  return { code, length }
}

const DC_LUMA = huffman(DC_LUMA_BITS, DC_VALUES)
const DC_CHROMA = huffman(DC_CHROMA_BITS, DC_VALUES)
const AC_LUMA = huffman(AC_LUMA_BITS, AC_LUMA_VALUES)
const AC_CHROMA = huffman(AC_CHROMA_BITS, AC_CHROMA_VALUES)

/** 1차원 DCT 계수 행렬 C[u][x] = c(u)/2 · cos((2x+1)uπ/16) — 두 번 곱하면 8×8 DCT */
const DCT = (() => {
  const out = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    const c = u === 0 ? Math.SQRT1_2 : 1
    for (let x = 0; x < 8; x++) out[u * 8 + x] = (c / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
  return out
})()

/** 늘어나는 바이트 통 + 비트 쓰기 (엔트로피 부호는 0xFF 뒤에 0x00을 넣는다) */
class Writer {
  #bytes = new Uint8Array(1 << 16)
  #length = 0
  #bitBuffer = 0
  #bitCount = 0

  #ensure(extra: number): void {
    if (this.#length + extra <= this.#bytes.length) return
    let size = this.#bytes.length * 2
    while (size < this.#length + extra) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.#bytes.subarray(0, this.#length))
    this.#bytes = grown
  }

  byte(value: number): void {
    this.#ensure(1)
    this.#bytes[this.#length++] = value & 0xff
  }

  word(value: number): void {
    this.byte(value >> 8)
    this.byte(value)
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i] as number)
  }

  /** 부호 비트 쓰기 (길이 1~16) */
  bits(code: number, length: number): void {
    this.#bitBuffer = (this.#bitBuffer << length) | (code & ((1 << length) - 1))
    this.#bitCount += length
    while (this.#bitCount >= 8) {
      const out = (this.#bitBuffer >> (this.#bitCount - 8)) & 0xff
      this.byte(out)
      if (out === 0xff) this.byte(0)
      this.#bitCount -= 8
    }
    this.#bitBuffer &= (1 << this.#bitCount) - 1
  }

  /** 남은 비트를 1로 채워 바이트를 맞춘다 */
  flushBits(): void {
    if (this.#bitCount > 0) this.bits((1 << (8 - this.#bitCount)) - 1, 8 - this.#bitCount)
  }

  result(): Uint8Array {
    return this.#bytes.slice(0, this.#length)
  }
}

/** 값의 비트 수(범주)와 덧붙일 비트 */
function category(value: number): number {
  let magnitude = value < 0 ? -value : value
  let n = 0
  while (magnitude > 0) {
    n++
    magnitude >>= 1
  }
  return n
}

function writeValue(out: Writer, value: number, size: number): void {
  if (size === 0) return
  out.bits(value < 0 ? value + (1 << size) - 1 : value, size)
}

/**
 * 회색조 화소(0 = 검정, 255 = 흰색, 행 우선) → 기본 JPEG (YCbCr 3채널, 4:4:4, 품질 90).
 * 폭·높이는 1~65535. 가장자리 블록은 끝 화소를 늘려 채운다
 */
export function encodeGrayJpeg(width: number, height: number, pixels: Uint8Array, quality: number = JPEG_QUALITY): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535) throw new RangeError('그림 크기가 올바르지 않다')
  if (pixels.length !== width * height) throw new RangeError('화소 수가 크기와 맞지 않다')
  const lumaQ = scaledTable(LUMA_QUANT, quality)
  const chromaQ = scaledTable(CHROMA_QUANT, quality)
  const out = new Writer()
  // SOI
  out.word(0xffd8)
  // APP0 JFIF 1.01, 화소 비 1:1, 썸네일 없음
  out.word(0xffe0)
  out.word(16)
  out.bytes([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0])
  out.word(1)
  out.word(1)
  out.bytes([0, 0])
  // DQT: 표 0(밝기)·1(색차), 지그재그 순서
  out.word(0xffdb)
  out.word(2 + 2 * 65)
  for (const [id, table] of [
    [0, lumaQ],
    [1, chromaQ],
  ] as const) {
    out.byte(id)
    for (let k = 0; k < 64; k++) out.byte(table[ZIGZAG[k] as number] as number)
  }
  // SOF0: 8비트, 높이·폭, 구성 요소 3개 (1 = Y·표 0, 2 = Cb·표 1, 3 = Cr·표 1, 모두 1×1)
  out.word(0xffc0)
  out.word(8 + 3 * 3)
  out.byte(8)
  out.word(height)
  out.word(width)
  out.byte(3)
  out.bytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
  // DHT: DC 0·AC 0(밝기), DC 1·AC 1(색차)
  const tables: [number, readonly number[], readonly number[]][] = [
    [0x00, DC_LUMA_BITS, DC_VALUES],
    [0x10, AC_LUMA_BITS, AC_LUMA_VALUES],
    [0x01, DC_CHROMA_BITS, DC_VALUES],
    [0x11, AC_CHROMA_BITS, AC_CHROMA_VALUES],
  ]
  out.word(0xffc4)
  out.word(2 + tables.reduce((sum, [, bits, values]) => sum + 1 + bits.length + values.length, 0))
  for (const [id, bits, values] of tables) {
    out.byte(id)
    out.bytes(bits)
    out.bytes(values)
  }
  // SOS: 세 구성 요소, 표 (0,0)·(1,1)·(1,1), 스펙트럼 0~63, 근사 0
  out.word(0xffda)
  out.word(6 + 2 * 3)
  out.byte(3)
  out.bytes([1, 0x00, 2, 0x11, 3, 0x11])
  out.bytes([0, 63, 0])

  // 색 없는 블록(Cb·Cr = 128 → 0): DC 차이 0(범주 0)과 EOB — 이전 DC도 늘 0이다
  const chromaDcCode = DC_CHROMA.code[0] as number
  const chromaDcLength = DC_CHROMA.length[0] as number
  const chromaEobCode = AC_CHROMA.code[0] as number
  const chromaEobLength = AC_CHROMA.length[0] as number
  const lumaEobCode = AC_LUMA.code[0] as number
  const lumaEobLength = AC_LUMA.length[0] as number
  const lumaZrlCode = AC_LUMA.code[0xf0] as number
  const lumaZrlLength = AC_LUMA.length[0xf0] as number

  const block = new Float64Array(64)
  const temp = new Float64Array(64)
  const quantized = new Int32Array(64)
  let previousDc = 0
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      // 블록 화소 (가장자리는 끝 화소를 늘린다) − 128
      for (let y = 0; y < 8; y++) {
        const row = Math.min(by + y, height - 1) * width
        for (let x = 0; x < 8; x++) block[y * 8 + x] = (pixels[row + Math.min(bx + x, width - 1)] as number) - 128
      }
      // 2차원 DCT: temp = C · block, 결과 = temp · Cᵀ
      for (let u = 0; u < 8; u++) {
        for (let x = 0; x < 8; x++) {
          let sum = 0
          for (let y = 0; y < 8; y++) sum += (DCT[u * 8 + y] as number) * (block[y * 8 + x] as number)
          temp[u * 8 + x] = sum
        }
      }
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          let sum = 0
          for (let x = 0; x < 8; x++) sum += (temp[u * 8 + x] as number) * (DCT[v * 8 + x] as number)
          // 양자화 (가까운 정수, .5는 0에서 먼 쪽)
          const q = sum / (lumaQ[u * 8 + v] as number)
          quantized[u * 8 + v] = q < 0 ? -Math.round(-q) : Math.round(q)
        }
      }
      // Y: DC 차이
      const dc = quantized[0] as number
      const diff = dc - previousDc
      previousDc = dc
      const dcSize = category(diff)
      out.bits(DC_LUMA.code[dcSize] as number, DC_LUMA.length[dcSize] as number)
      writeValue(out, diff, dcSize)
      // Y: AC (지그재그, 0 이어짐 + 범주)
      let run = 0
      for (let k = 1; k < 64; k++) {
        const value = quantized[ZIGZAG[k] as number] as number
        if (value === 0) {
          run++
          continue
        }
        while (run > 15) {
          out.bits(lumaZrlCode, lumaZrlLength)
          run -= 16
        }
        const size = category(value)
        const symbol = (run << 4) | size
        out.bits(AC_LUMA.code[symbol] as number, AC_LUMA.length[symbol] as number)
        writeValue(out, value, size)
        run = 0
      }
      if (run > 0) out.bits(lumaEobCode, lumaEobLength)
      // Cb·Cr: 색 없음
      for (let c = 0; c < 2; c++) {
        out.bits(chromaDcCode, chromaDcLength)
        out.bits(chromaEobCode, chromaEobLength)
      }
    }
  }
  out.flushBits()
  // EOI
  out.word(0xffd9)
  return out.result()
}

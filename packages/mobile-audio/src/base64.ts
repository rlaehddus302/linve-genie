// base64 풀기·묶기 (순수 함수, 전역 atob·btoa에 기대지 않는다 — Node·RN·브라우저 어디서나 같은 결과).
// 네이티브가 틀을 base64 글로 넘길 때 쓴다. 틀린 글자·길이면 예외 대신 null.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  // URL-safe 변형도 받는다
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

/** base64 글 → 바이트. 공백·줄바꿈은 건너뛴다. 모양이 틀리면 null */
export function decodeBase64(text: string): Uint8Array | null {
  const chars: number[] = []
  let padding = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) continue
    if (code === 0x3d) {
      padding++
      continue
    }
    if (padding > 0 || code >= 128) return null
    const value = LOOKUP[code] ?? -1
    if (value < 0) return null
    chars.push(value)
  }
  if (padding > 2) return null
  const remainder = chars.length % 4
  if (remainder === 1) return null
  const out = new Uint8Array(Math.floor((chars.length * 3) / 4))
  let o = 0
  let i = 0
  for (; i + 4 <= chars.length; i += 4) {
    const n = ((chars[i] ?? 0) << 18) | ((chars[i + 1] ?? 0) << 12) | ((chars[i + 2] ?? 0) << 6) | (chars[i + 3] ?? 0)
    out[o++] = (n >> 16) & 0xff
    out[o++] = (n >> 8) & 0xff
    out[o++] = n & 0xff
  }
  if (remainder === 2) {
    const n = ((chars[i] ?? 0) << 18) | ((chars[i + 1] ?? 0) << 12)
    out[o] = (n >> 16) & 0xff
  } else if (remainder === 3) {
    const n = ((chars[i] ?? 0) << 18) | ((chars[i + 1] ?? 0) << 12) | ((chars[i + 2] ?? 0) << 6)
    out[o] = (n >> 16) & 0xff
    out[o + 1] = (n >> 8) & 0xff
  }
  return out
}

/** 바이트 → base64 글 (채움 '=' 포함) */
export function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }
  return out
}

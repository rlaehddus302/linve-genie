// 전원 이미지 묶음 ZIP (N4b D-N4b-03): 압축하지 않고(저장 방식 0 — JPG는 더 줄지 않는다) 파일을 차례로 담는다. 폴더 없음.
// - 파일 이름은 UTF-8로 적고 일반 목적 비트 11(UTF-8)을 켠다 — 윈도·맥 압축 풀기에서 한글 이름이 그대로 보인다.
// - 수정 시각은 부르는 쪽이 넘긴 시각(KST 달력)으로 적는다. 같은 입력이면 같은 바이트다.
// - ZIP64는 쓰지 않는다: 파일 수 65535개·전체 4GB 아래만 받는다(확인서 묶음은 그보다 훨씬 작다).
import { crc32 } from 'node:zlib'

export interface ZipEntry {
  /** 묶음 안 파일 이름 (폴더 없이, `/`·`\` 없음) */
  readonly name: string
  readonly bytes: Uint8Array
}

/** 일반 목적 비트 11: 파일 이름이 UTF-8 */
export const ZIP_UTF8_FLAG = 0x0800
const VERSION = 20
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** UTC 밀리초 → MS-DOS 시각·날짜 (KST 달력, 2초 단위) */
export function dosDateTime(ms: number): { time: number; date: number } {
  const kst = new Date(ms + KST_OFFSET_MS)
  const year = Math.min(2107, Math.max(1980, kst.getUTCFullYear()))
  const time = (kst.getUTCHours() << 11) | (kst.getUTCMinutes() << 5) | Math.floor(kst.getUTCSeconds() / 2)
  const date = ((year - 1980) << 9) | ((kst.getUTCMonth() + 1) << 5) | kst.getUTCDate()
  return { time, date }
}

/** 파일 여러 개 → ZIP 바이트 (저장 방식, UTF-8 이름) */
export function storedZip(entries: readonly ZipEntry[], modifiedAt: number): Uint8Array {
  if (entries.length > 0xffff) throw new RangeError('묶을 파일이 너무 많다')
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(modifiedAt)
  const names = entries.map((entry) => {
    if (entry.name === '' || /[/\\\0]/.test(entry.name)) throw new RangeError('묶음 안 파일 이름이 올바르지 않다')
    return encoder.encode(entry.name)
  })
  const locals: { offset: number; crc: number; size: number }[] = []
  let total = 0
  for (const [index, entry] of entries.entries()) total += 30 + (names[index] as Uint8Array).length + entry.bytes.length
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0)
  if (total + centralSize + 22 > 0xffffffff) throw new RangeError('묶음이 너무 크다')
  const out = new Uint8Array(total + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const [index, entry] of entries.entries()) {
    const name = names[index] as Uint8Array
    const crc = crc32(entry.bytes) >>> 0
    locals.push({ offset, crc, size: entry.bytes.length })
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, VERSION, true)
    view.setUint16(offset + 6, ZIP_UTF8_FLAG, true)
    view.setUint16(offset + 8, 0, true) // 저장
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, date, true)
    view.setUint32(offset + 14, crc, true)
    view.setUint32(offset + 18, entry.bytes.length, true)
    view.setUint32(offset + 22, entry.bytes.length, true)
    view.setUint16(offset + 26, name.length, true)
    view.setUint16(offset + 28, 0, true)
    out.set(name, offset + 30)
    out.set(entry.bytes, offset + 30 + name.length)
    offset += 30 + name.length + entry.bytes.length
  }
  const centralStart = offset
  for (const [index, local] of locals.entries()) {
    const name = names[index] as Uint8Array
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, VERSION, true) // 만든 곳: MS-DOS, 2.0
    view.setUint16(offset + 6, VERSION, true)
    view.setUint16(offset + 8, ZIP_UTF8_FLAG, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, time, true)
    view.setUint16(offset + 14, date, true)
    view.setUint32(offset + 16, local.crc, true)
    view.setUint32(offset + 20, local.size, true)
    view.setUint32(offset + 24, local.size, true)
    view.setUint16(offset + 28, name.length, true)
    // 덧붙임·설명 길이 0, 디스크 0, 내부·외부 속성 0
    view.setUint32(offset + 42, local.offset, true)
    out.set(name, offset + 46)
    offset += 46 + name.length
  }
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, entries.length, true)
  view.setUint16(offset + 10, entries.length, true)
  view.setUint32(offset + 12, offset - centralStart, true)
  view.setUint32(offset + 16, centralStart, true)
  return out
}

/**
 * 묶음 안 이름 겹침 풀기 (D-N4b-03): 순서대로 보며 이미 쓴 이름(대소문자 무시 — 윈도에서 겹친다)이면 확장자 앞에 `-2`·`-3`…을 붙인다.
 * 붙인 이름이 또 겹치면 다음 숫자
 */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${String(n)}${ext}`
    used.add(candidate.toLowerCase())
    out.push(candidate)
  }
  return out
}

// 작업 바이트 (LABEL_RULES L-12 2, 프린터 골든 job G-PRT-N1-01~34·G-PRT-PRN2-01·02, D-N1-02·09·D-PRN2-02) — 프로필 + 1비트 그림(L-1) + 선택 농도 → 바이트 또는 오류 코드.
// 끝 알림 판정(L-12 5, 골든 end G-PRT-PRN2-51~64, D-PRN2-03)도 여기 둔다 — 방식(데이터)으로 정한다.
// 순수 함수다: 받은 그림을 바꾸지 않고, 시각·난수·실행 환경(시간대·언어)을 읽지 않는다. 브라우저와 Node가 같은 코드를 쓴다
// (압축도 deflate.ts 하나 — node:zlib를 쓰지 않는다). 모두 간격 있는 라벨이다(연속 용지 없음).
// 바이트 순서의 출처: MIT 참고 구현 thermal-label/marklife의 공개 문서(프로토콜 사실만 옮겼다 — dev-notes).
import { bytesPerRow, isLabelBitmap, type LabelBitmap } from '@livejjim/label'
import { isNiimbotProtocol, type LabelProtocol, type ModelProfile, type PrintOptions } from './adapter.ts'
import { zlibWindow1K } from './deflate.ts'

/** 작업 바이트를 만들지 않는 경우의 코드 (L-7 표의 코드) */
export type JobErrorCode = 'IMAGE_TOO_WIDE' | 'INVALID_DENSITY' | 'PRINT_FAILED'

export type JobResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly code: JobErrorCode }

/**
 * 방식마다 농도 1·2·3(흐리게·보통·진하게)에 보내는 값 (L-12 2). null = 농도 명령을 보내지 않는다(L11·Luck Jingle — 프린터에 저장된 농도).
 * 방식(데이터)으로 정한다 — 모델 이름으로 가르지 않는다.
 */
export const DENSITY_BYTES: Readonly<Record<LabelProtocol, readonly [number, number, number] | null>> = {
  MARKLIFE_YXQ2: [0x03, 0x0a, 0x0e],
  MARKLIFE_YXQ3: [0x03, 0x0a, 0x0e],
  MARKLIFE_YXQ8: [0x03, 0x08, 0x0e],
  MARKLIFE_L11: null,
  LUCKJINGLE: null,
}

/** 끝 알림 `AA` (모든 방식) */
export const END_ACK = 0xaa
/**
 * 방식마다 `AA` 말고도 끝으로 세는 알림 값 (L-12 5, D-PRN2-03). Luck Jingle과 YXQ 8(X2)은 정확히 `4F 4B`(ASCII `OK`, 두 바이트).
 * X2 실물은 마지막 조각을 쓴 뒤 ff01로 `OK` 한 번만 보냈다(흐름 ff03은 `01 01`, D-910). 다른 Marklife(YXQ 2·3·L11)는 확인 전이라 `OK`를 끝으로 세지 않는다
 */
export const EXTRA_END_NOTICES: Readonly<Record<LabelProtocol, readonly (readonly number[])[]>> = {
  MARKLIFE_YXQ2: [],
  MARKLIFE_YXQ3: [],
  MARKLIFE_YXQ8: [[0x4f, 0x4b]],
  MARKLIFE_L11: [],
  LUCKJINGLE: [[0x4f, 0x4b]],
}

/**
 * 알림 값 하나가 끝 알림인지 (L-12 5, 골든 end). 값 전체가 정확히 `AA` 한 바이트이거나, 그 방식의 다른 끝 값과 바이트까지 같을 때만.
 * 소문자 `ok`·줄바꿈 붙음·`AA AA`·한 바이트 `4F`·빈 값은 끝이 아니다(20초 뒤 TIMEOUT이 안전한 쪽 — 안 찍힌 라벨을 찍힌 것으로 기록하지 않게).
 * 이번 출력의 첫 조각 뒤에 받았는지·모든 조각을 썼는지는 어댑터가 본다
 */
export function isEndNotice(protocol: LabelProtocol, value: ArrayLike<number>): boolean {
  if (value.length === 1 && value[0] === END_ACK) return true
  const extras = EXTRA_END_NOTICES[protocol] ?? []
  return extras.some((want) => want.length === value.length && want.every((b, i) => value[i] === b))
}

/** 시계 방향 90도: 보낼 그림 (x, y) = 받은 그림 (y, H−1−x), 보낼 그림은 폭 H × 높이 W. 받은 그림의 왼쪽 끝이 먼저 나온다 */
export function rotateClockwise(image: LabelBitmap): LabelBitmap {
  const W = image.width
  const H = image.height
  const srcRow = bytesPerRow(W)
  const dstRow = bytesPerRow(H)
  const data = new Uint8Array(dstRow * W)
  for (let ry = 0; ry < W; ry++) {
    const srcByte = ry >> 3
    const srcMask = 0x80 >> (ry & 7)
    for (let rx = 0; rx < H; rx++) {
      // 받은 그림의 점 (x = ry, y = H − 1 − rx)
      if (((image.data[(H - 1 - rx) * srcRow + srcByte] as number) & srcMask) !== 0) {
        const at = ry * dstRow + (rx >> 3)
        data[at] = (data[at] as number) | (0x80 >> (rx & 7))
      }
    }
  }
  return { width: H, height: W, data }
}

/** 줄 바이트를 새로 복사하고 폭 밖의 남는 비트를 0으로 (L-12 2 — 라벨 밖에 엉뚱한 점이 찍히지 않게) */
function cleanRows(image: LabelBitmap): Uint8Array {
  const row = bytesPerRow(image.width)
  const out = image.data.slice()
  const spare = row * 8 - image.width
  if (spare > 0) {
    const mask = (0xff << spare) & 0xff
    for (let y = 0; y < image.height; y++) {
      const at = y * row + row - 1
      out[at] = (out[at] as number) & mask
    }
  }
  return out
}

const be16 = (v: number): number[] => [(v >>> 8) & 0xff, v & 0xff]
const le16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff]
const be32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]

function concat(parts: readonly (readonly number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** YXQ 래스터 = 1F 10 + 한 줄 바이트 수(BE16) + 높이(BE16) + 압축 길이(BE32) + 창 1KiB zlib */
function yxqRaster(widthBytes: number, height: number, rows: Uint8Array): Uint8Array {
  const packed = zlibWindow1K(rows)
  return concat([[0x1f, 0x10, ...be16(widthBytes), ...be16(height), ...be32(packed.length)], packed])
}

/** L11 래스터 = 1D 76 30 00 + 한 줄 바이트 수(LE16) + 높이(LE16) + 줄 그대로 (Luck Jingle 래스터도 같은 모양) */
function l11Raster(widthBytes: number, height: number, rows: Uint8Array): Uint8Array {
  return concat([[0x1d, 0x76, 0x30, 0x00, ...le16(widthBytes), ...le16(height)], rows])
}

/**
 * 작업 바이트 (L-12 2). 거절(바이트 없음)은 이 순서로 본다: 그림이 L-1 형식이 아니면 PRINT_FAILED, 보낼 그림(돌린 뒤)의 폭이 헤드보다
 * 넓으면 IMAGE_TOO_WIDE(농도와 상관없이 언제나 — AC-N1-70), 농도가 방식의 범위(1~3 정수) 밖이면 INVALID_DENSITY(농도를 받지 않는
 * 방식은 넘겨도 쓰지 않는다). 좁은 그림은 채우지 않고 그 폭 그대로 보낸다. NIIMBOT 바이트는 niimbluelib이 만든다(RangeError).
 */
export function buildPrintJob(profile: ModelProfile, image: LabelBitmap, options: PrintOptions = {}): JobResult {
  const protocol = profile.protocol
  if (isNiimbotProtocol(protocol)) throw new RangeError('NIIMBOT 작업은 niimbluelib이 만든다')
  if (!isLabelBitmap(image)) return { ok: false, code: 'PRINT_FAILED' }
  // 돌린 폭 = 받은 그림의 높이 (돌리기 전에 거른다 — 넓은 그림을 돌리느라 일하지 않게)
  const sendWidth = profile.rotate === 'CW90' ? image.height : image.width
  if (sendWidth > profile.headDots) return { ok: false, code: 'IMAGE_TOO_WIDE' }
  const densityBytes = DENSITY_BYTES[protocol]
  let densityByte = 0
  if (densityBytes !== null) {
    const range = profile.density
    const density = options.density ?? range?.default
    if (range === null || density === undefined || !Number.isInteger(density) || density < range.min || density > range.max || density < 1 || density > 3) {
      return { ok: false, code: 'INVALID_DENSITY' }
    }
    densityByte = densityBytes[density - 1] as number
  }
  const send = profile.rotate === 'CW90' ? rotateClockwise(image) : image
  const widthBytes = bytesPerRow(send.width)
  // 돌린 그림은 이미 새 바이트다. 돌리지 않으면 복사한 뒤 남는 비트를 지운다(받은 그림은 바꾸지 않는다)
  const rows = cleanRows(send)
  const start = [0x10, 0xff, 0xf1, 0x02]
  const end = [0x10, 0xff, 0xf1, 0x45]
  const nextLabel = [0x1d, 0x0c]
  switch (protocol) {
    case 'MARKLIFE_YXQ2':
      return { ok: true, bytes: concat([[0x1f, 0x70, 0x01, densityByte], start, yxqRaster(widthBytes, send.height, rows), nextLabel, end]) }
    case 'MARKLIFE_YXQ3':
    case 'MARKLIFE_YXQ8':
      return {
        ok: true,
        bytes: concat([
          [0x1f, 0x80, 0x02, 0x20],
          [0x1f, 0x70, 0x02, densityByte],
          [0, 0, 0, 0, 0, 0],
          [0x1f, 0xc0, 0x01, 0x00],
          [0x1f, 0x11, 0x51],
          yxqRaster(widthBytes, send.height, rows),
          [0x1f, 0x12, 0x20, 0x00],
          [0x1f, 0xc0, 0x01, 0x01],
          [0x1f, 0x11, 0x50],
        ]),
      }
    case 'MARKLIFE_L11':
      return { ok: true, bytes: concat([new Uint8Array(15), start, l11Raster(widthBytes, send.height, rows), nextLabel, end]) }
    case 'LUCKJINGLE':
      // 켜기 · 깨우기 00×12 · 위치 맞춤 시작 · 래스터 · 다음 라벨로 · 위치 맞춤 끝 · 작업 끝 (D-PRN2-02 — 농도 명령 없음)
      return {
        ok: true,
        bytes: concat([[0x10, 0xff, 0xf1, 0x03], new Uint8Array(12), [0x1f, 0x11, 0x51], l11Raster(widthBytes, send.height, rows), nextLabel, [0x1f, 0x11, 0x50], end]),
      }
  }
}

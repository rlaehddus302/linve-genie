// 서버가 만든 라벨 그림 받기 (APP-03·APP-05: 앱은 그리지 않는다 — LABEL_RULES L-0 렌더 함수가 서버에서 돈다).
// 서버 입구: `GET /api/print/jobs/:id/bitmap?attempt=&device=` → `{ width, height, data }`
// (data = 1비트 행 바이트 base64, 폭 ÷ 8 올림 바이트씩, 1 = 검정 — @livejjim/label LabelBitmap과 같은 모양).
// 없거나 잘못된 그림은 실패한다. 앱은 서버가 준 점만 프린터에 넘긴다.
import type { LabelBitmap } from '@livejjim/label'
import type { ClaimedJob } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, withQuery } from './client.ts'

interface BitmapResponse {
  readonly width: number
  readonly height: number
  readonly data: string
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** base64 → 바이트 (atob가 없는 환경도 있어 직접 푼다) */
export function decodeBase64(text: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('LABEL_BITMAP_FORMAT')
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let n = 0
  for (const char of clean) {
    value = (value << 6) | B64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (value >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

export const bytesPerRow = (width: number): number => Math.ceil(width / 8)

/** 받은 값 → 1비트 그림. 모양이 어긋나면(길이가 폭·높이와 안 맞음) null */
export function parseBitmap(body: BitmapResponse): LabelBitmap | null {
  if (body === null || typeof body !== 'object' || typeof body.data !== 'string' || body.data.length > 1024 * 1024) return null
  if (!Number.isInteger(body.width) || !Number.isInteger(body.height) || body.width <= 0 || body.height <= 0 || body.width > 832 || body.height > 4096) return null
  let data: Uint8Array
  try { data = decodeBase64(body.data) } catch { return null }
  if (data.length !== bytesPerRow(body.width) * body.height) return null
  return { width: body.width, height: body.height, data }
}

async function fetchBitmap(path: string): Promise<LabelBitmap> {
  const bitmap = parseBitmap(await get<BitmapResponse>(path))
  if (bitmap === null) throw new Error('LABEL_BITMAP_FORMAT')
  return bitmap
}
export function fetchJobBitmap(job: Pick<ClaimedJob, 'id' | 'attempt'>, deviceId: string): Promise<LabelBitmap> {
  return fetchBitmap(withQuery(`/api/print/jobs/${encodeURIComponent(job.id)}/bitmap`, { attempt: job.attempt, device: deviceId }))
}
export function fetchTestBitmap(): Promise<LabelBitmap> { return fetchBitmap('/api/print/test-bitmap') }

/** /print/result는 라벨·프린터 오류 코드만 받는다. HTTP 코드를 그대로 보내지 않는다. */
export function bitmapFailure(error: unknown): { code: string; item?: string; message: string } {
  if (isApiError(error)) {
    const detail = error.details.renderError
    if (detail !== null && typeof detail === 'object') {
      const value = detail as Record<string, unknown>
      const codes = ['INVALID_DATA', 'INVALID_TEMPLATE', 'DOES_NOT_FIT', 'MIXED_SIZES', 'NO_LABELS', 'INVALID_IMAGE']
      if (typeof value.code === 'string' && codes.includes(value.code)) return { code: value.code, ...(typeof value.item === 'string' ? { item: value.item } : {}), message: typeof value.message === 'string' ? value.message : error.message }
    }
    return { code: 'DISCONNECTED', message: error.message }
  }
  if (error instanceof Error && error.message === 'LABEL_BITMAP_FORMAT') return { code: 'INVALID_IMAGE', message: '라벨 그림을 읽을 수 없어요. 라벨을 다시 만들어 주세요.' }
  return { code: 'DISCONNECTED', message: '라벨 그림을 받지 못했어요. 연결을 확인하고 다시 눌러 주세요.' }
}

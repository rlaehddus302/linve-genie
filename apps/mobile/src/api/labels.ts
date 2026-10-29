// 서버가 만든 라벨 그림 받기 (APP-03·APP-05: 앱은 그리지 않는다 — LABEL_RULES L-0 렌더 함수가 서버에서 돈다).
// 서버 입구는 APP2 서버 몫 — TODO(APP2 server): `GET /api/print/jobs/:id/bitmap?attempt=&device=` → `{ width, height, data }`
// (data = 1비트 행 바이트 base64, 폭 ÷ 8 올림 바이트씩, 1 = 검정 — @livejjim/label LabelBitmap과 같은 모양).
// 아직 없으면(404) 개발용 빈 그림을 돌려준다(가짜 BLE 프린터와 짝). 앱은 받은 점을 그대로 프린터 어댑터에 넘긴다(APP-03 AC3).
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
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
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
  if (!Number.isInteger(body.width) || !Number.isInteger(body.height) || body.width <= 0 || body.height <= 0) return null
  const data = decodeBase64(body.data)
  if (data.length !== bytesPerRow(body.width) * body.height) return null
  return { width: body.width, height: body.height, data }
}

/** 개발용 빈 그림 (B1 50×30mm, 384×240점) — TODO(APP2 server) 입구가 생기면 지운다 */
export function blankBitmap(width = 384, height = 240): LabelBitmap {
  return { width, height, data: new Uint8Array(bytesPerRow(width) * height) }
}

export async function fetchJobBitmap(job: Pick<ClaimedJob, 'id' | 'attempt'>, deviceId: string): Promise<LabelBitmap> {
  try {
    const body = await get<BitmapResponse>(withQuery(`/api/print/jobs/${encodeURIComponent(job.id)}/bitmap`, { attempt: job.attempt, device: deviceId }))
    const bitmap = parseBitmap(body)
    if (bitmap === null) throw new Error('LABEL_BITMAP_FORMAT')
    return bitmap
  } catch (error) {
    if (isApiError(error) && error.status === 404) return blankBitmap()
    throw error
  }
}

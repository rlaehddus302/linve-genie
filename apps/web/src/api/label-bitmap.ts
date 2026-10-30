// APP-05·LBL-03: 출력·미리보기·파일에는 같은 서버 그림을 넘긴다.
import type { LabelBitmap, LabelErrorCode } from '@livejjim/label'
import type { ClaimedJob } from './print-types.ts'
import type { PagesOutcome, RenderOutcome } from '../lib/label-render.ts'
import { ApiError, get } from './client.ts'

export function parseLabelBitmap(value: unknown): LabelBitmap | null {
  if (typeof value !== 'object' || value === null) return null
  const { width, height, data } = value as Record<string, unknown>
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 832 || height > 4096) return null
  if (typeof data !== 'string' || data.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null
  let decoded: string
  try { decoded = atob(data) } catch { return null }
  if (decoded.length !== Math.ceil(width / 8) * height) return null
  return { width, height, data: Uint8Array.from(decoded, (char) => char.charCodeAt(0)) }
}

async function serverBitmap(path: string): Promise<RenderOutcome> {
  try {
    const image = parseLabelBitmap(await get<unknown>(path))
    return image === null
      ? { ok: false, error: { code: 'INVALID_DATA', message: '라벨 그림을 제대로 받지 못했어요. 다시 받아 주세요.' } }
      : { ok: true, image }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'LABEL_INVALID') {
      const detail = error.details['renderError']
      const value = typeof detail === 'object' && detail !== null ? detail as Record<string, unknown> : {}
      const codes: readonly string[] = ['INVALID_DATA', 'INVALID_TEMPLATE', 'DOES_NOT_FIT', 'MIXED_SIZES', 'NO_LABELS', 'INVALID_IMAGE']
      const code = typeof value['code'] === 'string' && codes.includes(value['code']) ? value['code'] as LabelErrorCode : 'INVALID_DATA'
      return { ok: false, error: { code, message: error.message, ...(typeof value['item'] === 'string' ? { item: value['item'] } : {}) } }
    }
    throw error
  }
}

export function fetchPrintBitmap(job: Pick<ClaimedJob, 'id' | 'attempt'>, device: string): Promise<RenderOutcome> {
  const query = new URLSearchParams({ attempt: job.attempt, device })
  return serverBitmap(`/api/print/jobs/${encodeURIComponent(job.id)}/bitmap?${query}`)
}
/** 테스트 라벨 그림 — 크기는 이은 프린터 프로필의 기본 크기를 늘 넘긴다 (D-PRN2-11, L-7) */
export function fetchTestPrintBitmap(size: ClaimedJob['template']['size']): Promise<RenderOutcome> {
  return serverBitmap(`/api/print/test-bitmap?${new URLSearchParams({ size })}`)
}

export function labelPreviewPath(kind: 'product' | 'packing' | 'job', date: string, ref: string): string {
  return `/api/print/preview/${kind}?${new URLSearchParams({ date, ref })}`
}

export async function fetchLabelPreview(path: string): Promise<PagesOutcome> {
  const value: unknown = await get(path)
  const raw = typeof value === 'object' && value !== null && 'images' in value ? value.images : null
  const images = Array.isArray(raw) ? raw.map(parseLabelBitmap) : []
  if (images.length === 0 || images.some((image) => image === null)) return { ok: false, error: { code: 'INVALID_DATA', message: '라벨 그림을 제대로 받지 못했어요. 다시 받아 주세요.' } }
  return { ok: true, images: images as LabelBitmap[] }
}

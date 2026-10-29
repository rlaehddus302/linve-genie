import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPrintBitmap, fetchTestPrintBitmap, parseLabelBitmap } from '../src/api/label-bitmap.ts'

afterEach(() => vi.unstubAllGlobals())
describe('APP2 웹도 서버 bitmap으로 출력', () => {
  it('그림을 그대로 풀고 잘못된 크기·base64·빈 그림을 거절한다', () => {
    expect(parseLabelBitmap({ width: 8, height: 2, data: 'gAE=' })).toEqual({ width: 8, height: 2, data: new Uint8Array([128, 1]) })
    for (const value of [null, {}, { width: 0, height: 2, data: '' }, { width: 8, height: 2, data: 'AA==' }, { width: 8, height: 2, data: '!!!!' }, { width: 833, height: 2, data: 'gAE=' }, { width: 8, height: 4097, data: 'gAE=' }]) expect(parseLabelBitmap(value)).toBeNull()
  })
  it('받은 작업·시도·현재 기기를 서버에 보내며 임의 렌더는 하지 않는다', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ width: 8, height: 2, data: 'gAE=' }))
    vi.stubGlobal('fetch', fetcher)
    expect(await fetchPrintBitmap({ id: 'job/a', attempt: 'attempt-1' }, 'device01')).toEqual({ ok: true, image: { width: 8, height: 2, data: new Uint8Array([128, 1]) } })
    expect(fetcher.mock.calls[0]).toEqual(['/api/print/jobs/job%2Fa/bitmap?attempt=attempt-1&device=device01', expect.objectContaining({ credentials: 'include', cache: 'no-store' })])
    await fetchTestPrintBitmap()
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/print/test-bitmap')
  })
  it('404를 빈 그림으로 바꾸지 않고 그리기 오류의 문장을 유지한다', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'NOT_FOUND', message: '출력 작업을 찾을 수 없어요.' } }, { status: 404 }))
    await expect(fetchPrintBitmap({ id: 'missing', attempt: 'old' }, 'device01')).rejects.toMatchObject({ status: 404 })
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'LABEL_INVALID', message: '가격 칸이 좁아요.' } }, { status: 422 }))
    expect(await fetchTestPrintBitmap()).toEqual({ ok: false, error: { code: 'INVALID_DATA', message: '가격 칸이 좁아요.' } })
  })
})

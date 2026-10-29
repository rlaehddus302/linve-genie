import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LabelBitmap } from '@livejjim/label'
import { ProductLabels } from '../src/components/LabelParts.tsx'
import type { Claim } from '../src/api/types.ts'
import { pngBytes, labelPdfBytes } from '../src/lib/label-render.ts'
import { labelView, templates } from './print-support.ts'
import { product } from './support.ts'

const output = vi.hoisted(() => ({ image: null as LabelBitmap | null, download: vi.fn(), packing: null }))
vi.mock('../src/components/print-context.tsx', () => ({
  usePrintApi: () => null, useLabelsEnabled: () => true,
  usePrintState: () => ({ templates: templates() }), usePackingLabel: () => output.packing,
}))
vi.mock('../src/components/LabelImage.tsx', () => ({ LabelImage: ({ image, label }: { image: LabelBitmap; label: string }) => { output.image = image; return <div role="img" aria-label={label} /> } }))
vi.mock('../src/lib/label-files.ts', () => ({ downloadBytes: output.download, canShareFile: () => false, shareBytes: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); output.download.mockReset(); output.image = null })

describe('actual label preview and exports share server pixels', () => {
  it('displays the server bitmap and saves the same pixels as PNG and PDF', async () => {
    const data = new Uint8Array(48 * 240); data[0] = 128; data[data.length - 1] = 1
    const bits = { width: 384, height: 240, data }
    vi.stubGlobal('fetch', async () => Response.json({ images: [{ ...bits, data: btoa(String.fromCharCode(...data)) }] }))
    const claim = { id: 'c1', no: 15, broadcast: 'b1', confirmVersion: 1, qty: 1, variant: null } as Claim
    render(<ProductLabels product={product(15)} winners={[claim]} labels={new Map([['c1@1', labelView('c1@1')]])} rehearsal={false} date="2026-10-19" nameOf={() => '손님'} />)
    await screen.findByRole('img', { name: '15번 라벨 미리 보기' })
    expect(output.image?.data.every((value, i) => value === bits.data[i])).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '그림 파일로 저장' }))
    const png = pngBytes(bits)
    if (!png.ok) throw new Error('PNG를 만들지 못했다')
    expect((output.download.mock.lastCall?.[0] as Uint8Array).every((value, i) => value === png.bytes[i])).toBe(true)
    expect(output.download.mock.lastCall?.slice(1)).toEqual(['라벨-2026-10-19-15번.png', 'image/png'])
    fireEvent.click(screen.getByRole('button', { name: 'PDF로 저장' }))
    const pdf = labelPdfBytes([bits])
    if (!pdf.ok) throw new Error('PDF를 만들지 못했다')
    expect((output.download.mock.lastCall?.[0] as Uint8Array).every((value, i) => value === pdf.bytes[i])).toBe(true)
    expect(output.download.mock.lastCall?.slice(1)).toEqual(['라벨-2026-10-19-15번.pdf', 'application/pdf'])
  })
  it('shows a failed server preview and keeps export disabled instead of rendering different local pixels', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 'NOT_FOUND', message: '라벨을 다시 확인해 주세요.' } }, { status: 404 }))
    const claim = { id: 'c1', no: 15, broadcast: 'b1', confirmVersion: 1, qty: 1, variant: null } as Claim
    render(<ProductLabels product={product(15)} winners={[claim]} labels={new Map([['c1@1', labelView('c1@1')]])} rehearsal={false} date="2026-10-19" nameOf={() => '손님'} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('라벨을 다시 확인해 주세요.'))
    expect(screen.queryByRole('img')).toBeNull()
    expect((screen.getByRole('button', { name: '그림 파일로 저장' }) as HTMLButtonElement).disabled).toBe(true)
    expect(output.download).not.toHaveBeenCalled()
  })
})

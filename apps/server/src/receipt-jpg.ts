// 확인서 JPG (N4b D-N4b-03): 공유 PNG(packages/documents renderReceiptPng, D-207)와 같은 그림 — 같은 배치(layoutReceipt 'image')·같은 화소(rasterizePage, 폭 1080px) —
// 를 기본 JPEG(품질 90)로. 전원 이미지 묶음은 묶음마다 이 JPG 하나를 ZIP에 담는다.
// 작업 워커(work-worker.ts)가 부른다 — 판정 스레드에서 부르지 않는다.
import { asDocumentFont, layoutReceipt, rasterizePage, type FontSource, type LayoutPage, type ReceiptData } from '@livejjim/documents'
import { encodeGrayJpeg } from './jpeg.ts'
import { storedZip } from './zip.ts'

/** 한 사람 확인서 → 폭 1080px JPG 한 장 */
export function renderReceiptJpg(receipt: ReceiptData, fontSource: FontSource): Uint8Array {
  const font = asDocumentFont(fontSource)
  const page = layoutReceipt(receipt, font, 'image').pages[0] as LayoutPage
  const { width, height, pixels } = rasterizePage(page, font)
  return encodeGrayJpeg(width, height, pixels)
}

/** 전원 이미지 묶음: (묶음 안 이름, 확인서) 차례대로 → ZIP (수정 시각 = 확인서를 만든 시각) */
export function renderReceiptJpgZip(entries: readonly { readonly name: string; readonly receipt: ReceiptData }[], fontSource: FontSource, modifiedAt: number): Uint8Array {
  const font = asDocumentFont(fontSource)
  return storedZip(
    entries.map((entry) => ({ name: entry.name, bytes: renderReceiptJpg(entry.receipt, font) })),
    modifiedAt,
  )
}

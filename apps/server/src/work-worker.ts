// 작업 워커 (work-pool.ts가 띄운다 — RA-I2-003·RA-I2-004): 확인서 그림·PDF, 판매대장 엑셀 쓰기, 상품 목록 .xlsx 읽기, 운송장 PDF(T1).
// 판정·DB·네트워크에는 손대지 않는다. 받은 값으로 파일 바이트(또는 읽은 행)를 만들어 돌려줄 뿐이다. 작업 내용은 출력하지 않는다.
// 무거운 모듈은 그 작업이 처음 올 때 읽는다(.xlsx 읽기 워커가 PDF 모듈을 읽지 않게).
import { parentPort } from 'node:worker_threads'
import type { ReceiptData, WaybillData } from '@livejjim/documents'
import type { LedgerChunk, WorkKind } from './work-pool.ts'

interface Request {
  readonly id: number
  readonly kind?: WorkKind
  readonly input?: unknown
  readonly streamed?: boolean
  readonly chunk?: unknown
  readonly end?: boolean
}

type Handler = (input: unknown, chunks: readonly unknown[]) => Promise<unknown>

const handlers: Readonly<Record<WorkKind, Handler>> = {
  /** 확인서 PDF (한 사람이면 receipts 하나, 전원이면 찍힌 이름 순 목록 — 문서 패키지 renderReceiptsPdf, 같은 내장 글꼴) */
  receiptPdf: async (input) => {
    const { renderReceiptsPdf } = await import('@livejjim/documents')
    const { documentFont } = await import('./files.ts')
    return renderReceiptsPdf((input as { receipts: ReceiptData[] }).receipts, documentFont())
  },
  /** 확인서 그림 (공유·저장 그림 — 문서 패키지 renderReceiptPng) */
  receiptPng: async (input) => {
    const { renderReceiptPng } = await import('@livejjim/documents')
    const { documentFont } = await import('./files.ts')
    return renderReceiptPng((input as { receipt: ReceiptData }).receipt, documentFont())
  },
  /** 확인서 JPG (N4b — 공유 PNG와 같은 그림을 기본 JPEG로) */
  receiptJpg: async (input) => {
    const { renderReceiptJpg } = await import('./receipt-jpg.ts')
    const { documentFont } = await import('./files.ts')
    return renderReceiptJpg((input as { receipt: ReceiptData }).receipt, documentFont())
  },
  /** 전원 이미지 묶음 ZIP (N4b — 묶음 안 이름·확인서를 차례대로, 수정 시각 = 만든 시각) */
  receiptJpgZip: async (input) => {
    const { renderReceiptJpgZip } = await import('./receipt-jpg.ts')
    const { documentFont } = await import('./files.ts')
    const { entries, modifiedAt } = input as { entries: { name: string; receipt: ReceiptData }[]; modifiedAt: number }
    return renderReceiptJpgZip(entries, documentFont(), modifiedAt)
  },
  /** 판매대장 엑셀: 조각(날짜마다의 행)을 이어 문서 패키지 ledgerToXlsx. 열 모양은 조각 중 하나라도 옵션이면 옵션·수량·단가 열 (D-O3-07) */
  ledgerXlsx: async (_input, chunks) => {
    const { ledgerToXlsx } = await import('@livejjim/documents')
    const list = chunks as readonly LedgerChunk[]
    // 음성 기록 시트 (V3 R-25, D-V3-65): 음성 기록 줄이 하나라도 있으면 날짜 순으로 이어 붙여 넘긴다 — 없으면 시트를 더하지 않는다(전과 같은 파일)
    const voiced = list.some((chunk) => (chunk.voiceLog?.length ?? 0) > 0)
    return ledgerToXlsx(
      list.flatMap((chunk) => chunk.rows),
      list.some((chunk) => chunk.options),
      voiced ? { voiceLog: list.flatMap((chunk) => chunk.voiceLog ?? []) } : {},
    )
  },
  /** 운송장 PDF (T1 PC-7 — 문서 패키지 renderWaybillsPdf, 같은 내장 글꼴). 답 = { pdf(없으면 null), outcomes(준 순서대로 만들었는지·오류 코드) } */
  waybillPdf: async (input) => {
    const { renderWaybillsPdf } = await import('@livejjim/documents')
    const { documentFont } = await import('./files.ts')
    return renderWaybillsPdf((input as { list: WaybillData[] }).list, documentFont())
  },
  /** 상품 목록 .xlsx → 첫 시트의 행 (압축 해제·시트·행·칸 상한 — import-files.ts) */
  xlsxRows: async (input) => {
    const { readXlsxRowsBounded } = await import('./import-files.ts')
    return readXlsxRowsBounded((input as { bytes: Uint8Array }).bytes)
  },
}

const port = parentPort
if (port === null) throw new Error('작업 워커는 work-pool.ts가 띄운다')

const pending = new Map<number, { kind: WorkKind; input: unknown; chunks: unknown[] }>()

async function run(id: number, kind: WorkKind, input: unknown, chunks: readonly unknown[]): Promise<void> {
  try {
    const value = await handlers[kind](input, chunks)
    // 파일 바이트는 옮긴다 (복사하지 않는다) — 버퍼 전체를 쓰는 바이트만
    const transfer = value instanceof Uint8Array && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer ? [value.buffer] : []
    port?.postMessage({ id, ok: true, value }, transfer)
  } catch {
    port?.postMessage({ id, ok: false })
  }
}

port.on('message', (message: Request) => {
  if (message.kind !== undefined) {
    if (!(message.kind in handlers)) {
      port.postMessage({ id: message.id, ok: false })
      return
    }
    if (message.streamed === true) {
      pending.set(message.id, { kind: message.kind, input: message.input, chunks: [] })
      return
    }
    void run(message.id, message.kind, message.input, [])
    return
  }
  const job = pending.get(message.id)
  if (job === undefined) return
  if (message.end === true) {
    pending.delete(message.id)
    void run(message.id, job.kind, job.input, job.chunks)
    return
  }
  job.chunks.push(message.chunk)
})

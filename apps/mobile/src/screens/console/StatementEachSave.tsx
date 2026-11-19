// 구매자마다 따로 저장 (D-STMT-EACH-01, 판매자 요청 2026-11-20 "사진, 엑셀, csv 등으로 저장할 때 구매자 각각의 정산서를 다운받고 싶은데 …
// 구매자 10명이라 하면 10명 각각의 정산서를 만들어서 10장 다운받아지게"):
// [보내기] → "구매자마다 따로 저장하기" → 사진 · 엑셀 · CSV 중 하나 → 저장할 폴더를 한 번 고르면 구매자(합친 정산서는 한 명) 수만큼 파일을 쓴다.
// - 사진: 구매자 정산서 사진과 같은 그림(옛 양식, 긴 정산서는 장마다 한 파일). 화면 밖에 한 장씩 그려 찍는다.
// - 엑셀·CSV: 서버가 만든 구매자 한 명 정산서 파일(GET /api/broadcasts/:id/statement/buyer/:format?buyer=).
// - 파일 이름: 정산서-날짜-번호-닉네임 — 목록 순서 번호가 앞이라 폴더에서도 목록 순서대로 보인다. 닉네임은 글자·숫자만 남긴다(파일 이름에 쓸 수 없는 글자를 뺀다).
// - 폴더에 쓸 수 없는 휴대폰이면 한 명씩 공유 창으로 넘긴다(아이폰 "이미지 저장"·"파일에 저장").
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import type Svg from 'react-native-svg'
import { getBytes, withRetry } from '../../api/client.ts'
import { orderName, type BuyerOrder, type StatementInfo } from '../../lib/broadcast-sales.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { nativeSaveFolder, nativeShareFile } from '../../native/index.ts'
import type { FolderWriter } from '../../native/share.ts'
import { BottomSheet } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { MenuRow } from '../order-parts.tsx'
import type { ExportKind } from '../order-export.tsx'
import { PAPER_WIDTH, PaperSvg, paperLayout, type PaperLayout } from './BuyerOrderPaper.tsx'
import { snapshot } from './paper-image.ts'

export const EACH_ROW = '구매자마다 따로 저장하기'
export const EACH_TITLE = '구매자마다 따로 저장하기'
export const eachHelp = (count: number): string => `구매자 ${count}명의 정산서를 한 명씩 따로 저장해요. 저장할 폴더를 한 번 골라 주세요.`
export const EACH_LABEL: Readonly<Record<ExportKind, string>> = { photo: '사진으로 저장하기', xlsx: '엑셀 파일로 저장하기', csv: 'CSV 파일로 저장하기' }
export const eachProgress = (done: number, total: number): string => `정산서를 저장하고 있어요 · ${done}/${total}명`
export const eachDone = (total: number): string => `구매자 ${total}명의 정산서를 따로 저장했어요.`
export const eachPartly = (done: number, total: number): string => `구매자 ${total}명 가운데 ${done}명만 저장했어요. 다시 해 주세요.`
export const EACH_SHARE_NOTE = '이 휴대폰은 폴더에 바로 저장할 수 없어 한 명씩 저장 창을 열어요.'

/** 화면 밖 그림을 붙이고 찍기까지 기다림 */
const DRAW_WAIT_MS = 120

const MIME: Readonly<Record<ExportKind, string>> = { photo: 'image/png', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
const EXT: Readonly<Record<ExportKind, string>> = { photo: 'png', csv: 'csv', xlsx: 'xlsx' }

/** 파일 이름에 넣을 닉네임 — 글자·숫자·빈칸만, 20자까지 (믿을 수 없는 글이라 경로·특수 글자를 뺀다) */
export function fileSafe(name: string): string {
  const kept = [...name.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, 20).join('').trim()
  return kept === '' ? '구매자' : kept
}

/** 구매자마다 파일 이름 (번호는 목록 순서, 자릿수를 맞춘다) */
export function eachFileName(date: string, at: number, total: number, name: string, kind: ExportKind, page?: { index: number; count: number }): string {
  const no = String(at + 1).padStart(String(total).length, '0')
  const part = page === undefined || page.count <= 1 ? '' : `-${String(page.index + 1)}`
  return `정산서-${date}-${no}-${fileSafe(name)}${part}.${EXT[kind]}`
}

interface PhotoJob {
  readonly order: BuyerOrder
  readonly layout: PaperLayout
}

/**
 * 구매자마다 따로 저장하기 — 고르는 창과 진행. orders는 목록 순서(구매자별 줄 순서).
 * onNote: 진행·끝 한 줄(빈 글이면 지운다)
 */
export function useEachSave({ broadcastId, date, orders, name, shop, info, onNote }: {
  readonly broadcastId: string
  readonly date: string
  readonly orders: readonly BuyerOrder[]
  readonly name: (id: string) => string
  readonly shop: string
  readonly info: StatementInfo | null
  readonly onNote: (text: string, tone: 'info' | 'danger') => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [job, setJob] = useState<PhotoJob | null>(null)
  const svg = useRef<Svg>(null)
  /** 지금 그린 그림을 찍어 돌려줄 곳 */
  const drawn = useRef<((bytes: Uint8Array | null) => void) | null>(null)

  /** 화면 밖에 한 장 그리고 찍는다 */
  const photoOf = (next: PhotoJob): Promise<Uint8Array | null> => new Promise(resolve => {
    drawn.current = resolve
    setJob(next)
  })
  // 그림이 붙은 뒤 조금 기다려 찍는다 (네이티브 그림이 그려질 틈 — 화면 밖이라 판매자에게는 보이지 않는다)
  useEffect(() => {
    if (job === null) return
    const resolve = drawn.current
    if (resolve === null) return
    drawn.current = null
    const timer = setTimeout(() => { snapshot(svg.current, job.layout.height, PAPER_WIDTH).then(resolve, () => resolve(null)) }, DRAW_WAIT_MS)
    return () => { clearTimeout(timer); resolve(null) }
  }, [job])

  const run = async (kind: ExportKind) => {
    if (busy !== null || orders.length === 0) return
    if (kind === 'photo' && info === null) return
    setBusy(kind)
    setOpen(false)
    await wait(SHEET_GAP_MS)
    let folder: FolderWriter | null = null
    let share = false
    try {
      folder = await nativeSaveFolder()()
      if (folder === null) { setBusy(null); return }
    } catch {
      share = true
      onNote(EACH_SHARE_NOTE, 'info')
      await wait(1200)
    }
    const total = orders.length
    let done = 0
    const put = async (fileName: string, bytes: Uint8Array) => {
      if (!share && folder !== null) {
        try {
          folder.write(fileName, bytes, MIME[kind])
          return
        } catch {
          share = true
          onNote(EACH_SHARE_NOTE, 'info')
          await wait(1200)
        }
      }
      await nativeShareFile()(bytes, fileName, MIME[kind])
    }
    try {
      for (const [at, order] of orders.entries()) {
        if (!share) onNote(eachProgress(done, total), 'info')
        const buyerName = orderName(order, name)
        if (kind === 'photo') {
          const first = paperLayout(order, shop, date, buyerName, info!, 0)
          const count = first.pages.length
          let ok = true
          for (let index = 0; index < count; index++) {
            const layout = index === 0 ? first : paperLayout(order, shop, date, buyerName, info!, index)
            const bytes = await photoOf({ order, layout })
            if (bytes === null) { ok = false; break }
            await put(eachFileName(date, at, total, buyerName, kind, { index, count }), bytes)
          }
          if (!ok) continue
        } else {
          const path = `/api/broadcasts/${encodeURIComponent(broadcastId)}/statement/buyer/${kind}?buyer=${encodeURIComponent(order.id)}`
          const { bytes } = await withRetry(() => getBytes(path))
          await put(eachFileName(date, at, total, buyerName, kind), bytes)
        }
        done++
      }
    } catch {
      // 받기·저장이 끊겼다 — 몇 명까지 저장했는지 알린다
    } finally {
      setJob(null)
      setBusy(null)
      onNote(done === total ? eachDone(total) : eachPartly(done, total), done === total ? 'info' : 'danger')
    }
  }

  const sheet = (
    <BottomSheet visible={open} title={EACH_TITLE} description={eachHelp(orders.length)} onClose={() => setOpen(false)} testID="statement-each">
      <View style={{ marginHorizontal: -SPACE.xl }}>
        {(['photo', 'xlsx', 'csv'] as const).map(kind => (
          <MenuRow key={kind} title={EACH_LABEL[kind]} sub={`${orders.length}개 파일`} busy={busy === kind} disabled={busy !== null || (kind === 'photo' && info === null)} onPress={() => void run(kind)} />
        ))}
      </View>
    </BottomSheet>
  )
  // 사진 그림: 화면 밖(왼쪽 멀리)에 실제 크기로 한 장 — 보이지 않고 읽어 주지도 않는다 (BuyerOrderPaper와 같은 방식)
  const canvas = job === null ? null : (
    <View aria-hidden pointerEvents="none" testID="statement-each-photo"
      key={`${job.order.id}:${String(job.layout.index)}`}
      style={{ position: 'absolute', left: -10000, top: 0, width: PAPER_WIDTH, height: job.layout.height }}>
      <PaperSvg order={job.order} layout={job.layout} svgRef={svg} />
    </View>
  )
  return { open: () => setOpen(true), busy: busy !== null, sheet, canvas }
}

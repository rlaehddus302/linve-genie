// 주문 상세 [내보내기] (D-UX4-126, 사용자 지시 2026-11-11 "[내보내기] 해서 사진이나 csv나 엑셀 같은 파일로 내보낼 수 있게 하자").
// 아래 창에 세 가지를 한 줄로(단추는 좌우로만, D-UX4-01): [사진] [CSV 파일] [엑셀 파일]. 고르면 서버가 만든 파일을 받아 휴대폰 공유 창으로 넘긴다
// (카톡·드라이브·메일 중 판매자가 고른다 — 우리 앱은 파일만 만든다).
// 사진 = 손님에게 문자로 보내는 확인서 그림(GET /api/days/:date/receipt.jpg, D-REAL-13)과 같은 그림.
// 아이폰은 아래 창(네이티브 Modal)이 떠 있으면 공유 창을 띄우지 못하고 기다리기만 한다(시뮬레이터에서 찾음) — 파일을 받은 뒤 아래 창을 먼저 닫고, 닫힌 뒤에 공유 창을 연다.
// CSV·엑셀 = GET /api/days/:date/order.csv|.xlsx — 휴대폰 번호·주소는 넣지 않는다(AUTO: 파일은 메신저로 퍼지기 쉽다, 손님 엑셀도 연락처는 기본으로 빼 둔다).
import { useState } from 'react'
import { View } from 'react-native'
import { getBytes, isApiError, withQuery, withRetry } from '../api/client.ts'
import { nativeShareFile } from '../native/index.ts'
import { BigButton, BottomSheet, ButtonRow, ErrorLine, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'

export const EXPORT_TITLE = '내보내기'
export const EXPORT_NOTE = '휴대폰 번호와 주소는 넣지 않아요.'
export const EXPORT_FAILED = '파일을 내보내지 못했어요. 다시 눌러 주세요.'

export type ExportKind = 'photo' | 'csv' | 'xlsx'

export const EXPORT_LABEL: Readonly<Record<ExportKind, string>> = { photo: '사진', csv: 'CSV 파일', xlsx: '엑셀 파일' }

const MIME: Readonly<Record<ExportKind, string>> = {
  photo: 'image/jpeg',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** 고른 것 → 서버 경로 (실제 날짜만) */
export function exportPath(kind: ExportKind, date: string, buyer: string): string {
  if (kind === 'photo') return withQuery(`/api/days/${date}/receipt.jpg`, { buyer, rehearsal: false })
  return withQuery(`/api/days/${date}/order.${kind}`, { buyer })
}

/** 공유 창에 보이는 파일 이름 — 손님 이름(믿을 수 없는 글)은 넣지 않는다 */
export const exportFileName = (kind: ExportKind, date: string): string => `order-${date}.${kind === 'photo' ? 'jpg' : kind}`

/** 아래 창이 닫히는 움직임이 끝날 때까지 (키트 시트 닫힘 시간보다 넉넉히) */
export const SHEET_GONE_MS = 450

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * onClose: 창을 닫는다. onShareFailed: 창을 닫은 뒤 공유 창을 못 열었을 때 — 부르는 화면이 [내보내기] 곁에 알린다
 */
export function OrderExportSheet({ visible, date, buyer, onClose, onShareFailed }: { readonly visible: boolean; readonly date: string; readonly buyer: string; readonly onClose: () => void; readonly onShareFailed: (message: string) => void }) {
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (kind: ExportKind) => {
    if (busy !== null) return
    setBusy(kind)
    setError(null)
    try {
      const { bytes } = await withRetry(() => getBytes(exportPath(kind, date, buyer)))
      onClose()
      await wait(SHEET_GONE_MS)
      try {
        await nativeShareFile()(bytes, exportFileName(kind, date), MIME[kind])
      } catch {
        onShareFailed(EXPORT_FAILED)
      }
    } catch (caught: unknown) {
      setError(isApiError(caught) ? caught.message : EXPORT_FAILED)
    } finally {
      setBusy(null)
    }
  }
  const close = () => {
    setError(null)
    onClose()
  }
  return (
    <BottomSheet visible={visible} onClose={close} title={EXPORT_TITLE} description={EXPORT_NOTE} testID="order-export">
      <View style={{ gap: SPACE.sm }}>
        <ButtonRow>
          {(['photo', 'csv', 'xlsx'] as const).map((kind) => (
            <BigButton key={kind} kind="secondary" label={EXPORT_LABEL[kind]} busy={busy === kind} disabled={busy !== null && busy !== kind} onPress={() => void run(kind)} oneLine />
          ))}
        </ButtonRow>
        {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
        {busy !== null ? <Txt step="caption" color="textSub">파일을 만들고 있어요</Txt> : null}
      </View>
    </BottomSheet>
  )
}

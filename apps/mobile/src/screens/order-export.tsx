// 주문 상세 [정산서 보내기] (D-UX4-126 [내보내기] → D-UX4-128, 사용자 지시 2026-11-11 "내보내기 -> 정산서 보내기 이름 바꾸고, 눌렀을 때 옵션으로
// 고객에게 문자 보내기, 사진으로 저장하기, CSV 파일로 저장하기, 엑셀 파일로 저장하기 버튼 형태 말고 배치해").
// 아래 창 안에 네 줄(단추 모양이 아닌 줄 — 이름 + ›). 고르면 창을 먼저 닫고, 닫힌 뒤에 다음 창을 연다
// (아이폰은 아래 창(네이티브 Modal)이 떠 있으면 문자 창·공유 창을 띄우지 못하고 기다리기만 한다 — 시뮬레이터에서 찾음).
// · 고객에게 문자 보내기: 확인서 사진을 붙여 판매자 문자 앱을 연다(D-REAL-05·13, 영수증 보내기 화면과 같은 흐름). 번호를 모르면 번호 칸 창.
// · 사진·CSV·엑셀: 서버가 만든 파일을 받아 휴대폰 공유 창으로 — 아이폰은 "이미지 저장"(사진 보관함 추가 설명, D-UX4-127)·"파일에 저장"이 거기 있다.
//   사진 = 확인서 그림(GET /api/days/:date/receipt.jpg), CSV·엑셀 = GET /api/days/:date/order.csv|.xlsx — 휴대폰 번호·주소는 넣지 않는다(AUTO, D-UX4-126).
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import { SMS_NOTE, SMS_OPEN, SMS_PHONE_HELP, SMS_PHONE_LABEL, SMS_SEND, SMS_UNAVAILABLE } from '@livejjim/web/src/lib/receipt-sms.ts'
import { getBytes, isApiError, withQuery, withRetry } from '../api/client.ts'
import { nativeShareFile } from '../native/index.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useReceiptSms, useSmsDevice } from '../lib/receipt-sms-flow.ts'
import { BigButton, BottomSheet, TextField, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { MenuRow } from './order-parts.tsx'

export const SEND_TITLE = '정산서 보내기'
export const SEND_NOTE = '파일에는 휴대폰 번호와 주소를 넣지 않아요.'
export const EXPORT_FAILED = '파일을 내보내지 못했어요. 다시 눌러 주세요.'
export const SMS_ROW = '고객에게 문자 보내기'
/** 이 휴대폰(유심 없는 기기·시뮬레이터)이나 가게 설정으로 문자를 못 보낼 때 줄 아래 글 — 옛 "링크 보내기로" 안내는 이 창에 없다 */
export const SMS_OFF = '이 휴대폰에서는 문자를 보낼 수 없어요'

export type ExportKind = 'photo' | 'csv' | 'xlsx'

export const EXPORT_LABEL: Readonly<Record<ExportKind, string>> = { photo: '사진으로 저장하기', csv: 'CSV 파일로 저장하기', xlsx: '엑셀 파일로 저장하기' }

const MIME: Readonly<Record<ExportKind, string>> = {
  photo: 'image/jpeg',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function ExportRows({ busy, save }: { busy: ExportKind | null; save: (kind: ExportKind) => void }) {
  return <>{(['photo', 'csv', 'xlsx'] as const).map(kind => (
    <MenuRow key={kind} title={EXPORT_LABEL[kind]} busy={busy === kind} disabled={busy !== null && busy !== kind} onPress={() => save(kind)} />
  ))}</>
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

export interface SendNotice {
  readonly text: string
  readonly tone: 'success' | 'danger'
}

/**
 * [정산서 보내기] 창과 (번호를 모를 때) 번호 칸 창. 결과 한 줄은 onNotice로 — 부르는 화면이 [정산서 보내기] 곁에 알린다.
 * onSent: 문자를 보냈다(보냄 표시를 적었다) — 상세·목록을 다시 받는다.
 */
export function OrderSendSheet({ visible, date, buyer, name, sealed, onClose, onNotice, onSent }: { readonly visible: boolean; readonly date: string; readonly buyer: string; readonly name: string; readonly sealed: boolean; readonly onClose: () => void; readonly onNotice: (notice: SendNotice | null) => void; readonly onSent: () => void }) {
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 문자 보낼 수 있는 서버인지·손님 번호를 아는지 — 영수증 보내기 화면과 같은 줄
  const { data: receipts, error: receiptsError, reload: reloadReceipts } = useCachedGet<ReceiptBuyers>(`/api/days/${date}/receipt-buyers`)
  const smsReady = receipts?.smsReady === true
  const receiptRow = receipts?.buyers.find((row) => row.buyer === buyer)
  const smsDevice = useSmsDevice(smsReady && !sealed)
  const sms = useReceiptSms(date, buyer, () => {
    onNotice({ text: '문자를 보냈어요.', tone: 'success' })
    void reloadReceipts()
    onSent()
  })
  const smsKnown = receipts !== null || receiptsError !== null
  const canSms = smsReady && smsDevice === true && !sealed
  const smsOff = smsKnown && (!smsReady || smsDevice === false || sealed)

  const sendSms = async () => {
    onNotice(null)
    onClose()
    await wait(SHEET_GONE_MS)
    // 번호를 모르는 손님은 번호부터 (영수증 보내기 화면과 같다) — 서버가 모른다고 답해도(NO_PHONE) 번호 칸을 연다
    if (receiptRow?.sms != null && receiptRow.sms.last4 === null) sms.openSheet()
    else await sms.send(null)
  }

  const save = async (kind: ExportKind) => {
    if (busy !== null) return
    setBusy(kind)
    setError(null)
    onNotice(null)
    try {
      const { bytes } = await withRetry(() => getBytes(exportPath(kind, date, buyer)))
      onClose()
      await wait(SHEET_GONE_MS)
      try {
        await nativeShareFile()(bytes, exportFileName(kind, date), MIME[kind])
      } catch {
        onNotice({ text: EXPORT_FAILED, tone: 'danger' })
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
  // 문자 흐름의 실패 한 줄 (번호 창이 닫혀 있을 때) — 옛 "링크 보내기로" 안내 대신 이 창의 말
  const smsProblem = sms.sheet ? null : sms.error !== null ? (sms.error === SMS_UNAVAILABLE ? SMS_OFF : sms.error) : sms.photoError
  useEffect(() => {
    if (smsProblem !== null) onNotice({ text: smsProblem, tone: 'danger' })
    // onNotice는 부르는 화면의 setState(바뀌지 않는다) — 바뀐 실패 글만 넘긴다
  }, [smsProblem, onNotice])
  return (
    <>
      <BottomSheet visible={visible} onClose={close} title={SEND_TITLE} description={SEND_NOTE} testID="order-send">
        <View style={{ gap: SPACE.xs }}>
          <View style={{ marginHorizontal: -SPACE.xl }}>
            <MenuRow
              title={SMS_ROW}
              {...(smsOff ? { sub: SMS_OFF } : {})}
              busy={!smsKnown || (smsReady && smsDevice === null && !sealed) || sms.busy}
              disabled={!canSms}
              onPress={() => void sendSms()}
            />
            <ExportRows busy={busy} save={kind => void save(kind)} />
          </View>
          {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
        </View>
      </BottomSheet>
      {/* 번호를 모르는 손님에게 문자 — 번호를 넣고 문자 앱을 연다 (영수증 보내기 화면과 같은 판) */}
      <BottomSheet
        visible={sms.sheet}
        title={`${name}님에게 ${SMS_SEND}`}
        onClose={sms.closeSheet}
        actions={<BigButton label={SMS_OPEN} busy={sms.busy} disabled={sms.phone.replace(/\D/g, '').length < 10} onPress={() => void sms.send(sms.phone)} />}
      >
        <TextField label={SMS_PHONE_LABEL} help={SMS_PHONE_HELP} error={sms.phoneError} value={sms.phone} onChangeText={sms.setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={20} />
        <Txt step="caption" color="textSub">{SMS_NOTE}</Txt>
        {sms.photoError !== null ? <Notice tone="danger" alert>{sms.photoError}</Notice> : null}
      </BottomSheet>
    </>
  )
}

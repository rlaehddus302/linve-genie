// 확인서 문자 보내기 흐름 (D-REAL-05·13): 서버에서 번호·글을 받고 → 확인서 사진(JPG)을 받고 → 판매자 문자 앱을 채워 열고 → 보냈으면 보냄 표시.
// 영수증 보내기 화면(ReceiptsScreen)과 손님 자세히의 다음 할 일 카드(D-UX4-123)가 같이 쓴다 — 두 곳이 같은 길로 보낸다.
// 사진을 못 받으면 글만으로 문자 앱을 열지 않는다(D-REAL-13). 번호를 모르는 손님은 서버가 409 NO_PHONE으로 답한다 — 그때 번호를 묻는다.
import { useEffect, useState } from 'react'
import { SMS_PHOTO_FAILED, SMS_SENT, SMS_UNAVAILABLE } from '@livejjim/web/src/lib/receipt-sms.ts'
import { getBytes, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { nativeSms } from '../native/index.ts'
import type { SmsImage } from '../native/sms.ts'

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** 시트·문자 창이 닫히는 동안 다음 창을 띄우지 않게 (아이폰은 창이 겹치면 열리지 않는다) */
export const SHEET_GAP_MS = 450

export interface SmsDraft {
  readonly phone: string
  readonly text: string
}

/** 서버에서 받는 번호·글(가게 이름·금액·입금 계좌 — 링크 없음, D-REAL-13)을 받는다 (D-REAL-05). 번호를 넣으면 기억한다 */
export async function prepareSms(date: string, buyer: string, phone: string | null): Promise<SmsDraft> {
  const requestId = newRequestId()
  const result = await withRetry(() => post<{ sms: SmsDraft }>(`/api/days/${date}/receipt-sms/prepare`, { requestId, buyer, ...(phone === null ? {} : { phone }) }))
  return result.sms
}

/** 확인서 사진을 못 받았다 — 글만으로 문자 앱을 열지 않는다 */
export class SmsPhotoError extends Error {}

/** 손님 확인서 사진(JPG, "이미지" 단추와 같은 것)을 받는다 (D-REAL-13) */
export async function receiptPhoto(date: string, buyer: string): Promise<SmsImage> {
  try {
    const { bytes } = await withRetry(() => getBytes(withQuery(`/api/days/${date}/receipt.jpg`, { buyer, rehearsal: false })))
    if (bytes.length === 0) throw new SmsPhotoError()
    return { bytes, name: `receipt-${date}.jpg` }
  } catch {
    throw new SmsPhotoError()
  }
}

/** 문자를 못 열었을 때 한 줄: 사진을 못 받았으면 다시 누르라고, 서버가 막았으면 그 말, 그 밖엔 이 기기에서 못 보냄 */
export const smsFailWords = (caught: unknown): string => (caught instanceof SmsPhotoError ? SMS_PHOTO_FAILED : isApiError(caught) ? caught.message : SMS_UNAVAILABLE)

/** 문자 앱을 손님 번호·글·확인서 사진으로 채워 열고, 보냈으면 보냄 표시 (안드로이드는 결과를 알 수 없어 열고 돌아오면 보낸 것으로) */
export async function composeSms(date: string, buyer: string, draft: SmsDraft, photo: SmsImage): Promise<'sent' | 'cancelled'> {
  const result = await nativeSms().compose(draft.phone, draft.text, photo)
  if (result === 'cancelled') return 'cancelled'
  const requestId = newRequestId()
  await withRetry(() => post(`/api/days/${date}/receipt-sms/sent`, { requestId, buyer }))
  return 'sent'
}

/** 이 기기에서 문자를 보낼 수 있나 (서버가 문자 칸을 줄 때만 묻는다) */
export function useSmsDevice(wanted: boolean): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!wanted || ok !== null) return
    let live = true
    void nativeSms()
      .available()
      .then((value) => {
        if (live) setOk(value)
      })
    return () => {
      live = false
    }
  }, [wanted, ok])
  return ok
}

/**
 * 손님 한 명에게 확인서 문자 (손님 자세히 다음 할 일 카드, D-UX4-123) — 영수증 보내기 화면의 [문자 보내기]와 같은 흐름:
 * 번호·글 받기 → 사진 받기 → (번호 시트가 열려 있으면 닫고 잠깐 기다림) → 문자 앱 열기 → 보냈으면 보냄 표시.
 * 서버가 번호를 모른다(409 NO_PHONE)고 하면 번호 시트를 연다. 사진을 못 받으면 문자 앱을 열지 않고 그 자리(시트 안이면 시트 안)에 알린다.
 */
export function useReceiptSms(date: string, buyer: string, onSent: () => void) {
  const [sheet, setSheet] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const send = async (typed: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    setPhoneError(null)
    setPhotoError(null)
    try {
      const draft = await prepareSms(date, buyer, typed)
      const photo = await receiptPhoto(date, buyer)
      if (sheet) {
        setSheet(false)
        setPhone('')
        await wait(SHEET_GAP_MS)
      }
      const outcome = await composeSms(date, buyer, draft, photo)
      if (outcome === 'sent') {
        setResult(SMS_SENT)
        onSent()
      }
    } catch (caught: unknown) {
      if (caught instanceof SmsPhotoError) {
        setPhotoError(SMS_PHOTO_FAILED)
        return
      }
      if (!isApiError(caught)) {
        setError(SMS_UNAVAILABLE)
        return
      }
      if (caught.code === 'NO_PHONE') {
        setSheet(true)
      } else if (sheet) {
        setPhoneError(caught.message)
      } else {
        setError(caught.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    sheet,
    phone,
    setPhone,
    phoneError,
    photoError,
    error,
    result,
    send,
    openSheet: () => setSheet(true),
    closeSheet: () => setSheet(false),
  }
}

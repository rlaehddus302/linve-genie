// 앱 안 우체국 화면 (D-UX3-37): 계약 없이 인터넷우체국에 직접 접수한다 — 들고 가기(창구소포 간편사전접수)·가지러 오기(방문접수소포).
// 라이브찜은 보내는 분·받는 분 입력과 송장번호 찾기만 한다. 비밀번호·동의·[신청]·결제는 판매자가 우체국 화면에서 직접 누른다.
// 찾은 송장번호는 판매자가 확인한 뒤에만 서버에 적는다(/direct — 접수함·배송 완료).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, ScrollView, View } from 'react-native'
import {
  EPOST_FIND,
  EPOST_FIND_NONE,
  EPOST_FOUND_HOW,
  EPOST_KIND_LABEL,
  EPOST_LOADING,
  EPOST_NEED_DATE,
  EPOST_NO_SENDER,
  EPOST_POPUP,
  EPOST_REFILL,
  EPOST_SAFARI,
  EPOST_STEP,
  EPOST_UPLOAD_FAILED,
  epostCounterAdded,
  epostCounterExisting,
  epostCounterSkipped,
  epostFound,
  epostFoundSave,
  epostSaved,
  epostUnmatched,
  epostUploaded,
  epostUploading,
} from '@livejjim/web/src/lib/parcel-words.ts'
import type { BookResponse } from '@livejjim/web/src/api/parcel-types.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { EpostWeb, type EpostWebHandle } from '../epost/EpostWeb.tsx'
import { EPOST_COUNTER_PAGE, EPOST_VISIT_PAGE, type EpostDirectKind, type EpostKit } from '../epost/kit.ts'
import { matchInvoices, type InvoiceMatch } from '../epost/match.ts'
import { ROWS_SCRIPT, counterFillScript, visitFillScript } from '../epost/scripts.ts'
import { AppHeader, BigButton, BottomSheet, ButtonRow, SmallButton, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

type Status = { readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly text: string } | null

/** 우체국 화면 주소 → 어느 입력 화면인지 */
export function epostPageOf(url: string): 'VISIT' | 'COUNTER' | null {
  if (url.includes('general.RetrieveGeneralNewGubun.parcel')) return 'VISIT'
  if (url.includes('commonpostplus.ParcelRetrieveAcceptPlus.postal')) return 'COUNTER'
  return null
}

export function EpostScreen({ date, kind, onBack }: { readonly date: string; readonly kind: EpostDirectKind; readonly onBack: () => void }) {
  const [kit, setKit] = useState<EpostKit | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [found, setFound] = useState<{ matches: InvoiceMatch[]; unmatched: string[] } | null>(null)
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Status>(null)
  const web = useRef<EpostWebHandle>(null)
  const url = useRef<string>(kind === 'VISIT' ? EPOST_VISIT_PAGE : EPOST_COUNTER_PAGE)
  const manual = useRef(false)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    get<{ kit: EpostKit }>(`/api/parcels/days/${date}/epost-kit`)
      .then((body) => {
        if (live) setKit(body.kit)
      })
      .catch((caught: unknown) => {
        if (!isApiError(caught)) throw caught
        if (live) setLoadError(caught)
      })
    return () => {
      live = false
    }
  }, [date])

  const fill = useCallback(() => {
    if (kit === null) return
    const page = epostPageOf(url.current)
    if (page === 'VISIT' && kind === 'VISIT') web.current?.inject(visitFillScript(kit))
    else if (page === 'COUNTER' && kind === 'COUNTER') web.current?.inject(counterFillScript(kit))
  }, [kit, kind])

  const scan = (byHand: boolean) => {
    manual.current = byHand
    web.current?.inject(ROWS_SCRIPT)
  }

  const onMessage = (data: string) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    if (message.type === 'fill') {
      if (message.ok === true && message.sender === false) setStatus({ tone: 'warning', text: EPOST_NO_SENDER })
      else if (message.step === 'need-date') setStatus({ tone: 'info', text: EPOST_NEED_DATE })
      else if (typeof message.existing === 'number') setStatus({ tone: 'info', text: epostCounterExisting(message.existing) })
      else if (typeof message.added === 'number') {
        const skipped = typeof message.skipped === 'number' ? message.skipped : 0
        const text = [epostCounterAdded(message.added), ...(skipped > 0 ? [epostCounterSkipped(skipped)] : [])].join('\n')
        setStatus({ tone: skipped > 0 ? 'warning' : 'success', text })
      }
    } else if (message.type === 'upload') {
      const count = kit?.receivers.length ?? 0
      if (message.step === 'start') setStatus({ tone: 'info', text: epostUploading(count) })
      else if (message.ok === true) setStatus({ tone: 'success', text: epostUploaded(count) })
      else setStatus({ tone: 'danger', text: EPOST_UPLOAD_FAILED })
    } else if (message.type === 'rows' && kit !== null) {
      const rows = Array.isArray(message.rows) ? message.rows.filter((row): row is string => typeof row === 'string') : []
      const result = matchInvoices(rows, kit.receivers)
      const byHand = manual.current
      manual.current = false
      if (result.matches.length > 0) {
        setFound(result)
        if (byHand) setAsking(true)
      } else if (byHand) setStatus({ tone: 'warning', text: EPOST_FIND_NONE })
    }
  }

  const save = async () => {
    if (found === null || saving) return
    pending.current ??= newRequestId()
    const requestId = pending.current
    setSaving(true)
    try {
      const body = await withRetry(() => post<BookResponse>(`/api/parcels/days/${date}/direct`, { requestId, kind, items: found.matches.map((match) => ({ buyer: match.buyer, invoice: match.invoice })) }))
      pending.current = null
      const okCount = body.results.filter((result) => result.ok).length
      const failed = body.results.filter((result) => !result.ok)
      setSaved(failed.length === 0 ? { tone: 'success', text: epostSaved(okCount) } : { tone: 'warning', text: [epostSaved(okCount), ...failed.map((result) => ('message' in result ? result.message : ''))].join('\n') })
      setFound(null)
      setAsking(false)
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      pending.current = null
      setSaved({ tone: 'danger', text: caught.message })
      setAsking(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={EPOST_KIND_LABEL[kind]} onBack={onBack} right={<SmallButton label={EPOST_SAFARI} onPress={() => void Linking.openURL(url.current)} />} />
      <View style={{ gap: SPACE.xs, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }}>
        <Txt step="caption" color="textSub">{EPOST_STEP[kind]}</Txt>
        {status !== null ? <Notice tone={status.tone}>{status.text}</Notice> : null}
        {saved !== null ? <Notice tone={saved.tone} alert={saved.tone === 'danger'}>{saved.text}</Notice> : null}
        {found !== null && !asking ? (
          <ButtonRow>
            <BigButton kind="outline" label="나중에" onPress={() => setFound(null)} />
            <BigButton label={epostFound(found.matches.length)} onPress={() => setAsking(true)} />
          </ButtonRow>
        ) : null}
      </View>
      {loadError !== null ? (
        <View style={{ padding: SPACE.lg }}>
          <Notice tone="danger" alert>{loadError.message}</Notice>
        </View>
      ) : kit === null ? (
        <Loading text={EPOST_LOADING} />
      ) : (
        <EpostWeb
          ref={web}
          uri={url.current}
          onMessage={onMessage}
          onPopup={() => setStatus({ tone: 'warning', text: EPOST_POPUP })}
          onLoaded={(next) => {
            url.current = next
            fill()
            scan(false)
          }}
        />
      )}
      {kit !== null ? (
        <View style={{ padding: SPACE.md }}>
          <ButtonRow>
            <BigButton kind="outline" label={EPOST_REFILL} onPress={fill} />
            <BigButton label={EPOST_FIND} onPress={() => scan(true)} />
          </ButtonRow>
        </View>
      ) : null}
      <BottomSheet
        visible={asking && found !== null}
        onClose={() => setAsking(false)}
        title={found === null ? '' : epostFound(found.matches.length)}
        actions={
          <>
            <BigButton kind="secondary" label="닫기" onPress={() => setAsking(false)} />
            <BigButton label={epostFoundSave(found?.matches.length ?? 0)} busy={saving} onPress={() => void save()} />
          </>
        }
      >
        <ScrollView style={{ maxHeight: 320 }}>
          <View style={{ gap: SPACE.xs }}>
            <Txt color="textSub">{EPOST_FOUND_HOW}</Txt>
            {found?.matches.map((match) => (
              <Txt key={match.buyer}>{`${match.name} · ${match.invoice}`}</Txt>
            ))}
            {found !== null && found.unmatched.length > 0 ? <Txt step="caption" color="textSub">{epostUnmatched(found.unmatched.length)}</Txt> : null}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  )
}

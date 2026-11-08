// 앱 안 우체국 화면 (D-UX3-37): 계약 없이 인터넷우체국에 직접 접수한다 — 들고 가기(창구소포 간편사전접수)·가지러 오기(방문접수소포).
// 라이브찜은 동의 체크(들고 가기)·보내는 분·받는 분 입력과 송장번호 찾기만 한다. 비밀번호·[신청]·결제는 판매자가 우체국 화면에서 직접 한다(D-UX3-40).
// 보내는 분 설정이 없으면 이 화면에서 바로 넣어 설정에 저장하고 다시 채운다.
// 찾은 송장번호는 판매자가 확인한 뒤에만 서버에 적는다(/direct — 접수함·배송 완료).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, ScrollView, View } from 'react-native'
import {
  EPOST_AGREED,
  EPOST_AGREE_NEXT,
  EPOST_FIND,
  EPOST_FIND_NONE,
  EPOST_FOUND_HOW,
  EPOST_KIND_LABEL,
  EPOST_LOADING,
  EPOST_NEED_DATE,
  EPOST_NO_SENDER,
  EPOST_PAGE_CHANGED,
  EPOST_POPUP,
  EPOST_REFILL,
  EPOST_SAFARI,
  EPOST_SENDER_ADD,
  EPOST_SENDER_HOW,
  EPOST_SENDER_SAVED,
  EPOST_SENDER_TITLE,
  SENDER_KEYS,
  SENDER_LABELS,
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
import type { BookResponse, ParcelSender, ParcelSettings } from '@livejjim/web/src/api/parcel-types.ts'
import { get, isApiError, newRequestId, post, put, withRetry, type ApiError } from '../api/client.ts'
import { EpostWeb, type EpostWebHandle } from '../epost/EpostWeb.tsx'
import { EPOST_COUNTER_PAGE, EPOST_VISIT_PAGE, type EpostDirectKind, type EpostKit } from '../epost/kit.ts'
import { matchInvoices, type InvoiceMatch } from '../epost/match.ts'
import { COUNTER_AGREE_SCRIPT, ROWS_SCRIPT, counterFillScript, visitFillScript } from '../epost/scripts.ts'
import { AppHeader, BigButton, BottomSheet, ButtonRow, SmallButton, TextField, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

type Status = { readonly tone: 'info' | 'success' | 'warning' | 'danger'; readonly text: string } | null

/** 우체국 화면 주소 → 어느 입력 화면인지 */
export function epostPageOf(url: string): 'VISIT' | 'COUNTER' | 'COUNTER_AGREE' | null {
  if (url.includes('general.RetrieveGeneralNewGubun.parcel')) return 'VISIT'
  if (url.includes('commonpostplus.ParcelRetrieveAcceptPlusAgree.postal')) return 'COUNTER_AGREE'
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
  const [senderOpen, setSenderOpen] = useState(false)
  const [kitVersion, setKitVersion] = useState(0)
  const web = useRef<EpostWebHandle>(null)
  const url = useRef<string>(kind === 'VISIT' ? EPOST_VISIT_PAGE : EPOST_COUNTER_PAGE)
  const manual = useRef(false)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    get<{ kit: EpostKit }>(`/api/parcels/days/${date}/epost-kit`)
      .then((body) => {
        if (!live) return
        setKit(body.kit)
        if (body.kit.sender === null) {
          setStatus({ tone: 'warning', text: EPOST_NO_SENDER })
          setSenderOpen(true)
        }
      })
      .catch((caught: unknown) => {
        if (!isApiError(caught)) throw caught
        if (live) setLoadError(caught)
      })
    return () => {
      live = false
    }
  }, [date, kitVersion])

  const fill = useCallback(() => {
    if (kit === null) return
    const page = epostPageOf(url.current)
    if (page === 'VISIT' && kind === 'VISIT') web.current?.inject(visitFillScript(kit))
    else if (page === 'COUNTER_AGREE' && kind === 'COUNTER') web.current?.inject(COUNTER_AGREE_SCRIPT)
    else if (page === 'COUNTER' && kind === 'COUNTER') web.current?.inject(counterFillScript(kit))
  }, [kit, kind])

  // 보내는 분을 저장해 자료를 다시 받으면 지금 화면에 다시 채운다
  const loaded = useRef(false)
  useEffect(() => {
    if (kit !== null && loaded.current) fill()
  }, [kit, fill])

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
    if (message.type === 'agree') {
      if (message.ok === true) setStatus({ tone: 'info', text: EPOST_AGREED })
      else if (message.step === 'next') setStatus({ tone: 'info', text: EPOST_AGREE_NEXT })
      else if (message.ok === false) setStatus({ tone: 'warning', text: EPOST_PAGE_CHANGED })
    } else if (message.type === 'fill') {
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
        {kit !== null && kit.sender === null ? <BigButton kind="outline" label={EPOST_SENDER_ADD} onPress={() => setSenderOpen(true)} /> : null}
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
            loaded.current = true
            if (next.startsWith('https://m.epost.go.kr/')) setStatus({ tone: 'warning', text: EPOST_PAGE_CHANGED })
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
      {senderOpen ? (
        <SenderSheet
          onClose={() => setSenderOpen(false)}
          onSaved={() => {
            setSenderOpen(false)
            setStatus({ tone: 'success', text: EPOST_SENDER_SAVED })
            setKitVersion((version) => version + 1)
          }}
        />
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

/** 보내는 분 넣기 (설정 "택배"의 보내는 사람과 같은 칸·같은 저장 — PUT /api/parcels/settings { sender }) */
function SenderSheet({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: () => void }) {
  const [draft, setDraft] = useState<ParcelSender | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    get<{ settings: ParcelSettings }>('/api/parcels/settings')
      .then((body) => {
        if (live) setDraft(body.settings.sender ?? { name: body.settings.shopName, phone: '', address: '', detail: '', zip: '' })
      })
      .catch((caught: unknown) => {
        if (!isApiError(caught)) throw caught
        if (live) {
          setError(caught)
          setDraft({ name: '', phone: '', address: '', detail: '', zip: '' })
        }
      })
    return () => {
      live = false
    }
  }, [])
  const save = async () => {
    if (draft === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await withRetry(() => put<{ settings: ParcelSettings }>('/api/parcels/settings', { sender: draft }))
      onSaved()
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const fieldProblem = (key: keyof ParcelSender) => error?.problemFor(`sender.${key}`)?.message ?? null
  const shownInFields = SENDER_KEYS.some((key) => fieldProblem(key) !== null)
  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={EPOST_SENDER_TITLE}
      actions={
        <>
          <BigButton kind="secondary" label="닫기" onPress={onClose} />
          <BigButton label="저장" busy={busy} disabled={draft === null} onPress={() => void save()} />
        </>
      }
    >
      <View style={{ gap: SPACE.md }}>
        <Txt color="textSub">{EPOST_SENDER_HOW}</Txt>
        {draft === null ? (
          <Loading />
        ) : (
          SENDER_KEYS.map((key) => (
            <TextField
              key={key}
              label={SENDER_LABELS[key]}
              value={draft[key]}
              onChangeText={(text) => setDraft((now) => (now === null ? now : { ...now, [key]: text }))}
              keyboardType={key === 'phone' || key === 'zip' ? 'number-pad' : 'default'}
              inputMode={key === 'phone' || key === 'zip' ? 'numeric' : 'text'}
              autoComplete="off"
              autoCorrect={false}
              error={fieldProblem(key)}
            />
          ))
        )}
        {error !== null && !shownInFields ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}

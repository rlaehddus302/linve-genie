// 직접 넣은 택배 (D-UX3-38 — 웹 ParcelExtra와 같은 규칙·문구): 방송 판매 기록 없이 받는 분·물품 수를 적어 그 날짜 접수 목록에 넣는다.
// 택배 화면 위 칸 [받는 분 넣기] → 아래 창(여섯 칸 + 물품 수) → 저장. 직접 넣은 줄은 "물품 N개 · 직접 넣음"과 [지우기](왼쪽)·[고치기](오른쪽).
// 쓰기는 같은 내용이면 같은 요청 번호(끊기면 같은 번호로 다시). 받는 분 이름·주소는 글자로만 그린다.
// 토스식 다듬기 (D-UX3-94): 위 칸은 회색 묶음 이름 + 줄 하나([받는 분 넣기] · 날짜 · ›, 긴 안내 글 뺌), 줄 단추는 작은 회색 단추.
import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { AddressFields, BundleView, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import {
  ADDRESS_KEYS,
  ADDRESS_LABELS,
  EMPTY_ADDRESS,
  EXTRA_ADD,
  EXTRA_DELETE,
  EXTRA_DELETE_QUESTION,
  EXTRA_DELETED,
  EXTRA_EDIT,
  EXTRA_EDITED,
  EXTRA_QTY_LABEL,
  EXTRA_SAVED,
  EXTRA_TITLE,
  extraDateNote,
  extraDeleteDescription,
  extraFacts,
} from '@livejjim/web/src/lib/parcel-words.ts'
import { get, isApiError, newRequestId, post, put, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { BigButton, BottomSheet, Card, ConfirmSheet, Icon, TextField, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { RowAction, RowActions } from './ParcelAddress.tsx'

export interface ExtraDraft extends AddressFields {
  readonly qty: string
}

export const EMPTY_EXTRA: ExtraDraft = { ...EMPTY_ADDRESS, qty: '1' }

/** 보낼 본문: 여섯 칸 + 물품 수 (수가 아니면 글 그대로 보내 서버 문장을 받는다) */
export function extraBody(draft: ExtraDraft, buyer: string | null): Record<string, unknown> {
  const { qty, ...address } = draft
  return { ...(buyer === null ? {} : { buyer }), address, qty: /^[0-9]{1,4}$/.test(qty.trim()) ? Number(qty.trim()) : qty }
}

/** 같은 내용이면 같은 요청 번호 */
function useExtraCommand() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const running = useRef(false)
  const send = async <T,>(method: 'POST' | 'PUT', path: string, body: Readonly<Record<string, unknown>>): Promise<T | null> => {
    if (running.current) return null
    const key = JSON.stringify([method, path, body])
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const payload = { requestId: pending.current.requestId, ...body }
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => (method === 'PUT' ? put<T>(path, payload) : post<T>(path, payload)))
      pending.current = null
      return result
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setError(caught)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { busy, error, send, clearError: () => setError(null) }
}

/** 받는 분 넣기·고치기 창 — 칸마다 서버 문장 */
function ExtraSheet({ title, initial, busy, error, onClose, onSave }: { readonly title: string; readonly initial: ExtraDraft; readonly busy: boolean; readonly error: ApiError | null; readonly onClose: () => void; readonly onSave: (draft: ExtraDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<ExtraDraft>(initial)
  const fieldProblem = (key: keyof AddressFields) => error?.problemFor(`address.${key}`)?.message ?? null
  const qtyProblem = error?.problemFor('qty')?.message ?? null
  const shownInFields = qtyProblem !== null || ADDRESS_KEYS.some((key) => fieldProblem(key) !== null)
  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={title}
      actions={<BigButton label="저장" busy={busy} onPress={() => void onSave(draft)} />}
    >
      <View style={{ gap: SPACE.md }}>
        {ADDRESS_KEYS.map((key) => (
          <TextField
            key={key}
            label={ADDRESS_LABELS[key]}
            value={draft[key]}
            onChangeText={(value) => setDraft((now) => ({ ...now, [key]: value }))}
            keyboardType={key === 'phone' || key === 'zip' ? 'number-pad' : 'default'}
            inputMode={key === 'phone' || key === 'zip' ? 'numeric' : 'text'}
            autoComplete="off"
            autoCorrect={false}
            error={fieldProblem(key)}
          />
        ))}
        <TextField label={EXTRA_QTY_LABEL} value={draft.qty} unit="개" onChangeText={(value) => setDraft((now) => ({ ...now, qty: value }))} keyboardType="number-pad" inputMode="numeric" autoComplete="off" error={qtyProblem} />
        {error !== null && !shownInFields ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}

/** 택배 화면 위 칸: 안내 + [받는 분 넣기] → 저장하면 onSaved(날짜) */
export function ExtraCard({ date, onSaved }: { readonly date: string; readonly onSaved: (date: string) => void }) {
  const command = useExtraCommand()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const save = async (draft: ExtraDraft) => {
    setDone(null)
    const result = await command.send<{ bundle: BundleView }>('PUT', `/api/parcels/days/${date}/extra`, extraBody(draft, null))
    if (result === null) return
    setOpen(false)
    setDone(EXTRA_SAVED)
    onSaved(date)
  }
  const { p } = useKit()
  return (
    <Card label={EXTRA_TITLE}>
      <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
        {EXTRA_TITLE}
      </Txt>
      <Tap
        role="button"
        aria-label={EXTRA_ADD}
        onPress={() => {
          setDone(null)
          command.clearError()
          setOpen(true)
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min, marginHorizontal: -SPACE.sm, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
      >
        <View aria-hidden style={{ width: 34, height: 34, borderRadius: 17, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" color={p.textSub} size={18} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt step="bodyLarge" weight="book">{EXTRA_ADD}</Txt>
          <Txt step="caption" color="textSub">{extraDateNote(date)}</Txt>
        </View>
        <Icon name="chevron" color={p.textSub} size={18} />
      </Tap>
      {done !== null ? <Notice tone="success">{done}</Notice> : null}
      {command.error !== null && !open ? <Notice tone="danger" alert>{command.error.message}</Notice> : null}
      {open ? (
        <ExtraSheet
          title={EXTRA_TITLE}
          initial={EMPTY_EXTRA}
          busy={command.busy}
          error={command.error}
          onClose={() => {
            setOpen(false)
            command.clearError()
          }}
          onSave={save}
        />
      ) : null}
    </Card>
  )
}

/** 직접 넣은 줄의 사실 한 줄 */
export function ExtraFacts({ row }: { readonly row: ParcelRow }) {
  return (
    <Txt step="caption" color="textSub">
      {extraFacts(row.qty)}
    </Txt>
  )
}

/** 직접 넣은 줄의 [지우기]·[고치기] (접수 전 줄에만 — 접수한 줄은 접수 취소가 먼저) */
export function ExtraRowActions({ date, row, disabled, onChanged }: { readonly date: string; readonly row: ParcelRow; readonly disabled: boolean; readonly onChanged: () => void }) {
  const command = useExtraCommand()
  const [ask, setAsk] = useState<'edit' | 'delete' | null>(null)
  const [initial, setInitial] = useState<ExtraDraft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const edit = async () => {
    setDone(null)
    setLoadError(null)
    command.clearError()
    try {
      const { bundle } = await get<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer: row.buyer }))
      const address = bundle.address
      setInitial({ ...(address === null ? EMPTY_ADDRESS : { name: address.name, phone: address.phone, address: address.address, detail: address.detail, zip: address.zip, memo: address.memo }), qty: String(bundle.row.qty) })
      setAsk('edit')
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setLoadError(caught.message)
    }
  }
  const save = async (draft: ExtraDraft) => {
    const result = await command.send<{ bundle: BundleView }>('PUT', `/api/parcels/days/${date}/extra`, extraBody(draft, row.buyer))
    if (result === null) return
    setAsk(null)
    setDone(EXTRA_EDITED)
    onChanged()
  }
  const remove = async () => {
    const result = await command.send<{ buyer: string }>('POST', `/api/parcels/days/${date}/extra/delete`, { buyer: row.buyer })
    if (result === null) return
    setAsk(null)
    setDone(EXTRA_DELETED)
    onChanged()
  }
  return (
    <View style={{ gap: SPACE.xs }}>
      <RowActions>
        <RowAction
          label={EXTRA_DELETE}
          ariaLabel={`${row.name} ${EXTRA_DELETE}`}
          disabled={disabled || command.busy}
          onPress={() => {
            setDone(null)
            command.clearError()
            setAsk('delete')
          }}
        />
        <RowAction label={EXTRA_EDIT} ariaLabel={`${row.name} ${EXTRA_EDIT}`} disabled={disabled || command.busy} onPress={() => void edit()} />
      </RowActions>
      {done !== null ? <Notice tone="success">{done}</Notice> : null}
      {loadError !== null ? <Notice tone="danger" alert>{loadError}</Notice> : null}
      {command.error !== null && ask === null ? <Notice tone="danger" alert>{command.error.message}</Notice> : null}
      {ask === 'edit' && initial !== null ? (
        <ExtraSheet
          title={`${row.name} ${EXTRA_EDIT}`}
          initial={initial}
          busy={command.busy}
          error={command.error}
          onClose={() => {
            setAsk(null)
            command.clearError()
          }}
          onSave={save}
        />
      ) : null}
      <ConfirmSheet
        visible={ask === 'delete'}
        question={EXTRA_DELETE_QUESTION}
        description={`${extraDeleteDescription(row.name)}${command.error !== null && ask === 'delete' ? `\n${command.error.message}` : ''}`}
        confirmLabel={EXTRA_DELETE}
        cancelLabel="닫기"
        danger
        busy={command.busy}
        onConfirm={() => void remove()}
        onCancel={() => {
          setAsk(null)
          command.clearError()
        }}
      />
    </View>
  )
}

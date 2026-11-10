// 정산 손님 자세히의 "배송지" 칸과 택배 꼬리표 (D-UX3-35 — 웹 ParcelParts.AddressSection과 같은 규칙·문구, PARCEL_RULES PC-3·PC-8, D-T1-06, AC-T1-65).
// - 없으면 "배송지가 없어요" + [배송지 적기] + 안내. 지난 주문 배송지(장부, KP1 CR-4)가 있으면 그 칸 + [고치기]·[배송지 확인].
// - 있으면 여섯 칸·출처·확인 꼬리표 + [지우기]·[고치기]·[배송지 확인](확인 전일 때). 살아 있는 접수가 있으면 고치지 못하고 "택배 접수를 먼저 취소해 주세요."
// - 택배사가 주소를 못 찾았다고 돌려보낸 묶음(우편번호 못 찾음 — D-REAL-09)도 여기서 고친다.
// - 쓰기는 누를 때 만든 요청 번호로, 끊기면 같은 번호로 다시 보낸다. 409(그 사이 구매자가 고침·접수됨)면 지금 모습을 다시 받는다.
// - 봉인한 날짜는 보기만. 이름·주소·메모는 글자로만 그린다. 연락처·주소는 주소창·로그에 넣지 않는다(본문으로만 보낸다).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import type { AddressFields, BundleView, ParcelBrief } from '@livejjim/web/src/api/parcel-types.ts'
import { PREFILL_CONFIRMED, PREFILL_HELP, PREFILL_TITLE } from '@livejjim/web/src/lib/ledger-words.ts'
import {
  ADDRESS_CONFIRMED,
  ADDRESS_DELETED,
  ADDRESS_EXPIRED,
  ADDRESS_KEYS,
  ADDRESS_LABELS,
  ADDRESS_SAVED,
  BUYER_CAN_WRITE,
  COMBINED_BUNDLE,
  EMPTY_ADDRESS,
  LOCKED_ADDRESS,
  NO_ADDRESS,
  PICKUP_BUNDLE,
  addressShape,
  checkedWords,
  confirmedWords,
  parcelLine,
  parcelTone,
  phoneWords,
  sourceWords,
} from '@livejjim/web/src/lib/parcel-words.ts'
import { isApiError, newRequestId, post, put, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { Appear, BigButton, BottomSheet, ButtonRow, Card, ConfirmSheet, Icon, TextField, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'
import { useCameLate } from '../ui/late.tsx'

/**
 * 글자만의 작은 단추 (D-UX3-94, 홈 "모두보기"처럼): 곁길 일("택배 화면으로", "다음 손님", "운송장 전부 PDF").
 * 회색 글자 + 작은 › — 누르는 동안 바탕만 옅게 진해진다. 포장·택배 화면이 같이 쓴다.
 */
export function TextAction({ label, ariaLabel, onPress, disabled, chevron = true, align = 'flex-end', strong = false }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly disabled?: boolean; readonly chevron?: boolean; readonly align?: 'flex-start' | 'flex-end' | 'center'; readonly strong?: boolean }) {
  const { p } = useKit()
  // strong: 흐름의 다음 걸음("다음 손님", "택배 접수") — 초록 글자로 조금 더 눈에 띄게
  const ink = strong ? p.primaryText : p.textSub
  return (
    <Tap role="button" aria-label={ariaLabel ?? label} aria-disabled={disabled === true} disabled={disabled === true} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ alignSelf: align, flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent', opacity: disabled === true ? 0.45 : 1 })}>
      <Txt step="body" weight={strong ? 'medium' : 'book'} ink={ink}>
        {label}
      </Txt>
      {chevron ? <Icon name="chevron" color={ink} size={16} /> : null}
    </Tap>
  )
}

/**
 * 줄 안의 작은 회색 단추 (D-UX3-94): 줄마다 붙는 일(운송장 PDF·접수 취소·고치기·지우기). 큰 단추를 줄마다 쌓지 않는다.
 * 높이 40·글자만큼 폭. 둘 이상이면 RowActions로 좌우에 — 부정(취소·지우기)이 왼쪽.
 */
export function RowAction({ label, ariaLabel, onPress, disabled, busy }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly disabled?: boolean; readonly busy?: boolean }) {
  const { p } = useKit()
  const off = disabled === true || busy === true
  return (
    <Tap role="button" aria-label={ariaLabel ?? label} aria-disabled={off} aria-busy={busy === true} disabled={off} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 40, paddingHorizontal: SPACE.md + 2, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed && !off ? p.softPressed : p.surfaceAlt, opacity: disabled === true ? 0.45 : 1 })}>
      {busy === true ? <ActivityIndicator size="small" color={p.textSub} /> : null}
      <Txt step="body" weight="medium">
        {label}
      </Txt>
    </Tap>
  )
}

/** 줄 단추 묶음: 왼쪽부터 한 줄에 (D-UX4-01) */
export function RowActions({ children }: { readonly children?: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'center' }}>{children}</View>
}

/** "택배: 배송 중 · 6013-0823-62377" 꼬리표 (색 + 글자) */
export function ParcelTag({ parcel }: { readonly parcel: ParcelBrief }) {
  return <Tag tone={parcelTone(parcel)}>{parcelLine(parcel)}</Tag>
}

/** 꼬리표 + 마지막 확인 시각 (있을 때) */
export function ParcelTagLine({ parcel }: { readonly parcel: ParcelBrief }) {
  const checked = checkedWords(parcel)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
      <ParcelTag parcel={parcel} />
      {checked !== null ? <Txt step="caption" color="textSub">{checked}</Txt> : null}
    </View>
  )
}

/** 같은 내용이면 같은 요청 번호 (끊겨서 다시 보내도 한 번만) */
function useAddressCommand() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const running = useRef(false)
  const send = async (method: 'POST' | 'PUT', path: string, body: Readonly<Record<string, unknown>>): Promise<BundleView | null> => {
    if (running.current) return null
    const key = JSON.stringify([method, path, body])
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const payload = { requestId: pending.current.requestId, ...body }
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await withRetry(() => (method === 'PUT' ? put<{ bundle: BundleView }>(path, payload) : post<{ bundle: BundleView }>(path, payload)))
      pending.current = null
      return result.bundle
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

type Ask = 'write' | 'edit' | 'delete' | null

/** 정산 손님 자세히의 배송지 칸. version이 바뀌면(택배·포장 알림, 다시 붙음) 다시 받는다 */
export function AddressCard({ date, buyer, sealed, version, plain = false }: { readonly date: string; readonly buyer: string; readonly sealed: boolean; readonly version: number; readonly plain?: boolean }) {
  const [attempt, setAttempt] = useState(0)
  const [ask, setAsk] = useState<Ask>(null)
  const [done, setDone] = useState<string | null>(null)
  const command = useAddressCommand()
  // 다시 열면 기억해 둔 배송지를 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: view, error: loadError, set: setView } = useCachedGet<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer }), `${String(version)}:${String(attempt)}`)
  const bundle = view?.bundle ?? null

  // 거절(그 사이 구매자가 고침·접수됨)이면 옛 내용으로 다시 누르지 않게 지금 모습을 다시 받는다
  useEffect(() => {
    if (command.error !== null && command.error.status === 409) setAttempt((n) => n + 1)
  }, [command.error])

  const apply = (next: BundleView | null, text: string): boolean => {
    if (next === null) return false
    // 쓰기 답이 더 새것 — 그 전에 떠난 받기의 답이 덮지 않는다(기억의 요청 순서)
    setView({ bundle: next })
    setDone(text)
    return true
  }
  const open = (next: Ask) => {
    setDone(null)
    command.clearError()
    setAsk(next)
  }
  const save = async (address: AddressFields) => {
    setDone(null)
    if (apply(await command.send('PUT', `/api/parcels/days/${date}/address`, { buyer, address }), ADDRESS_SAVED)) setAsk(null)
  }
  const confirm = async () => {
    if (bundle?.address == null) return
    setDone(null)
    apply(await command.send('POST', `/api/parcels/days/${date}/address/confirm`, { buyer, updatedAt: bundle.address.updatedAt }), ADDRESS_CONFIRMED)
  }
  const confirmLedger = async () => {
    const prefill = bundle?.ledger
    if (prefill == null) return
    setDone(null)
    apply(await command.send('POST', `/api/parcels/days/${date}/address/ledger`, { buyer, ledgerId: prefill.ledgerId, updatedAt: prefill.updatedAt }), PREFILL_CONFIRMED)
  }
  const remove = async () => {
    setDone(null)
    if (apply(await command.send('POST', `/api/parcels/days/${date}/address/delete`, { buyer }), ADDRESS_DELETED)) setAsk(null)
  }

  const late = useCameLate(bundle !== null)
  if (bundle === null) {
    return (
      <AddressFrame plain={plain}>
        <CardLabel plain={plain}>배송지</CardLabel>
        {loadError !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{loadError.message}</Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : (
          <Loading />
        )}
      </AddressFrame>
    )
  }

  const shape = addressShape(bundle)
  const address = bundle.address
  const parcel = bundle.row.parcel
  const ledger = bundle.ledger ?? null
  const editable = !sealed && !bundle.locked
  return (
    <AddressFrame plain={plain}>
      {/* 카드 이름은 홈 묶음 이름처럼 회색 본문 (D-UX3-94 — 옛: 굵은 제목) */}
      <CardLabel plain={plain}>배송지</CardLabel>
      {/* 서버에서 받은 뒤에야 생기는 배송지 내용은 부드럽게 — 기억해 둔 배송지로 처음부터 그리면 바로 (D-UX4-112) */}
      <Appear instant={!late} style={{ gap: SPACE.md }}>
        {parcel !== null ? <ParcelTagLine parcel={parcel} /> : null}
        {shape === 'pickup' ? <Txt>{PICKUP_BUNDLE}</Txt> : null}
        {shape === 'combined' ? <Txt>{COMBINED_BUNDLE}</Txt> : null}
        {shape === 'expired' ? <Txt>{ADDRESS_EXPIRED}</Txt> : null}

        {shape === 'none' && ledger !== null && !bundle.locked ? (
          <View style={{ gap: SPACE.sm }} aria-label={PREFILL_TITLE}>
            <Notice tone="warning">{PREFILL_TITLE}</Notice>
            <Facts fields={[['받는 분', ledger.name], ['연락처', phoneWords(ledger.phone)], ['주소', ledger.address], ['상세 주소', ledger.detail === '' ? '없음' : ledger.detail], ['우편번호', ledger.zip === '' ? '없음' : ledger.zip]]} />
            <Tag tone="warning">확인 전</Tag>
            <Txt step="caption" color="textSub">{PREFILL_HELP}</Txt>
            {!sealed ? (
              <ButtonRow>
                <BigButton kind="secondary" label="고치기" disabled={command.busy} onPress={() => open('write')} />
                <BigButton label="배송지 확인" disabled={command.busy} onPress={() => void confirmLedger()} />
              </ButtonRow>
            ) : null}
          </View>
        ) : null}

        {shape === 'none' && (ledger === null || bundle.locked) ? (
          <View style={{ gap: SPACE.sm }}>
            <Txt>{NO_ADDRESS}</Txt>
            {bundle.locked ? <Notice tone="info">{LOCKED_ADDRESS}</Notice> : null}
            {editable ? <BigButton kind="outline" label="배송지 적기" onPress={() => open('write')} /> : null}
            <Txt step="caption" color="textSub">{BUYER_CAN_WRITE}</Txt>
          </View>
        ) : null}

        {shape === 'shown' && address !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Facts
              fields={[
                [ADDRESS_LABELS.name, address.name],
                [ADDRESS_LABELS.phone, phoneWords(address.phone)],
                [ADDRESS_LABELS.address, address.address],
                [ADDRESS_LABELS.detail, address.detail === '' ? '없음' : address.detail],
                ['우편번호', address.zip === '' ? '없음' : address.zip],
                [ADDRESS_LABELS.memo, address.memo === '' ? '없음' : address.memo],
              ]}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
              <Txt step="caption" color="textSub">{sourceWords(address.source)}</Txt>
              <Tag tone={address.confirmed ? 'success' : 'warning'}>{confirmedWords(address.source, address.confirmed)}</Tag>
            </View>
            {bundle.locked ? <Notice tone="info">{LOCKED_ADDRESS}</Notice> : null}
            {editable ? (
              <View role="group" aria-label="배송지 고치기">
                <ButtonRow>
                  <BigButton kind="outline" label="지우기" disabled={command.busy} onPress={() => open('delete')} />
                  <BigButton kind={address.confirmed ? 'primary' : 'secondary'} label="고치기" disabled={command.busy} onPress={() => open('edit')} />
                  {!address.confirmed ? <BigButton label="배송지 확인" disabled={command.busy} onPress={() => void confirm()} /> : null}
                </ButtonRow>
              </View>
            ) : null}
          </View>
        ) : null}
      </Appear>

      {done !== null ? <Notice tone="success">{done}</Notice> : null}
      {command.error !== null && ask === null ? <Notice tone="danger" alert>{command.error.message}</Notice> : null}

      {ask === 'write' || ask === 'edit' ? (
        <AddressSheet
          title={ask === 'write' && ledger === null ? '배송지 적기' : '배송지 고치기'}
          initial={
            ask === 'edit' && address !== null
              ? { name: address.name, phone: address.phone, address: address.address, detail: address.detail, zip: address.zip, memo: address.memo }
              : ledger !== null
                ? { name: ledger.name, phone: ledger.phone, address: ledger.address, detail: ledger.detail, zip: ledger.zip, memo: '' }
                : EMPTY_ADDRESS
          }
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
        question="배송지를 지울까요?"
        description={`이 묶음의 배송지를 지워요. 지우면 되돌릴 수 없어요.${command.error !== null && ask === 'delete' ? `\n${command.error.message}` : ''}`}
        confirmLabel="지우기"
        danger
        busy={command.busy}
        onConfirm={() => void remove()}
        onCancel={() => {
          setAsk(null)
          command.clearError()
        }}
      />
    </AddressFrame>
  )
}

/**
 * 배송지 칸 틀: 흰 카드, plain이면 카드 없이 (주문 상세 — D-UX4-125, 사용자 지시 2026-11-11 "섹션 구분 다 없애고 전체 흰색 배경")
 */
function AddressFrame({ plain, children }: { readonly plain: boolean; readonly children: ReactNode }) {
  if (!plain) return <Card label="배송지">{children}</Card>
  return (
    <View role="group" aria-label="배송지" style={{ gap: SPACE.md }}>
      {children}
    </View>
  )
}

/** 카드 안 묶음 이름 (홈 "내 방송"처럼 회색 본문, D-UX3-94). plain(주문 상세)이면 상세의 다른 묶음 이름처럼 굵게 */
function CardLabel({ children, plain = false }: { readonly children: string; readonly plain?: boolean }) {
  return plain ? (
    <Txt step="section" weight="bold" role="heading" aria-level={2}>
      {children}
    </Txt>
  ) : (
    <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

/** 이름표 + 값 줄 (값은 글자로만) */
function Facts({ fields }: { readonly fields: readonly (readonly [string, string])[] }) {
  return (
    <View style={{ gap: SPACE.sm }}>
      {fields.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', gap: SPACE.md }} aria-label={`${label} ${value}`}>
          <View style={{ width: 76 }}>
            <Txt color="textSub">{label}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt step="bodyLarge" weight="book">{value}</Txt>
          </View>
        </View>
      ))}
    </View>
  )
}

/** 배송지 적기·고치기 창 — 칸마다 서버 문장(같은 검사 함수 PC-2, 화면이 따로 검사하지 않는다) */
function AddressSheet({
  title,
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  readonly title: string
  readonly initial: AddressFields
  readonly busy: boolean
  readonly error: ApiError | null
  readonly onClose: () => void
  readonly onSave: (address: AddressFields) => Promise<void>
}) {
  const [draft, setDraft] = useState<AddressFields>(initial)
  const fieldProblem = (key: keyof AddressFields) => error?.problemFor(`address.${key}`)?.message ?? null
  const shownInFields = ADDRESS_KEYS.some((key) => fieldProblem(key) !== null)
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
        {error !== null && !shownInFields ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}

// 라이브 화면 [라벨] 탭 (D-LABELTAB-01, 사용자 지시 2026-11-17 "라이브에서 라벨 기능 켜면 탭 바에 '라벨' 탭을 추가하고, 라벨 출력 리스트를 상품 리스트와
// 동일한 컨셉으로 만들어줘. 출력된 라벨과 대기 중인 라벨 구분되게 … + 플로팅 버튼 위치에 출력 아이콘으로 똑같이 만들어서 수동으로 인풋 넣어서 출력할 수 있게"):
// - 탭은 판매자·실제 라이브·봉인 전·라벨 기능 켬일 때만 (라이브 화면이 정한다). 목록은 라이브 화면이 이미 받는 그날 라벨 상태(GET /api/print/labels)에서 이 라이브 상품 라벨만.
// - 줄은 상품 줄과 같은 꼴(D-UX4-201·203): 왼쪽 번호 네모 · 가운데 품종(위)과 손님(아래) · 오른쪽 가격(위)과 상태(아래).
// - 묶음: [대기 중](출력 중 먼저) · [확인이 필요해요](재출력 필요·출력 안 함·아직 안 뽑음) · [출력됨](최근 출력 먼저, 폐기는 흐리게).
//   대기 중 줄은 파란 [대기 중]/[출력 중] 캡슐, 출력된 줄은 회색 "19:42 출력" — 한눈에 다르다.
// - 줄을 누르면 상품 라벨은 그 상품 자세히(라벨 다시 인쇄·뽑기가 거기 있다), 직접 인쇄 라벨은 같은 값을 채운 직접 인쇄 판.
// - 오른쪽 아래 (+) 자리의 인쇄 단추 → 직접 인쇄 판: 번호·품종·가격·손님 이름(선택)을 적어 찜 없이 라벨 한 장 (서버 POST /api/print/labels/direct).
//   번호를 적으면 이 라이브의 그 번호 상품 품종·가격을 채운다(손으로 고친 칸은 그대로). 단추는 한 줄 [닫기 | 인쇄] (절대 규칙 8).
import { useMemo, useRef, useState } from 'react'
import { Keyboard, View } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withRetry } from '../../api/client.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import { formatWon } from '../../lib/words.ts'
import { BigButton, BottomSheet, ButtonRow, EmptyFill, ErrorLine, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { TabIcon } from '../../ui/kit/tab-icons.tsx'
import { GUTTER, RADIUS, SPACE, TOUCH } from '../../ui/kit/tokens.ts'
import { Field } from '../../ui/parts.tsx'
import { FilterChip, animateNextLayout } from './ProductBoard.tsx'

export const LABEL_TAB = '라벨'
export const LABEL_WAITING = '대기 중'
export const LABEL_PRINTING = '출력 중'
export const LABEL_GROUP_CHECK = '확인이 필요해요'
export const LABEL_GROUP_DONE = '출력됨'
export const LABEL_WAITING_ONLY = '대기 중인 것만'
export const LABELS_EMPTY = '아직 라벨이 없어요'
export const LABELS_EMPTY_BODY = '찜이 확정되면 라벨이 여기에 쌓여요.\n오른쪽 아래 단추로 직접 뽑을 수도 있어요.'
export const LABELS_NO_WAITING = '대기 중인 라벨이 없어요'
export const DIRECT_TITLE = '라벨 직접 인쇄'
export const DIRECT_BODY = '찜 없이 라벨 한 장만 뽑아요. 찜·정산에는 들어가지 않아요.'
export const DIRECT_PRINT = '인쇄'
export const DIRECT_FAILED = '라벨을 대기열에 넣지 못했어요. 다시 눌러 주세요.'
/** 직접 인쇄 손님 이름 칸 길이 (서버 DIRECT_NICKNAME_MAX와 같다) */
const NICKNAME_MAX = 40
const DIRECT_BUYER = '직접 인쇄'

export type LabelGroup = 'waiting' | 'check' | 'done'

export interface LabelRow {
  readonly key: string
  readonly no: number
  readonly name: string
  readonly price: number | null
  readonly buyer: string
  readonly group: LabelGroup
  /** 줄 오른쪽 아래 상태 글 */
  readonly status: string
  readonly printing: boolean
  readonly voided: boolean
  /** 마지막으로 출력한 시각 (ISO) */
  readonly at: string | null
  /** 직접 인쇄 라벨 (찜 없음) */
  readonly direct: boolean
  readonly label: LabelView
}

const groupOf = (label: LabelView): LabelGroup => {
  if (label.state === 'WAITING' || label.state === 'PRINTING') return 'waiting'
  if (label.state === 'PRINTED' || label.state === 'VOIDED') return 'done'
  return 'check'
}

/** 시:분 (휴대폰 시각) */
export const clockWords = (iso: string): string => {
  const at = new Date(iso)
  return `${String(at.getHours())}:${String(at.getMinutes()).padStart(2, '0')}`
}

const statusOf = (label: LabelView, at: string | null): string => {
  switch (label.state) {
    case 'WAITING': return LABEL_WAITING
    case 'PRINTING': return LABEL_PRINTING
    case 'PRINTED': return at === null ? '출력함' : `${clockWords(at)} 출력`
    case 'VOIDED': return label.word || '폐기'
    case 'NONE': return '아직 안 뽑았어요'
    default: return label.word || '확인이 필요해요'
  }
}

/**
 * 이 라이브의 상품 라벨 줄 (포장 라벨은 뺀다). 대기 중(출력 중 먼저) → 확인 → 출력됨(최근 출력 먼저) 순.
 * 품종·가격은 라벨에 찍힌(찍힐) 값, 없으면 지금 상품 값. 손님은 이름 표기(닉네임 뒤 영문 숨기기)를 따른다
 */
export function labelRows(labels: readonly LabelView[], b: string, products: readonly Product[], names: Pick<BuyerNames, 'name'> | null): LabelRow[] {
  const byNo = new Map(products.map((product) => [product.no, product]))
  const rows: LabelRow[] = []
  for (const label of labels) {
    if (label.kind !== 'product' || label.broadcast !== b) continue
    const data = label.data !== null && 'no' in label.data ? label.data : null
    const no = data?.no ?? label.no
    if (no === null) continue
    const product = byNo.get(no)
    const direct = label.claim === null && label.key.startsWith('direct:')
    const at = label.history.length === 0 ? null : label.history.reduce((last, item) => (item.at > last ? item.at : last), label.history[0]!.at)
    const printed = data?.buyer ?? label.buyer
    const buyer = !direct && label.buyerId !== null && names !== null ? names.name(label.buyerId) : printed.kind === 'sms' ? '문자찜' : printed.name
    rows.push({
      key: label.key,
      no,
      name: data?.name ?? product?.name ?? '',
      price: data?.price ?? product?.price ?? null,
      buyer,
      group: groupOf(label),
      status: statusOf(label, at),
      printing: label.state === 'PRINTING',
      voided: label.state === 'VOIDED',
      at,
      direct,
      label,
    })
  }
  const rank = { waiting: 0, check: 1, done: 2 } as const
  // 같은 묶음 안: 대기 중은 출력 중 먼저 그다음 서버 순서, 출력됨은 최근 출력 먼저 (sort는 같은 값이면 원래 순서를 지킨다)
  return rows.sort((a, c) => rank[a.group] - rank[c.group] || (a.group === 'waiting' ? Number(c.printing) - Number(a.printing) : a.group === 'done' ? (c.at ?? '').localeCompare(a.at ?? '') : 0))
}

/** 묶음 이름 줄 (토스 거래 내역 "17일 화요일"처럼 작은 회색 글) */
function GroupHeading({ title, count }: { readonly title: string; readonly count: number }) {
  return (
    <View role="heading" aria-level={2} aria-label={`${title} ${String(count)}장`} style={{ paddingTop: SPACE.lg, paddingBottom: SPACE.xs, paddingLeft: ROW_LEFT }}>
      <Txt step="meta" weight="medium" color="textSub">{`${title} ${String(count)}`}</Txt>
    </View>
  )
}

const NO_SIZE = 40
const NO_RADIUS = 12
const ROW_LEFT = 10
const ROW_RIGHT = 12
const ROW_PAD_Y = 10
const CHIP_HEIGHT = 24

/** 라벨 한 줄 — 상품 줄과 같은 자리·크기 (ProductBoard ProductRow) */
function LabelLine({ row, onOpen }: { readonly row: LabelRow; readonly onOpen: (row: LabelRow) => void }) {
  const { p, tones } = useKit()
  const waiting = row.group === 'waiting'
  const check = row.group === 'check'
  const price = row.price === null ? '' : formatWon(row.price)
  return (
    <Tap role="button" aria-label={`${String(row.no)}번 라벨 ${row.name} ${row.buyer} ${row.status}`} testID={`label-row-${row.group}`} onPress={() => { Keyboard.dismiss(); onOpen(row) }} style={{ marginHorizontal: -GUTTER }}>
      {({ pressed }) => (
        <View style={{ minHeight: TOUCH.min + SPACE.md, justifyContent: 'center', paddingVertical: ROW_PAD_Y, paddingLeft: GUTTER + ROW_LEFT, paddingRight: GUTTER + ROW_RIGHT, opacity: row.voided ? 0.5 : 1 }}>
          {pressed ? <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: SPACE.xs / 2, bottom: SPACE.xs / 2, left: SPACE.sm, right: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
            {/* 번호 네모: 대기 중이면 파란 판(대기 캡슐과 같은 색), 나머지는 상품 줄처럼 옅은 회색 */}
            <View aria-hidden testID="label-row-no" style={{ flexShrink: 0, minWidth: NO_SIZE, height: NO_SIZE, paddingHorizontal: SPACE.xs, borderRadius: NO_RADIUS, borderCurve: 'continuous', backgroundColor: waiting ? tones.info.bg : p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Txt step="body" weight="bold" center numberOfLines={1} {...(waiting ? { ink: tones.info.fg } : {})}>{String(row.no)}</Txt>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt step="nav" weight="book" numberOfLines={1} {...(row.name === '' ? { ink: p.placeholder } : {})}>{row.name === '' ? '품종 없음' : row.name}</Txt>
                </View>
                <Txt step="nav" weight="medium" right numberOfLines={1}>{price}</Txt>
              </View>
              <View style={{ marginVertical: -2, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <View style={{ flex: 1, minWidth: 0, minHeight: CHIP_HEIGHT, marginVertical: SPACE.xs, flexDirection: 'row', alignItems: 'center' }}>
                  {/* 손님은 상품 줄 1등 캡슐과 같은 금색, 직접 인쇄는 회색 */}
                  <View style={{ height: CHIP_HEIGHT, justifyContent: 'center', paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: row.direct ? p.soft : p.goldBg, flexShrink: 1, minWidth: 0 }}>
                    <Txt step="meta" weight={row.direct ? 'medium' : 'bold'} ink={row.direct ? p.textSub : p.goldText} numberOfLines={1}>{row.buyer}</Txt>
                  </View>
                </View>
                {waiting ? (
                  <View testID="label-row-waiting" style={{ height: CHIP_HEIGHT, justifyContent: 'center', paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: tones.info.bg, flexShrink: 0 }}>
                    <Txt step="meta" weight="bold" ink={tones.info.fg} numberOfLines={1}>{row.status}</Txt>
                  </View>
                ) : (
                  <Txt step="meta" weight={check ? 'bold' : 'regular'} ink={check ? p.warnText : p.placeholder} numberOfLines={1} testID={check ? 'label-row-check' : 'label-row-done'}>{row.status}</Txt>
                )}
              </View>
            </View>
          </View>
        </View>
      )}
    </Tap>
  )
}

/** 라벨 탭 위 도구 줄: 왼쪽 [대기 중인 것만] · 오른쪽 "대기 n · 출력 n" */
export function LabelToolbar({ rows, waitingOnly, onWaitingOnly }: { readonly rows: readonly LabelRow[]; readonly waitingOnly: boolean; readonly onWaitingOnly: (on: boolean) => void }) {
  const waiting = rows.filter((row) => row.group === 'waiting').length
  const done = rows.filter((row) => row.group === 'done' && !row.voided).length
  return (
    <View testID="label-toolbar" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm }}>
      <FilterChip on={waitingOnly} label={LABEL_WAITING_ONLY} testID="label-waiting-only" onPress={() => { animateNextLayout(); onWaitingOnly(!waitingOnly) }} />
      <Txt step="body" weight="medium" color="textSub" numberOfLines={1}>{`대기 ${String(waiting)} · 출력 ${String(done)}`}</Txt>
    </View>
  )
}

export function LabelList({ rows, waitingOnly, onOpen }: { readonly rows: readonly LabelRow[]; readonly waitingOnly: boolean; readonly onOpen: (row: LabelRow) => void }) {
  if (rows.length === 0) return <EmptyFill title={LABELS_EMPTY} body={LABELS_EMPTY_BODY} testID="labels-empty" />
  const shown = waitingOnly ? rows.filter((row) => row.group === 'waiting') : rows
  if (shown.length === 0) return <EmptyFill title={LABELS_NO_WAITING} testID="labels-empty" />
  const groups: { readonly key: LabelGroup; readonly title: string }[] = [{ key: 'waiting', title: LABEL_WAITING }, { key: 'check', title: LABEL_GROUP_CHECK }, { key: 'done', title: LABEL_GROUP_DONE }]
  return (
    <View testID="label-list" role="list" aria-label="라벨 목록" style={{ marginTop: -SPACE.lg + SPACE.xs }}>
      {groups.map((group) => {
        const items = shown.filter((row) => row.group === group.key)
        if (items.length === 0) return null
        return (
          <View key={group.key} testID={`label-group-${group.key}`}>
            <GroupHeading title={group.title} count={items.length} />
            {items.map((row) => <LabelLine key={row.key} row={row} onOpen={onOpen} />)}
          </View>
        )
      })}
    </View>
  )
}

/** (+) 단추 자리의 인쇄 단추 — 상품 탭 AddFab과 같은 크기·자리·색, 그림만 프린터 */
export function PrintFab({ onPress, bottom }: { readonly onPress: () => void; readonly bottom: number }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={DIRECT_TITLE}
      testID="print-fab"
      onPress={onPress}
      pressScale={0.94}
      style={({ pressed }) => ({ position: 'absolute', right: SPACE.xl /* 오른쪽 아래 (D-PRINTOFF-01 — D-FLOATLEFT-01의 왼쪽을 되돌림) */, bottom, width: 58, height: 58, borderRadius: 29, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.primaryPressed : p.primary, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 })}
    >
      <View aria-hidden>
        <TabIcon name="printer" color={p.onPrimary} cut={p.primary} size={28} />
      </View>
    </Tap>
  )
}

export interface DirectPrefill {
  readonly no: number
  readonly name: string
  readonly price: number | null
  readonly nickname: string
}

const digits = (text: string, max: number): string => text.normalize('NFKC').replace(/\D/g, '').slice(0, max)

/**
 * 직접 인쇄 판 (아래 창). 번호를 적으면 이 라이브 그 번호 상품의 품종·가격을 채운다 — 손으로 고친 칸은 건드리지 않는다.
 * 같은 값으로 다시 누르면 같은 요청 번호(한 장만). 넣으면 창을 닫고 목록(대기 중)에 바로 보인다
 */
export function DirectPrintSheet({ visible, b, products, prefill, onClose, onQueued }: { readonly visible: boolean; readonly b: string; readonly products: readonly Product[]; readonly prefill: DirectPrefill | null; readonly onClose: () => void; readonly onQueued: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={DIRECT_TITLE} description={DIRECT_BODY} testID="direct-print-sheet">
      {visible ? <DirectPrintForm key={prefill === null ? 'new' : `${String(prefill.no)}-${prefill.name}`} b={b} products={products} prefill={prefill} onClose={onClose} onQueued={onQueued} /> : null}
    </BottomSheet>
  )
}

function DirectPrintForm({ b, products, prefill, onClose, onQueued }: { readonly b: string; readonly products: readonly Product[]; readonly prefill: DirectPrefill | null; readonly onClose: () => void; readonly onQueued: () => void }) {
  const [no, setNo] = useState(prefill === null ? '' : String(prefill.no))
  const [name, setName] = useState(prefill?.name ?? '')
  const [price, setPrice] = useState(prefill === null || prefill.price === null ? '' : String(prefill.price))
  const [nickname, setNickname] = useState(prefill === null || prefill.nickname === DIRECT_BUYER ? '' : prefill.nickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 손으로 고친 칸 — 번호로 채우지 않는다 */
  const touched = useRef({ name: prefill !== null, price: prefill !== null })
  const retry = useRef<{ input: string; id: string } | null>(null)
  const byNo = useMemo(() => new Map(products.map((product) => [product.no, product])), [products])
  const valid = /^\d{1,4}$/.test(no) && Number(no) > 0 && /^\d{1,12}$/.test(price)
  const typeNo = (text: string) => {
    const next = digits(text, 4)
    setNo(next)
    setError(null)
    const product = next === '' ? undefined : byNo.get(Number(next))
    if (!touched.current.name) setName(product?.name ?? '')
    if (!touched.current.price) setPrice(product?.price === undefined || product.price === null ? '' : String(product.price))
  }
  const send = async () => {
    if (busy || !valid) return
    setBusy(true)
    setError(null)
    const body = { b, no: Number(no), name: name.trim(), price: Number(price), ...(nickname.trim() === '' ? {} : { nickname: nickname.trim() }) }
    const input = JSON.stringify(body)
    if (retry.current?.input !== input) retry.current = { input, id: newRequestId() }
    const requestId = retry.current.id
    try {
      await withRetry(() => post('/api/print/labels/direct', { ...body, requestId }))
      onQueued()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : DIRECT_FAILED)
      setBusy(false)
    }
  }
  return (
    <View role="group" aria-label={DIRECT_TITLE} style={{ gap: SPACE.md }}>
      <Field label="상품 번호" value={no} maxLength={4} editable={!busy} keyboardType="number-pad" inputMode="numeric" returnKeyType="done" onChangeText={typeNo} />
      <Field label="품종" value={name} maxLength={80} editable={!busy} returnKeyType="done" onChangeText={(text) => { touched.current.name = true; setName(text); setError(null) }} />
      <Field label="가격 (원)" value={price} maxLength={12} editable={!busy} keyboardType="number-pad" inputMode="numeric" returnKeyType="done" onChangeText={(text) => { touched.current.price = true; setPrice(digits(text, 12)); setError(null) }} />
      <Field label="손님 이름 (선택)" hint={`비우면 라벨에 "${DIRECT_BUYER}"로 찍혀요`} value={nickname} maxLength={NICKNAME_MAX} editable={!busy} autoCorrect={false} returnKeyType="done" onChangeText={(text) => { setNickname(text); setError(null) }} />
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <ButtonRow>
        <BigButton kind="outline" label="닫기" disabled={busy} onPress={onClose} />
        <BigButton label={DIRECT_PRINT} ariaLabel={valid ? `${no}번 라벨 ${DIRECT_PRINT}` : DIRECT_PRINT} busy={busy} disabled={!valid} onPress={() => void send()} />
      </ButtonRow>
    </View>
  )
}

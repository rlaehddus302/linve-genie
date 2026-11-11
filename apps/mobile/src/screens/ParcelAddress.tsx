// 택배·포장 화면이 같이 쓰는 작은 조각 (D-UX3-35·D-UX3-94): 글자 단추·줄 단추·택배 꼬리표, 그리고 배송지 쓰기(같은 내용이면 같은 요청 번호).
// 옛 정산 손님 자세히의 "배송지" 칸(AddressCard — 여섯 칸·[지우기][고치기][배송지 확인]·적기 창)은 D-UX4-126(사용자 지시 2026-11-11 "배송지 확인*고치기 이런 글자 다 지워")로 없앴다.
// 배송지는 주문 상세 위 성함·휴대폰 번호·주소 줄을 눌러 손님 정보 화면(OrderInfoScreen)에서 적고 고친다 — 쓰기는 아래 useAddressCommand 그대로.
// 연락처·주소는 주소창·로그에 넣지 않는다(본문으로만 보낸다).
import { useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import type { BundleView, ParcelBrief } from '@livejjim/web/src/api/parcel-types.ts'
import { checkedWords, parcelLine, parcelTone } from '@livejjim/web/src/lib/parcel-words.ts'
import { isApiError, newRequestId, post, put, withRetry, type ApiError } from '../api/client.ts'
import { Icon, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Tag } from '../ui/parts.tsx'

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

/** 같은 내용이면 같은 요청 번호 (끊겨서 다시 보내도 한 번만). 손님 정보 입력(D-UX4-126)도 같이 쓴다 */
export function useAddressCommand() {
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

// 찜 기록에서 찜 하나를 눌렀을 때의 메뉴 (D-UX4-27 → D-RETRO-53, 복기 F6 "각 번호를 누르면 내가 원하는 대로 수정 — 취소하거나 되돌리거나 여러 가지로").
// 아래 판 "140번 찜"(손님 이름) — 그 찜에 지금 할 수 있는 것만 줄로 보인다:
//   [찜으로 올리기](대기 찜) · [찜 되돌리기](취소·안 된 찜) · [상품 보기] · [상품 고치기](가격·품종·번호는 상품 수정창에서) · [찜 삭제](살아 있는 찜).
// 조치가 셋 이상이라 한 줄 단추가 아니라 아래 판의 메뉴 줄로 놓는다(D-UX4-27 관례). 올리기·되돌리기·삭제는 팝업 [닫기 | …]으로 한 번 더 묻는다(부정 왼쪽·긍정 오른쪽, D-UX4-01).
// D-STK-02 (사용자 지시 2026-11-16 "동일 상품 번호에 여러 개 … 뒷사람도 라벨"): 대기 1번 찜에 [이 손님에게도 팔기] — 같은 물건을 하나 더 팔아(재고 +1)
//   지금 1등은 그대로 두고 이 손님도 찜이 된다(라벨·감사). [찜으로 올리기](1등과 바꾸기)보다 위에 둔다. 팝업 [닫기 | 더 팔기].
// D-UX4-154: 판 머리 손님 이름 옆에 그 찜을 받은 시각(한국 시각, 초까지 "13:05:42" — 문자찜은 문자를 받은 시각).
// 앱은 판정하지 않는다 — 엔진의 방송자 조치(host.cancel·host.promote·host.assign)를 보낼 뿐이다(claim-actions). 닉네임은 글자로만 그린다.
import { useState } from 'react'
import { View } from 'react-native'
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { BottomSheet, PopupDialog, Txt } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { ACTIVE_CLAIM, SELL_TO_THIS, deleteClaim, raiseClaim, raisePlan, sellMore, sellMoreDescription, sellMorePlan, useSheetHandoff, type RaisePlan } from './claim-actions.ts'
import { useConsoleApi } from './context.ts'
import { claimAt, feedBuyerName, feedClock } from './feed-rows.ts'
import { IconMenuRow, TRASH_TINT } from './parts.tsx'

export const MENU_RAISE = '찜으로 올리기'
export const MENU_RESTORE = '찜 되돌리기'
export const MENU_OPEN_PRODUCT = '상품 보기'
export const MENU_EDIT_PRODUCT = '상품 고치기'
export const MENU_DELETE = '찜 삭제'

/** 누른 찜 */
export interface PickedClaim {
  readonly id: string
  readonly no: number
  /** 손님 이름 (문자 손님은 "문자-0937") */
  readonly buyer: string
}

/** 메뉴 줄 바탕 */
const TINT = { product: '#E6F2EB', edit: '#EEF0EC', raise: '#F8E3A3', restore: '#EAF1F7', more: '#E6F2EB' } as const

/** 이 찜에 지금 할 수 있는 조치가 하나라도 있는지 (살아 있는 찜 · 올리기·되돌리기 · 상품 보기·고치기) — 없으면 판을 열지 않는다 */
export function claimHasMenu(claim: Pick<Claim, 'status'>, plan: RaisePlan | null, productRow: boolean): boolean {
  return ACTIVE_CLAIM.has(claim.status) || plan !== null || productRow
}

/** 올리기·되돌리기 팝업의 설명: 손님 이름 + (자리를 내주는 1등이 있으면) 그 손님이 어떻게 되는지 */
export function raiseDescription(buyer: string, replaced: string | null): string {
  return replaced === null ? buyer : `${buyer}\n지금 찜인 ${replaced} 님은 대기 1번으로 내려가요.`
}

/**
 * picked: 누른 찜(없으면 닫힘). onOpenProduct: 그 상품 자세히를 연다. onEditProduct: 그 상품을 고치는 창을 연다(끝난·봉인한 라이브에서는 보이지 않는다).
 * onError: 보내다 실패했을 때의 문장(목록 위 알림) — 다시 시작하면 null
 */
export function ClaimMenu({ picked, onClose, onOpenProduct, onEditProduct, onError }: {
  readonly picked: PickedClaim | null
  readonly onClose: () => void
  readonly onOpenProduct?: (key: string) => void
  readonly onEditProduct?: (key: string) => void
  readonly onError: (message: string | null) => void
}) {
  const api = useConsoleApi()
  // 팝업이 묻는 것 — 누른 순간의 낱말을 붙들어 둔다(보내는 동안 찜 상태가 바뀌어도 묻는 말이 바뀌지 않게). replaced: 대기 1번으로 내려갈 지금 1등 이름
  // more (D-STK-02): 같은 물건을 하나 더 팔아 이 대기 1번 손님도 찜으로 — stock: 보낼 새 재고(묻는 말에 보인다)
  const [asking, setAsking] = useState<{ readonly kind: 'delete' | 'promote' | 'restore' | 'more'; readonly target: PickedClaim; readonly replaced: string | null; readonly stock?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const handoff = useSheetHandoff()
  const closed = api.ended || api.sealed
  const claim = picked === null ? undefined : api.data.claims.get(picked.id)
  const product = claim === undefined ? undefined : api.data.products.get(claim.product)
  const shownProduct = product !== undefined && product.status !== 'CLOSED' ? product : undefined
  const plan = claim === undefined || closed ? null : raisePlan(api.data, claim)
  const active = claim !== undefined && ACTIVE_CLAIM.has(claim.status)
  // 같은 물건 더 팔기 (D-STK-02): 이 찜이 대기 1번이고 재고를 늘리면 바로 이 손님이 찜이 될 때만 (다른 손님이 먼저 올라가는 경우는 내놓지 않는다)
  const more = claim === undefined || closed || claim.status !== 'WAITLISTED' || shownProduct === undefined || claim.productId !== shownProduct.id ? null : sellMorePlan(shownProduct)
  const sellToThis = more !== null && claim !== undefined && more.next === claim.currentBuyer ? more : null
  const canOpen = shownProduct !== undefined && onOpenProduct !== undefined
  const canEdit = shownProduct !== undefined && onEditProduct !== undefined && !closed
  const visible = picked !== null && claim !== undefined && claimHasMenu(claim, plan, canOpen || canEdit || sellToThis !== null)
  const clock = claim === undefined ? '' : feedClock(claimAt(claim))

  const ask = (kind: 'delete' | 'promote' | 'restore' | 'more') => {
    if (picked === null) return
    const target = picked
    const replaced = kind === 'delete' || kind === 'more' || plan === null || plan.replace === null ? null : feedBuyerName(api.data, api.names, plan.replace)
    const stock = kind === 'more' && sellToThis !== null ? sellToThis.stock : undefined
    onClose()
    handoff(() => setAsking({ kind, target, replaced, ...(stock === undefined ? {} : { stock }) }))
  }
  const openProduct = (open: ((key: string) => void) | undefined) => {
    if (shownProduct === undefined || open === undefined) return
    const key = shownProduct.key
    onClose()
    handoff(() => open(key))
  }
  const confirm = async () => {
    if (asking === null) return
    const target = api.data.claims.get(asking.target.id)
    if (target === undefined) {
      setAsking(null)
      return
    }
    setBusy(true)
    onError(null)
    try {
      if (asking.kind === 'delete') {
        if (ACTIVE_CLAIM.has(target.status)) await deleteClaim(api, target)
      } else if (asking.kind === 'more') {
        const now = api.data.products.get(target.product)
        if (now === undefined) throw new Error('바꾸지 못했어요. 다시 눌러 주세요.')
        await sellMore(api, now, target.currentBuyer)
      } else {
        await raiseClaim(api, target)
      }
      setAsking(null)
    } catch (caught) {
      setAsking(null)
      const fallback = asking.kind === 'delete' ? '지우지 못했어요. 다시 눌러 주세요.' : '바꾸지 못했어요. 다시 눌러 주세요.'
      onError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' && asking.kind !== 'delete' ? caught.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const raising = asking !== null && (asking.kind === 'promote' || asking.kind === 'restore')
  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={picked === null ? '' : `${String(picked.no)}번 찜`}>
        {picked === null ? null : (
          <View role="group" aria-label="찜 메뉴" style={{ gap: SPACE.xs }}>
            {/* 손님 이름 · 찜한 시각(초까지, D-UX4-154) */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SPACE.sm }}>
              <Txt color="textSub">{picked.buyer}</Txt>
              {clock === '' ? null : <Txt color="textSub" aria-label={`찜한 시각 ${clock}`}>{clock}</Txt>}
            </View>
            {sellToThis !== null ? <IconMenuRow emoji="🪴" tint={TINT.more} title={SELL_TO_THIS} onPress={() => ask('more')} /> : null}
            {plan?.kind === 'promote' ? <IconMenuRow emoji="⬆️" tint={TINT.raise} title={MENU_RAISE} onPress={() => ask('promote')} /> : null}
            {plan?.kind === 'restore' ? <IconMenuRow emoji="↩️" tint={TINT.restore} title={MENU_RESTORE} onPress={() => ask('restore')} /> : null}
            {canOpen ? <IconMenuRow emoji="🪴" tint={TINT.product} title={MENU_OPEN_PRODUCT} onPress={() => openProduct(onOpenProduct)} /> : null}
            {canEdit ? <IconMenuRow emoji="✏️" tint={TINT.edit} title={MENU_EDIT_PRODUCT} onPress={() => openProduct(onEditProduct)} /> : null}
            {active && !closed ? <IconMenuRow emoji="🗑️" tint={TRASH_TINT} title={MENU_DELETE} onPress={() => ask('delete')} /> : null}
          </View>
        )}
      </BottomSheet>
      <PopupDialog
        visible={asking?.kind === 'delete'}
        message={asking === null ? '' : `${String(asking.target.no)}번 찜을 삭제할까요?`}
        description={asking?.target.buyer ?? null}
        cancelLabel="닫기"
        confirmLabel="삭제"
        busy={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void confirm()}
      />
      <PopupDialog
        visible={asking?.kind === 'more'}
        message={asking === null ? '' : `${String(asking.target.no)}번 같은 물건을 하나 더 팔까요?`}
        description={asking === null ? null : sellMoreDescription(asking.target.buyer, asking.stock ?? 2)}
        cancelLabel="닫기"
        confirmLabel="더 팔기"
        busy={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void confirm()}
      />
      <PopupDialog
        visible={raising}
        message={asking === null ? '' : asking.kind === 'restore' ? `${String(asking.target.no)}번 찜을 되돌릴까요?` : `${String(asking.target.no)}번 찜으로 올릴까요?`}
        description={asking === null ? null : raiseDescription(asking.target.buyer, asking.replaced)}
        cancelLabel="닫기"
        confirmLabel={asking?.kind === 'restore' ? '되돌리기' : '올리기'}
        busy={busy}
        onCancel={() => setAsking(null)}
        onConfirm={() => void confirm()}
      />
    </>
  )
}

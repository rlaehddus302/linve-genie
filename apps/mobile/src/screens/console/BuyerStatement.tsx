// 구매자 정산서 화면 (D-UX4-198, 사용자 지시 2026-11-16 "화면 저렇게 넘어가면 안 된다. 왜 이렇게 했는가? 아이폰 기본적인 화면으로 해라."):
// 옛(D-UX4-192·195): 정산서 목록 위에 손으로 그린 겹친 화면(SlidePage)이 오른쪽에서 밀려 들어왔다 — 넘김을 앱이 직접 움직여서
// 가끔 중간에 멈춰 화면이 반쯤 걸친 채 남았다. 이제 기기에서는 진짜 쌓인 경로(/console/<방송>/statement?buyer=)로 연다 —
// 화면 넘김·왼쪽 끝 밀어 뒤로 가기·안드로이드 뒤로는 휴대폰이 한다(상품 추가·방송 관리와 같다, D-UX4-57).
// 경로가 없을 때(시험·웹)만 정산서 화면 안에 겹쳐 그린다(BroadcastSalesList).
// 모두에게 보내기 차례는 statement-queue가 목록과 이 화면을 잇는다.
// 라이브 합치기 (D-MERGE-LIVE-01·04): 합친 라이브면 묶음의 라이브를 모두 담은 손님 정산서 — 가게 이름은 1차의 것, 보낸 표시는 정산서(묶음 모습)마다.
// 다른 정산서로 먼저 받은 손님이면 정산서 위에 알린다.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useCachedGet } from '../../lib/cached-get.ts'
import { broadcastSales, statementName, type BuyerOrder } from '../../lib/broadcast-sales.ts'
import { sentBuyers, useStatementInfo } from '../../lib/statement-info.ts'
import { earlierSent, GROUPS_FAILED, GROUPS_RETRY, markScopeSent, useStatementScope } from '../../lib/broadcast-groups.ts'
import { SmallButton, StackPage, Txt, useBottomInset } from '../../ui/kit/index.ts'
import { GUTTER, SPACE } from '../../ui/kit/tokens.ts'
import { Loading } from '../../ui/parts.tsx'
import { LOAD_FAILED } from '../StatementInfo.tsx'
import { BuyerOrderPaper, type SendQueue } from './BuyerOrderPaper.tsx'
import { useConsoleApi } from './context.ts'
import { ScopeConsole } from './scope.tsx'
import { StatementSetupPage } from './StatementSetup.tsx'
import { InfoButton } from './StatementControls.tsx'
import { endSendQueue, sendQueueOf, useSendQueueVersion } from './statement-queue.ts'

export const BUYER_PAGE_NAME = '구매자 정산서'
export const NO_ORDER = '현재 확정된 주문이 없어요.'
export const buyerPageName = (name: string): string => `${name} 님 정산서`
/** 모두에게 보내기를 마쳤을 때 목록 위 한 줄 */
export const sendAllProgress = (total: number, sent: number): string => `구매자 ${total}명 가운데 ${sent}명에게 보냈어요.`
export const sendAllFinished = (total: number, sent: number): string => `모두에게 보내기를 마쳤어요. ${sendAllProgress(total, sent)}`

export const shopPathOf = (broadcastId: string): string => `/api/broadcasts/${encodeURIComponent(broadcastId)}/order-shop`

/**
 * 손님 한 명의 정산서 몸통 — 겹친 화면(시험·웹)과 쌓인 경로가 같이 쓴다.
 * 가게 이름·정산 정보를 모르면 만들지 않는다 — 받지 않기로 한 배송비가 붙은 정산서가 손님에게 나가지 않게
 */
export function BuyerStatementBody({ broadcastId, order, date, buyerName, inset, rehearsal, sealed, queue, onSent, onOpenInfo, earlier = false, shopBroadcast }: {
  readonly broadcastId: string; readonly order: BuyerOrder | undefined; readonly date: string; readonly buyerName: string; readonly inset: number
  readonly rehearsal: boolean; readonly sealed: boolean; readonly queue?: SendQueue | undefined; readonly onSent: () => void; readonly onOpenInfo: () => void
  /** 이 손님이 다른 정산서(합치기·나누기 전)를 먼저 받았다 (D-MERGE-LIVE-04) */
  readonly earlier?: boolean
  /** 가게 이름을 읽는 라이브 — 합친 라이브면 1차 (없으면 broadcastId) */
  readonly shopBroadcast?: string
}) {
  const { data: shop, reload } = useCachedGet<{ name: string }>(shopPathOf(shopBroadcast ?? broadcastId))
  const statement = useStatementInfo()
  const info = statement.info
  if (!order) return <View style={{ padding: GUTTER }}><Txt>{NO_ORDER}</Txt></View>
  if (!shop?.name) {
    return <View style={{ padding: GUTTER, gap: SPACE.md }}>
      {shop !== null
        ? <InfoButton onPress={onOpenInfo} />
        : <><Txt>정산서의 가게 이름을 불러오는 중이에요.</Txt><SmallButton label="다시 불러오기" onPress={() => void reload()} /></>}
    </View>
  }
  if (info === null) return <View style={{ padding: GUTTER, gap: SPACE.md }}><Txt>{statement.failed ? LOAD_FAILED : '정산 정보를 불러오는 중이에요.'}</Txt><SmallButton label="다시 불러오기" onPress={statement.reload} /></View>
  return <BuyerOrderPaper key={order.id} {...{ order, date, shop: shop.name, buyerName, inset, rehearsal, sealed, info, queue, earlier }} onSent={onSent} />
}

/**
 * 쌓인 경로의 구매자 정산서. onBuyer: 모두에게 보내기 차례에서 다음 손님으로 바꾼다(같은 화면에서 손님만 바뀐다).
 * 차례가 끝나면 목록에 한 줄을 남기고 목록으로 돌아간다. 뒤로 나가면 차례도 끝난다.
 */
export function BuyerStatementScreen({ broadcastId, buyer, onBack, onBuyer }: { readonly broadcastId: string; readonly buyer: string; readonly onBack: () => void; readonly onBuyer: (next: string) => void }) {
  useEffect(() => () => endSendQueue(broadcastId), [broadcastId])
  return (
    <ScopeConsole broadcastId={broadcastId} waiting={<StackPage name={BUYER_PAGE_NAME} onBack={onBack} gray scroll={false}><Loading /></StackPage>}>
      {({ broadcast }) => <BuyerStatementRoutePage broadcastId={broadcastId} buyer={buyer} date={broadcast.date} rehearsal={broadcast.rehearsal} onBack={onBack} onBuyer={onBuyer} />}
    </ScopeConsole>
  )
}

function BuyerStatementRoutePage({ broadcastId, buyer, date, rehearsal, onBack, onBuyer }: { readonly broadcastId: string; readonly buyer: string; readonly date: string; readonly rehearsal: boolean; readonly onBack: () => void; readonly onBuyer: (next: string) => void }) {
  const { data, names } = useConsoleApi()
  const inset = useBottomInset()
  useSendQueueVersion()
  const statement = useStatementInfo()
  const [asking, setAsking] = useState(false)
  // 합친 라이브면 묶음의 라이브를 모두 담는다 (D-MERGE-LIVE-01)
  const scope = useStatementScope(broadcastId)
  const [sent, setSent] = useState<readonly string[]>(() => sentBuyers(scope.key))
  const members = scope.broadcasts.join('+')
  const sales = useMemo(() => broadcastSales(data.claims, data.products, members.split('+')), [data.claims, data.products, members])
  const { data: shop } = useCachedGet<{ name: string }>(shopPathOf(scope.lead))
  const earlier = useMemo(() => earlierSent(scope).includes(buyer), [scope, buyer, sent])
  const order = sales.orders.find(row => row.id === buyer)
  const buyerName = statementName(names.name(buyer))
  const keys = sendQueueOf(broadcastId)?.keys ?? []
  const at = keys.indexOf(buyer)
  const next = () => {
    const sentNow = sentBuyers(scope.key)
    const following = keys.slice(at + 1).find(key => !sentNow.includes(key))
    if (following !== undefined) { onBuyer(following); return }
    endSendQueue(broadcastId, sendAllFinished(keys.length, keys.filter(key => sentNow.includes(key)).length))
    onBack()
  }
  const queue: SendQueue | undefined = at >= 0
    ? { position: at + 1, total: keys.length, last: keys.slice(at + 1).every(key => sentBuyers(scope.key).includes(key)), next }
    : undefined
  return (
    <StackPage name={buyerPageName(buyerName)} onBack={onBack} gray scroll={false} testID="buyer-page">
      {/* 합친 라이브인지 알기 전에는 그리지 않는다 — 1차만 담긴 정산서가 나가지 않게 (D-MERGE-LIVE-01) */}
      {scope.ready ? <BuyerStatementBody broadcastId={broadcastId} order={order} date={date} buyerName={buyerName} inset={inset} rehearsal={rehearsal} sealed={data.sealed}
        queue={queue} earlier={earlier} shopBroadcast={scope.lead} onSent={() => setSent(markScopeSent(scope, buyer))} onOpenInfo={() => setAsking(true)} />
        : scope.failed === true
          ? <View style={{ padding: GUTTER, gap: SPACE.md }}><Txt>{GROUPS_FAILED}</Txt><SmallButton label={GROUPS_RETRY} onPress={() => void scope.reload()} /></View>
          : <Loading />}
      <StatementSetupPage visible={asking} shopPath={shopPathOf(scope.lead)} shopName={shop?.name ?? null} info={statement.editable ? statement.info : null} onLater={() => setAsking(false)} onSaved={() => setAsking(false)} />
    </StackPage>
  )
}

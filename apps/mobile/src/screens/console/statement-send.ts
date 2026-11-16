// 정산서 문자 보내기 묶음 (D-UX4-174, 사용자 지시 2026-11-16 "아직 휴대폰 번호를 몰라서 보낼 수 없는 구매자도 있을거잖아 … 못 보내는 이유를 소제목으로 …
// 보내기 시작 누르면 아직 휴대폰 번호 모르는 닉네임 말고 알고 있는 사람들부터 … 아무도 없으면 버튼 자체를 비활성화"):
// 구매자를 "보낼 수 있는 사람"과 "까닭별로 못 보내는 사람"으로 나눈다 (순수 함수 — 화면·시험이 같이 쓴다).
// - 휴대폰 번호: 영수증 구매자 줄(GET /api/days/:date/receipt-buyers)의 아는 번호 끝 4자리(sms.last4)로만 본다 — 번호 자체는 받지도 적지도 않는다.
// - 서버가 번호 상태를 알려 주지 못하면(옛 서버·문자 칸 없음·못 받음·봉인 날짜) 번호로 거르지 않는다 — 보낼 때 번호를 묻는 지금 흐름(BuyerOrderPaper)대로.
// - 금액을 모르는 구매자는 정산서 문자 단추가 꺼져 있다 — 따로 묶는다.
// - 라이브 합치기(D-MERGE-LIVE-04): 합치기·나누기 전에 다른 정산서를 이미 받은 손님은 차례에서 빼고 "먼저 받은 정산서가 있어요" 아래 따로 보인다 —
//   한 번에 몰아 보내다 같은 상품 값을 두 번 청구하지 않게. 판매자가 손님을 눌러 확인하고 따로 보낼 수 있다.
import type { ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import type { StatementRow } from '../../lib/broadcast-sales.ts'
import { EARLIER_TITLE } from '../../lib/broadcast-groups.ts'

export type BlockReason = 'phone' | 'amount' | 'earlier'

/** 못 보내는 까닭 소제목 (화면 글) */
export const BLOCK_TITLE: Readonly<Record<BlockReason, string>> = {
  phone: '아직 휴대폰 번호를 몰라요',
  amount: '금액을 아직 정하지 않았어요',
  earlier: EARLIER_TITLE,
}

/** 여러 이름을 한 줄로 */
export const NAME_JOIN = ' · '

export interface SendGroups {
  /** 보낼 수 있는 구매자 (표 순서) */
  readonly sendable: readonly StatementRow[]
  /** 까닭별 못 보내는 구매자 — 구매자가 있는 까닭만 */
  readonly blocked: readonly { readonly reason: BlockReason; readonly rows: readonly StatementRow[] }[]
}

/**
 * 구매자 줄을 나눈다. receipts: 번호 상태(아직 못 받았거나 못 받으면 null) · phoneCheck: 번호로 거를지(봉인 날짜는 보낼 때마다 번호를 적으니 거르지 않는다)
 */
export function sendGroups(rows: readonly StatementRow[], receipts: ReceiptBuyers | null, phoneCheck: boolean, earlier: readonly string[] = []): SendGroups {
  const known = new Map<string, boolean>()
  if (phoneCheck && receipts !== null && receipts.smsReady === true) {
    for (const row of receipts.buyers) if (row.sms != null) known.set(row.buyer, row.sms.last4 !== null)
  }
  const sendable: StatementRow[] = []
  const phone: StatementRow[] = []
  const amount: StatementRow[] = []
  const before: StatementRow[] = []
  for (const row of rows) {
    if (row.money === null) amount.push(row)
    else if (earlier.includes(row.key)) before.push(row)
    else if (known.get(row.key) === false) phone.push(row)
    else sendable.push(row)
  }
  const blocked = ([['earlier', before], ['phone', phone], ['amount', amount]] as const).filter(([, list]) => list.length > 0).map(([reason, list]) => ({ reason, rows: list }))
  return { sendable, blocked }
}

// 정산서 문자 보내기 묶음 (D-UX4-174, 사용자 지시 2026-11-16 "아직 휴대폰 번호를 몰라서 보낼 수 없는 구매자도 있을거잖아 … 못 보내는 이유를 소제목으로 …
// 보내기 시작 누르면 아직 휴대폰 번호 모르는 닉네임 말고 알고 있는 사람들부터 … 아무도 없으면 버튼 자체를 비활성화"):
// 구매자를 "보낼 수 있는 사람"과 "까닭별로 못 보내는 사람"으로 나눈다 (순수 함수 — 화면·시험이 같이 쓴다).
// - 휴대폰 번호: 영수증 구매자 줄(GET /api/days/:date/receipt-buyers)의 아는 번호 끝 4자리(sms.last4)로만 본다 — 번호 자체는 받지도 적지도 않는다.
// - 서버가 번호 상태를 알려 주지 못하면(옛 서버·문자 칸 없음·못 받음·봉인 날짜) 번호로 거르지 않는다 — 보낼 때 번호를 묻는 지금 흐름(BuyerOrderPaper)대로.
// - 금액을 모르는 구매자는 정산서 문자 단추가 꺼져 있다 — 따로 묶는다.
import type { ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import type { StatementRow } from '../../lib/broadcast-sales.ts'

export type BlockReason = 'phone' | 'amount'

/** 못 보내는 까닭 소제목 (화면 글) */
export const BLOCK_TITLE: Readonly<Record<BlockReason, string>> = {
  phone: '아직 휴대폰 번호를 몰라요',
  amount: '금액을 아직 정하지 않았어요',
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
export function sendGroups(rows: readonly StatementRow[], receipts: ReceiptBuyers | null, phoneCheck: boolean): SendGroups {
  const known = new Map<string, boolean>()
  if (phoneCheck && receipts !== null && receipts.smsReady === true) {
    for (const row of receipts.buyers) if (row.sms != null) known.set(row.buyer, row.sms.last4 !== null)
  }
  const sendable: StatementRow[] = []
  const phone: StatementRow[] = []
  const amount: StatementRow[] = []
  for (const row of rows) {
    if (row.money === null) amount.push(row)
    else if (known.get(row.key) === false) phone.push(row)
    else sendable.push(row)
  }
  const blocked = ([['phone', phone], ['amount', amount]] as const).filter(([, list]) => list.length > 0).map(([reason, list]) => ({ reason, rows: list }))
  return { sendable, blocked }
}

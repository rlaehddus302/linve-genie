// 주문 상세 묶음 이름 (D-UX4-125). 옛 상세 맨 아래 "확인서"·"금액 고치기"·"금액 기록" 줄(OrderFixes — 입금 적기·배송비 바꾸기·할인·추가·환불 적기 아래 창)은
// 사용자 지시(2026-11-11 "지난 거래 내역 아래에 있는 메뉴들 다 지워. 나중에 내가 필요하면 그때 추가할게.", D-UX4-128)로 지웠다 —
// 문자는 [정산서 보내기] 창(order-export.tsx), 입금은 [입금을 확인했나요?], 이 주문 배송비는 키보드 화면(OrderShippingScreen)으로 옮겼다.
// 다시 필요하면 git 기록(D-UX4-127 커밋 2d879519의 이 파일)에서 되살린다.
import { Txt } from '../ui/kit/index.ts'

/** 상세 묶음 이름 (토스 상세 내역의 "최근 거래 내역"처럼 굵은 본문) */
export function DetailHeading({ children }: { readonly children: string }) {
  return (
    <Txt step="section" weight="bold" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

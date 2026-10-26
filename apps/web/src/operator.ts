// 운영 사업자 정보 (LND1 D-LND1-04): 소개 화면 맨 아래 "운영 사업자" 절의 값.
// 상호만 정해져 있다. 대표자·사업자등록번호·통신판매업 신고번호·주소·문의 이메일은 사용자 확인 전이라 빈 글로 둔다 —
// 빈 글인 항목은 화면에 줄이 없다(자리표시 "[확인 필요]"를 화면에 내지 않는다). 값이 정해지면 이 파일의 그 줄만 채운다.
export interface Operator {
  /** 상호 */
  readonly name: string
  /** 대표자 */
  readonly representative: string
  /** 사업자등록번호 */
  readonly businessNumber: string
  /** 통신판매업 신고번호 */
  readonly mailOrderNumber: string
  /** 주소 */
  readonly address: string
  /** 문의 이메일 (있으면 "시작하려면" 절에 "계정 문의: <이메일>"도) */
  readonly email: string
}

export const OPERATOR: Operator = {
  name: '틈(TEUM)',
  representative: '',
  businessNumber: '',
  mailOrderNumber: '',
  address: '',
  email: '',
}

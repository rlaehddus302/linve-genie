// 앱 안 우체국 화면 (D-UX3-37): 서버 자동 채우기 자료(/api/parcels/days/:date/epost-kit)의 모양과 작은 도우미.
// 이 자료는 판매자 휴대폰 안 우체국 화면에 채울 때만 쓰고, 어디에도 남기지 않는다.

export type EpostDirectKind = 'VISIT' | 'COUNTER'

export interface EpostKitPerson {
  readonly name: string
  /** 숫자만 */
  readonly phone: string
  readonly zip: string
  readonly address: string
  readonly detail: string
}

export interface EpostKitReceiver extends EpostKitPerson {
  readonly buyer: string
  readonly memo: string
  readonly qty: number
  readonly content: string
  readonly kg: number
  readonly cm: number
}

export interface EpostKit {
  readonly date: string
  readonly sender: EpostKitPerson | null
  readonly receivers: readonly EpostKitReceiver[]
  readonly file: { readonly name: string; readonly base64: string }
}

/** 방문접수소포 예약 (비회원) — 우체국 직원이 가지러 온다, 신청할 때 결제 */
export const EPOST_VISIT_PAGE = 'https://parcel.epost.go.kr/general.RetrieveGeneralNewGubun.parcel?isGuest=true&isAllDelete=true&userType=5'
/** 창구소포 간편사전접수 — 판매자가 우체국에 들고 가서 창구에서 결제 (비회원은 동의·조회용 비밀번호 4자리를 판매자가 넣는다) */
export const EPOST_COUNTER_PAGE = 'https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveAcceptPlus.postal?gubun=2'

/** 전화번호 숫자 → 세 칸 (02는 두 자리 지역번호). 휴대전화(01x)인지 */
export function splitPhone(digits: string): { readonly mobile: boolean; readonly parts: readonly [string, string, string] } | null {
  const d = digits.replace(/[^0-9]/g, '')
  if (d.startsWith('02') && (d.length === 9 || d.length === 10)) return { mobile: false, parts: ['02', d.slice(2, d.length - 4), d.slice(-4)] }
  if (d.length === 10 || d.length === 11) return { mobile: /^01[016789]/.test(d), parts: [d.slice(0, 3), d.slice(3, d.length - 4), d.slice(-4)] }
  return null
}

// 손님 장부 순수 함수 (KP1, CUSTOMER_RULES CR-2~CR-7, D-KP1-02·05·06·08, 골든 tests/golden/customers/*.json).
// - 시계·난수·I/O를 쓰지 않는다. 오늘 날짜·난수는 부르는 쪽이 넣는다. 날짜 계산은 달력 글(YYYY-MM-DD)로만 해서 실행 환경 시간대(TZ)와 상관없다.
// - 금액은 정수 원을 받아 글로 바꾸기만 한다(세 자리마다 쉼표 — 실행 환경 지역 설정을 쓰지 않는다).
// - 판정과 상관없다(CR-0 3): 이 파일의 결과는 엔진 이벤트·발송함을 만들지 않는다.

/** 장부 보관 개월 (설정 "손님 장부 보관 기간", CR-3) */
export type LedgerMonths = 6 | 12 | 24 | 36
export const LEDGER_MONTHS = [6, 12, 24, 36] as const
export const DEFAULT_LEDGER_MONTHS: LedgerMonths = 12

export function isLedgerMonths(value: unknown): value is LedgerMonths {
  return typeof value === 'number' && (LEDGER_MONTHS as readonly number[]).includes(value)
}

/** 보관 개월 → 화면 낱말 ("6개월"·"1년"·"2년"·"3년") */
export function ledgerMonthsWord(months: LedgerMonths): string {
  return months === 6 ? '6개월' : `${String(months / 12)}년`
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** 'YYYY-MM-DD' + n개월 (달력 — 그 달에 같은 날이 없으면 그 달 말일) */
export function addMonths(date: string, months: number): string {
  const match = DATE_RE.exec(date)
  if (match === null) throw new RangeError('날짜 형식이 아니다')
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(Number(match[3]), daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/**
 * 지우는 날 (CR-3, 골든 retention.json): 기준 날짜 = lastOrder와 consentOrder 중 늦은 날(lastOrder가 null이면 consentOrder),
 * 보관 개월 = min(동의 문구 개월, 지금 설정 개월), 지우는 날 = 기준 날짜 + 보관 개월. 서버는 그날 0시(KST)에 지운다
 */
export function ledgerDeleteOn(input: { lastOrder: string | null; consentOrder: string; consentMonths: LedgerMonths; settingMonths: LedgerMonths }): { deleteOn: string } {
  const base = input.lastOrder !== null && input.lastOrder > input.consentOrder ? input.lastOrder : input.consentOrder
  return { deleteOn: addMonths(base, Math.min(input.consentMonths, input.settingMonths)) }
}

/** 공백 문자(JavaScript \s — 전각 공백 포함)를 모두 지운 NFC 글 */
const squeeze = (text: string) => text.normalize('NFC').replace(/\s/gu, '')

/**
 * 채팅 한 줄이 연결 코드인지 (CR-5, 골든 code.json): 본문을 NFC로 바꾸고 공백을 모두 지운 글이 어떤 코드의 공백을 지운 글과 정확히 같을 때만 그 코드.
 * 다른 글자가 하나라도 붙으면 아니다(애매하면 잇지 않음)
 */
export function matchLinkCode(input: { text: string; codes: readonly string[] }): { code: string | null } {
  const text = squeeze(input.text)
  if (text === '') return { code: null }
  for (const code of input.codes) if (squeeze(code) === text) return { code }
  return { code: null }
}

/** 정수 원 → 세 자리마다 쉼표 (지역 설정을 쓰지 않는다) */
export function wonText(won: number): string {
  const sign = won < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(won)))
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 콘솔 손님 표시 (CR-7, 골든 badge.json): 위에서부터 처음 맞는 것 하나 —
 * 설정 꺼짐·리허설·표지 없음 → 없음, 입금 늦음 주의, 단골 · 누적, 앞선 실제 날짜 기록 없음 → 처음, 없음
 */
export function customerBadge(input: { show: boolean; rehearsal: boolean; known: boolean; earlier: boolean; regular: boolean; caution: boolean; purchaseTotal: number }): { text: string | null } {
  if (!input.show || input.rehearsal || !input.known) return { text: null }
  if (input.caution) return { text: '입금 늦음 주의' }
  if (input.regular) return { text: `단골 · 누적 ${wonText(input.purchaseTotal)}원` }
  if (!input.earlier) return { text: '처음' }
  return { text: null }
}

/** 화면 읽기 프로그램 글 ("손님: 단골, 누적 125,000원") */
export function badgeSpoken(text: string): string {
  return `손님: ${text.split(' · ').join(', ')}`
}

/**
 * 묶음 배송지 칸에 장부 연락처를 "확인 전"으로 보이나 (CR-4, 골든 prefill.json):
 * 품목 ≥ 1, 직접 수령·합배송 아님, 묶음에 저장한 배송지 없음, 구성원 표지가 든 장부 줄이 정확히 하나. 리허설·봉인 날짜는 부르는 쪽이 뺀다
 */
export function showLedgerPrefill(input: { items: number; shipping: 'NONE' | 'FIXED' | 'PICKUP' | 'COMBINED'; saved: 'NONE' | 'UNCONFIRMED' | 'CONFIRMED'; lines: number }): { ledger: boolean } {
  return { ledger: input.items >= 1 && input.shipping !== 'PICKUP' && input.shipping !== 'COMBINED' && input.saved === 'NONE' && input.lines === 1 }
}

/** 연결 코드 낱말 48개 (CR-5 — 순서 그대로, 숫자 없음) */
export const LINK_CODE_WORDS = [
  '하늘', '바다', '구름', '노을', '바람', '햇살', '달빛', '별빛', '이슬', '파도', '모래', '숲속',
  '들꽃', '꽃잎', '새싹', '나무', '열매', '단풍', '봄비', '눈꽃', '호수', '냇물', '언덕', '들판',
  '빗물', '안개', '가을', '여름', '겨울', '봄날', '새벽', '아침', '저녁', '노래', '미소', '기쁨',
  '보물', '선물', '풍선', '연필', '우산', '창문', '등불', '촛불', '종이', '구슬', '솔잎', '돌담',
] as const

/** 연결 코드가 살아 있는 시간 (24시간) */
export const LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 새 연결 코드 고르기: 서로 다른 두 낱말 "구름 바다"(사이 공백 하나) 중 taken(그 판매자의 살아 있는 코드)과 겹치지 않는 것.
 * 남은 짝이 없으면 null. 난수는 부르는 쪽이 준다(randomIndex(n) → 0 이상 n 미만 정수 — 서버는 crypto.randomInt)
 */
export function pickLinkCode(taken: ReadonlySet<string>, randomIndex: (n: number) => number): string | null {
  const free: string[] = []
  for (const first of LINK_CODE_WORDS) {
    for (const second of LINK_CODE_WORDS) {
      if (first === second) continue
      const code = `${first} ${second}`
      if (!taken.has(code)) free.push(code)
    }
  }
  if (free.length === 0) return null
  const index = randomIndex(free.length)
  if (!Number.isSafeInteger(index) || index < 0 || index >= free.length) throw new RangeError('난수 범위가 틀렸다')
  return free[index] as string
}

/**
 * 받는 분 이름 가리기 (CR-2 "이름 가운데를 *로" — 가정): 코드 포인트 1자 `*`, 2자 `홍*`, 3자 이상은 첫·끝 글자 사이를 모두 `*`
 * (`홍길동`→`홍*동`, `남궁민수`→`남**수`)
 */
export function maskRecipient(name: string): string {
  const chars = [...name]
  if (chars.length === 0) return ''
  if (chars.length === 1) return '*'
  if (chars.length === 2) return `${chars[0] as string}*`
  return `${chars[0] as string}${'*'.repeat(chars.length - 2)}${chars.at(-1) as string}`
}

/** 동의 문구 판 CR-CONSENT-1 (CR-2 글 그대로 — {가게}·{기간} 자리) */
export const CR_CONSENT_1 = {
  id: 'CR-CONSENT-1',
  title: '다음 주문에도 이 배송지 쓰기 (선택)',
  body: (shop: string, monthsWord: string): string =>
    `${shop}가 받는 분·연락처·주소를 다음 주문 배송지로 쓰려고 마지막 주문 뒤 ${monthsWord} 동안 보관해요. 그 뒤엔 지워요. 언제든 이 링크나 판매자에게 지워 달라고 할 수 있어요. 고르지 않아도 이번 주문은 그대로 보내요.`,
} as const

/** 동의 기록의 항목 글 (CR-2) */
export const LEDGER_CONSENT_ITEMS = '받는 분·연락처·주소·상세 주소·우편번호'

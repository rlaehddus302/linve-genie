// 은행 알림 읽기 (DEPOSIT_RULES DP-9 1~7, SMS3 — D-DEP2-02·D-DEP2-03, 골든 tests/golden/deposit/notice.json — AC-SMS3-03·04).
// 판매자 휴대폰이 받은 은행 앱 알림·은행 문자 하나 → 입금 · 입금 취소 · 출금 · 읽지 못함 · 은행 알림 아님.
// 순수·전체 함수: 시계·실행 환경 시간대·Intl을 쓰지 않고, 어떤 입력에도 예외를 던지지 않는다. 날짜 계산은 calendar.ts.
// 외부 키·잔액 이어짐·저장(DP-9 8·9)은 서버 흐름(deposit/service.ts receiveNotice)이 한다.
import { addDays, dateText, isRealDate, kstDateOf, kstIso, kstToMs, parseOffsetIso } from './calendar.ts'
import { DEPOSIT_AMOUNT_MAX, DEPOSIT_NAME_MAX } from './paste.ts'

/** 은행 코드 (DP-9 1 표) */
export type BankCode = 'KB' | 'SHINHAN' | 'WOORI' | 'HANA' | 'NH' | 'IBK' | 'KAKAO' | 'TOSS' | 'KBANK' | 'SC' | 'MG' | 'EPOST'

interface BankEntry {
  readonly code: BankCode
  readonly name: string
  /** 이 은행의 앱 패키지들 (은행마다 앱이 여럿일 수 있다 — D-DEP2-18) */
  readonly apps: readonly string[]
  readonly numbers: readonly string[]
}

/** 믿을 보낸 곳 표 (DP-9 1). 넓히거나 고치려면 DECISIONS를 거친다 */
export const BANKS: readonly BankEntry[] = Object.freeze([
  { code: 'KB', name: 'KB국민', apps: ['com.kbstar.kbbank'], numbers: ['15889999', '16449999', '15999999'] },
  { code: 'SHINHAN', name: '신한', apps: ['com.shinhan.sbanking'], numbers: ['15778000', '15998000'] },
  { code: 'WOORI', name: '우리', apps: ['com.wooribank.smart.npib'], numbers: ['15885000', '15995000'] },
  { code: 'HANA', name: '하나', apps: ['com.kebhana.hanapush'], numbers: ['15881111', '15991111'] },
  { code: 'NH', name: 'NH농협', apps: ['nh.smart.banking', 'com.nonghyup.nhallonebank', 'com.nh.cashcardapp'], numbers: ['16613000', '15882100'] },
  { code: 'IBK', name: 'IBK기업', apps: ['com.ibk.android.ionebank'], numbers: ['15662566', '15882588'] },
  { code: 'KAKAO', name: '카카오뱅크', apps: ['com.kakaobank.channel'], numbers: ['15993333'] },
  { code: 'TOSS', name: '토스뱅크', apps: ['viva.republica.toss'], numbers: ['16617654'] },
  { code: 'KBANK', name: '케이뱅크', apps: ['com.kbankwith.smartbank'], numbers: ['15221000'] },
  // D-DEP2-18: 은행 앱만 더한다(대표번호는 기기 사본과 함께 바꿔야 해서 그대로)
  { code: 'SC', name: 'SC제일', apps: ['com.scbank.ma30'], numbers: [] },
  { code: 'MG', name: '새마을금고', apps: ['com.smg.spbs'], numbers: [] },
  { code: 'EPOST', name: '우체국', apps: ['com.epost.psf.sdsi'], numbers: [] },
] as const satisfies readonly BankEntry[])

/** 앱 알림을 보내도 되는 은행 앱 패키지 (C-04 응답 filters.bankApps — DP-9 1 표의 패키지 14개, D-DEP2-18) */
export const BANK_APPS: readonly string[] = Object.freeze(BANKS.flatMap((bank) => bank.apps))
/** 기기가 skipWords로 거르지 않을 은행 대표번호 (C-04 응답 filters.bankNumbers — DP-9 1 표의 대표번호 16개, 숫자만, D-SMS3-26) */
export const BANK_NUMBERS: readonly string[] = Object.freeze(BANKS.flatMap((bank) => bank.numbers))

/** 은행 코드 → 화면 이름 */
export function bankName(code: string): string {
  return BANKS.find((bank) => bank.code === code)?.name ?? '은행'
}

export type NoticeChannel = 'SMS' | 'APP'
export type NoticePrecision = 'second' | 'minute'

export interface NoticeInput {
  readonly channel: NoticeChannel
  readonly from: string | null
  readonly title: string | null
  readonly text: string
  /** 휴대폰이 받은 시각 (서버가 검사한 오프셋 있는 ISO 8601) */
  readonly receivedAt: string
}

export type NoticeResult =
  | { readonly kind: 'DEPOSIT' | 'CANCEL'; readonly bank: BankCode | null; readonly trusted: boolean; readonly at: string; readonly precision: NoticePrecision; readonly amount: number; readonly name: string; readonly balance: number | null }
  | { readonly kind: 'WITHDRAWAL'; readonly bank: BankCode | null; readonly trusted: boolean; readonly at: string; readonly precision: NoticePrecision; readonly amount: number | null; readonly balance: number | null }
  | { readonly kind: 'UNREADABLE'; readonly bank: BankCode | null; readonly trusted: boolean }
  | { readonly kind: 'NONE' }

const FULLWIDTH_ZERO = 0xff10
const FULLWIDTH_NINE = 0xff19
/** 앞 공백 (R-3 정규화와 같은 집합 — JavaScript \s에서 U+FEFF를 뺀 것) */
const LEADING_SPACE_RE = /^[^\S\uFEFF]+/u

/**
 * 보낸 번호 정리 (DOMAIN_RULES R-26 1): 전각 숫자를 반각으로, ASCII 숫자만 남기고, `+82`로 시작하면 맨 앞 `82`를 뗀 뒤
 * 0으로 시작하지 않고 9자리 이상이면 앞에 0. 글이 아니면 빈 글
 */
export function senderDigits(from: unknown): string {
  if (typeof from !== 'string') return ''
  let digits = ''
  for (const char of from) {
    const code = char.codePointAt(0) as number
    if (code >= 0x30 && code <= 0x39) digits += char
    else if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) digits += String.fromCharCode(code - FULLWIDTH_ZERO + 0x30)
  }
  if (from.replace(LEADING_SPACE_RE, '').startsWith('+82')) {
    digits = digits.slice(2)
    if (!digits.startsWith('0') && digits.length >= 9) digits = `0${digits}`
  }
  return digits
}

/** 앞뒤 공백 (R-3 정규화와 같은 집합 — U+FEFF는 공백으로 보지 않는다) */
const EDGE_SPACE_RE = /^[^\S\uFEFF]+|[^\S\uFEFF]+$/gu
/** 문자 보낸 곳이 대표번호 모양인지: ASCII 숫자·`-`·공백만 (D-DEP2-10 — `+82`·글자·괄호·전각 숫자가 섞이면 아님) */
const BANK_NUMBER_SHAPE_RE = /^[0-9\- ]+$/u

/**
 * 보낸 곳이 표의 은행인지 (DP-9 1) — 앱은 패키지 이름이 정확히 같음, 문자는 앞뒤 공백을 뺀 글이 숫자·하이픈·공백만이고
 * 숫자만 남긴 글이 대표번호와 같음. R-26 1 보낸 번호 정리(+82 떼기·전각 숫자)는 쓰지 않는다 (D-DEP2-10)
 */
export function trustedBank(channel: NoticeChannel, from: unknown): BankCode | null {
  if (typeof from !== 'string') return null
  if (channel === 'APP') return BANKS.find((bank) => bank.apps.includes(from))?.code ?? null
  const trimmed = from.replace(EDGE_SPACE_RE, '')
  if (!BANK_NUMBER_SHAPE_RE.test(trimmed)) return null
  const digits = trimmed.replace(/[^0-9]/gu, '')
  if (digits === '') return null
  return BANKS.find((bank) => bank.numbers.includes(digits))?.code ?? null
}

/** 출금 낱말 (DP-9 3) */
const WITHDRAW_WORDS = ['출금', '지급', '승인', '결제'] as const
/**
 * 금액 모양 (DP-9 4): `\d{1,3}(,\d{3})+` 또는 `\d+` (쉼표 모양을 먼저 — 뒤에 숫자가 이어지면 쉼표 모양이 아니다).
 * 숫자 덩어리 바로 앞이 숫자 + `:`·`/`·`.`·`-`이거나 바로 뒤가 그 글자 + 숫자이면 시각·날짜·계좌번호 조각이라 금액이 아니다 (D-DEP2-09).
 * 가린 계좌번호의 `*`도 숫자로 본다 — `110-***-123456`의 `123456`은 계좌번호 조각 (골든 G-DEP-202)
 */
const AMOUNT_BODY = String.raw`(\d{1,3}(?:,\d{3})+(?!\d)|\d+(?!\d))(?![:/.\-][\d*])`
const AMOUNT = String.raw`(?<!\d)(?<![\d*][:/.\-])${AMOUNT_BODY}`
/** 1. K 바로 뒤: 공백·`:` + 금액 + (공백 + `원`) — 3은 금액 다음 글 */
const AFTER_RE = new RegExp(String.raw`^[\s:]*${AMOUNT}(?:\s*원)?([\s\S]*)$`, 'u')
/** 2. K 바로 앞: 금액 + 공백 + `원`(선택) + `을`·`이`(선택) + 공백 — 1은 금액 앞 글 */
const BEFORE_RE = new RegExp(String.raw`^([\s\S]*?)${AMOUNT}\s*원?(?:을|이)?\s*$`, 'u')
const BALANCE_RE = new RegExp(String.raw`잔액[\s:]*${AMOUNT}`, 'u')
/** 토큰이 금액 모양으로 시작함 / 끝남 (D-DEP2-11 ④) */
const STARTS_AMOUNT_RE = new RegExp(String.raw`^${AMOUNT_BODY}`, 'u')
const ENDS_AMOUNT_RE = new RegExp(String.raw`${AMOUNT}$`, 'u')
/** 해외 발신 표시 (DP-9 1, D-DEP2-12) — 공백을 모두 지운 2의 글에 있으면 믿지 않는다. 입금자명에서도 버린다(7) */
const OVERSEAS_WORDS = ['국제발신', '해외발신', '국외발신'] as const
/** 되돌림 낱말 (DP-9 3, D-DEP2-08) — 입금 쪽에만 본다 */
const REVERSAL_WORDS = ['취소', '정정', '반환', '오류', '착오', '환불', '실패', '불능', '예정'] as const
/** 보이지 않는 글자 (DP-9 2, D-DEP2-08) */
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu
/** 시각: `M/D H:MM`·`M.D H:MM` (선택 `:SS`) — 앞뒤에 숫자가 붙어 있지 않은 것 */
const TIME_RE = /(?<!\d)(\d{1,2})[/.](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/u
/** 이름 토큰 앞뒤에서 떼는 글자 */
const EDGE_CHARS = new Set(['[', ']', '(', ')', '<', '>', '{', '}', ':'])
/** 이름 토큰 끝에서 하나 떼는 말 (긴 것 먼저) */
const NAME_ENDINGS = ['님께서', '님이', '님']
/** 이름이 아닌 낱말 (영문 대소문자 무시, DP-9 7) */
const STOP_WORDS = new Set(
  [
    'KB', '국민', 'KB국민', '국민은행', '신한', '신한은행', '우리', '우리은행', '하나', '하나은행', '농협', 'NH', 'NH농협', '농협은행', '기업', 'IBK', 'IBK기업', '기업은행', '카카오뱅크', '토스', '토스뱅크', '케이뱅크',
    'SC', 'SC제일', 'SC제일은행', '제일은행', 'MG', '새마을금고', 'MG새마을금고', '우체국', '우체국예금', '올원뱅크', 'NH올원뱅크', '콕뱅크', 'NH콕뱅크',
    '입금', '출금', '지급', '승인', '결제', '입금취소', '취소', '잔액', '원', '이체', '타행', '당행', '알림', ...OVERSEAS_WORDS, '내', '고객님', '입금되었습니다', '입금했어요', '보냈어요', '체크카드', '카드', '일시불',
  ].map((word) => lower(word)),
)
const LETTER_RE = /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z]/u

function lower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
}

/** 금액 모양 글 → 정수 (너무 크면 Infinity — 범위 검사에서 떨어진다) */
function amountOf(text: string): number {
  const digits = text.replace(/,/g, '')
  if (digits.length > 15) return Number.POSITIVE_INFINITY
  return Number(digits)
}

interface Found {
  readonly value: number
  /** 금액이 홀로 서는지 (D-DEP2-11 ③④) */
  readonly alone: boolean
}

interface Near {
  readonly after: Found | null
  readonly before: Found | null
}

/** 종류 낱말 K가 s에서 처음 나오는 자리 기준으로 1. 뒤 금액 2. 앞 금액 (DP-9 4) */
function amountsNear(s: string, keyword: RegExp): Near {
  const match = keyword.exec(s)
  if (match === null) return { after: null, before: null }
  const afterMatch = AFTER_RE.exec(s.slice(match.index + match[0].length))
  let after: Found | null = null
  if (afterMatch !== null) {
    const rest = afterMatch[2] as string
    // ③ 반대쪽이 공백이나 끝 ④ 반대쪽 이웃 토큰이 금액 모양으로 시작하지 않음
    const next = rest.trimStart().split(' ')[0] as string
    const alone = (rest === '' || /^\s/u.test(rest)) && !STARTS_AMOUNT_RE.test(next)
    after = { value: amountOf(afterMatch[1] as string), alone }
  }
  const beforeMatch = BEFORE_RE.exec(s.slice(0, match.index))
  let before: Found | null = null
  if (beforeMatch !== null) {
    const head = beforeMatch[1] as string
    const previous = head.trimEnd().split(' ').at(-1) as string
    const alone = (head === '' || /\s$/u.test(head)) && !ENDS_AMOUNT_RE.test(previous)
    before = { value: amountOf(beforeMatch[2] as string), alone }
  }
  return { after, before }
}

/** 시각 (DP-9 6): 글의 `M/D H:MM`이 있는 날짜·시각이면 그것(연도는 받은 날 기준), 아니면 받은 시각 초까지 */
function timeOf(s: string, receivedMs: number): { at: string; precision: NoticePrecision } {
  const fallback = { at: kstIso(receivedMs - (((receivedMs % 1000) + 1000) % 1000)), precision: 'second' as const }
  const match = TIME_RE.exec(s)
  if (match === null) return fallback
  const month = Number(match[1])
  const day = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  const second = match[5] === undefined ? null : Number(match[5])
  if (hour > 23 || minute > 59 || (second !== null && second > 59)) return fallback
  const received = kstDateOf(receivedMs)
  let year = Number(received.slice(0, 4))
  if (!isRealDate(year, month, day)) return fallback
  // 받은 날 + 1일보다 늦으면 한 해 앞 (12월 31일 알림을 1월 1일에 받음)
  if (dateText(year, month, day) > addDays(received, 1)) year -= 1
  if (!isRealDate(year, month, day)) return fallback
  return { at: kstIso(kstToMs(year, month, day, hour, minute, second ?? 0)), precision: second === null ? 'minute' : 'second' }
}

/** 입금자명 (DP-9 7): 버릴 토큰을 뺀 뒤 정확히 하나면 그것(40자까지), 아니면 빈 글 */
function nameOf(s: string): string {
  const kept: string[] = []
  for (const raw of s.split(' ')) {
    const chars = [...raw]
    let start = 0
    let end = chars.length
    while (start < end && EDGE_CHARS.has(chars[start] as string)) start++
    while (end > start && EDGE_CHARS.has(chars[end - 1] as string)) end--
    let token = chars.slice(start, end).join('')
    const ending = NAME_ENDINGS.find((word) => token.endsWith(word))
    if (ending !== undefined) token = token.slice(0, token.length - ending.length)
    if (token === '') continue
    if (/[0-9]/.test(token) || token.includes('*') || !LETTER_RE.test(token)) continue
    if (STOP_WORDS.has(lower(token))) continue
    if (token.endsWith('통장') || token.endsWith('계좌')) continue
    // 거래 낱말이 붙은 토큰 (D-DEP2-18): `전자금융입금`·`입금하셨습니다`·`모바일송금`·`타행이체` — 이름이 아니다
    if (token.includes('입금') || token.includes('송금') || token.endsWith('이체')) continue
    kept.push(token)
    if (kept.length > 1) return ''
  }
  return kept.length === 1 ? [...(kept[0] as string)].slice(0, DEPOSIT_NAME_MAX).join('') : ''
}

/**
 * 은행 알림 하나 읽기 (DEPOSIT_RULES DP-9 1~7). 어떤 입력에도 예외를 던지지 않는다.
 * receivedAt이 오프셋 있는 ISO가 아니면 1970-01-01T09:00:00+09:00으로 본다(서버는 늘 검사한 값을 넘긴다)
 */
export function readBankNotice(input: NoticeInput): NoticeResult {
  try {
    return read(input)
  } catch {
    return { kind: 'NONE' }
  }
}

function read(input: NoticeInput): NoticeResult {
  const record = (input !== null && typeof input === 'object' ? input : {}) as Partial<Record<keyof NoticeInput, unknown>>
  const channel: NoticeChannel = record.channel === 'APP' ? 'APP' : 'SMS'
  const text = typeof record.text === 'string' ? record.text : ''
  const title = typeof record.title === 'string' ? record.title : null
  const receivedMs = typeof record.receivedAt === 'string' ? (parseOffsetIso(record.receivedAt) ?? 0) : 0
  // 2. 정규화: 앱 알림은 제목 + 본문, 호환 정규화(전각 → 반각), [web발신] 지움, 연속 공백 한 칸, 앞뒤 공백 뺌
  const joined = channel === 'APP' && title !== null ? `${title} ${text}` : text
  const s = joined
    .replace(INVISIBLE_RE, '')
    .toWellFormed()
    .normalize('NFKC')
    .replace(/\[web발신\]/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  // 1. 믿을 보낸 곳 — 표에서 찾았더라도 해외 발신 표시가 있으면 믿지 않는다 (D-DEP2-12, 앱 알림·문자 모두)
  const spaceless = s.replace(/\s+/gu, '')
  const overseas = OVERSEAS_WORDS.some((word) => spaceless.includes(word))
  const bank = overseas ? null : trustedBank(channel, record.from)
  const trusted = bank !== null
  // 3. 종류
  const c = spaceless.replaceAll('입출금', '')
  const hasDeposit = c.includes('입금')
  const withdrawWord = WITHDRAW_WORDS.some((word) => c.includes(word))
  let kind: 'DEPOSIT' | 'CANCEL' | 'WITHDRAWAL'
  if (c.includes('입금취소')) kind = 'CANCEL'
  else if (hasDeposit && !withdrawWord) {
    // 되돌림 낱말이 든 입금 모양은 들어온 돈이 아닐 수 있다 — 읽지 못함 (D-DEP2-08)
    if (REVERSAL_WORDS.some((word) => c.includes(word))) return { kind: 'UNREADABLE', bank, trusted }
    kind = 'DEPOSIT'
  }
  else if (withdrawWord && !hasDeposit) kind = 'WITHDRAWAL'
  else if (hasDeposit && withdrawWord) return { kind: 'UNREADABLE', bank, trusted }
  else return { kind: 'NONE' }
  // 4. 금액 — 종류 낱말 K가 처음 나오는 자리 기준
  let keyword: RegExp
  if (kind === 'CANCEL') keyword = /입\s*금\s*취\s*소/u
  else if (kind === 'DEPOSIT') keyword = /입금/u
  else {
    const first = WITHDRAW_WORDS.map((word) => ({ word, at: s.indexOf(word) }))
      .filter((item) => item.at >= 0)
      .sort((a, b) => a.at - b.at)[0]
    keyword = new RegExp(first === undefined ? '출금' : first.word, 'u')
  }
  const near = amountsNear(s, keyword)
  const amount = near.after?.value ?? near.before?.value ?? null
  const amountOk = amount !== null && Number.isSafeInteger(amount) && amount >= 1 && amount <= DEPOSIT_AMOUNT_MAX
  if (kind !== 'WITHDRAWAL' && !amountOk) return { kind: 'UNREADABLE', bank, trusted }
  // 금액은 홀로 서야 한다 (입금·입금 취소만, D-DEP2-11): ① `입금` 두 번 이상 ② 앞뒤 금액이 다름 ③④ 금액 반대쪽에 붙은 글·금액 모양 이웃
  if (kind !== 'WITHDRAWAL') {
    const twice = c.indexOf('입금') !== c.lastIndexOf('입금')
    const differ = near.after !== null && near.before !== null && near.after.value !== near.before.value
    const notAlone = (near.after !== null && !near.after.alone) || (near.before !== null && !near.before.alone)
    if (twice || differ || notAlone) return { kind: 'UNREADABLE', bank, trusted }
  }
  // 5. 잔액
  const balanceMatch = BALANCE_RE.exec(s)
  const balanceValue = balanceMatch === null ? null : amountOf(balanceMatch[1] as string)
  const balance = balanceValue !== null && Number.isSafeInteger(balanceValue) ? balanceValue : null
  // 6. 시각
  const { at, precision } = timeOf(s, receivedMs)
  if (kind === 'WITHDRAWAL') return { kind, bank, trusted, at, precision, amount: amountOk ? (amount as number) : null, balance }
  // 7. 입금자명
  return { kind, bank, trusted, at, precision, amount: amount as number, name: nameOf(s), balance }
}

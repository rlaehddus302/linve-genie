// SMS3 적대 시험 (test-domain): 은행 알림 읽기 DP-9 1~7 `readBankNotice` — AC-SMS3-04 [domain] + 믿을 보낸 곳 흉내(DP-INV-6 앞단)·출금/입금 취소(DP-INV-7 앞단).
// 기대는 DEPOSIT_RULES DP-9 문장만으로 정한다.
// (1) 어떤 입력에도 예외 없이 결과 하나, 입금·입금 취소 금액은 1~100,000,000 정수, 결과 키 모양 (2) trusted ⇔ bank ≠ null,
//     앱은 패키지 이름이 표와 정확히 같을 때만, 문자는 보낸 번호 정리값이 대표번호와 같을 때만
// (3) 비슷한 패키지·번호·대소문자·키릴 글자·앞뒤 공백·메신저 앱 제목에 은행 이름은 믿지 않는다
// (4) 입금취소(글자 사이 공백·전각)·출금 낱말(출금·지급·승인·결제)이 든 알림은 입금(DEPOSIT)이 아니다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BANKS, readBankNotice, trustedBank, type NoticeInput } from '../../../apps/server/src/deposit/notice.ts'

const RECEIVED = '2026-10-31T20:05:30+09:00'
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/
const BANK_CODES = new Set(BANKS.map((bank) => bank.code))

function shapeProblem(result: unknown): string | null {
  const r = result as Record<string, unknown>
  const keys = Object.keys(r).sort().join(',')
  const bankOk = (r.bank === null && r.trusted === false) || (BANK_CODES.has(r.bank as never) && r.trusted === true)
  switch (r.kind) {
    case 'NONE':
      return keys === 'kind' ? null : `NONE 키: ${keys}`
    case 'UNREADABLE':
      return keys === 'bank,kind,trusted' && bankOk ? null : `UNREADABLE: ${JSON.stringify(r)}`
    case 'DEPOSIT':
    case 'CANCEL': {
      const ok =
        keys === 'amount,at,balance,bank,kind,name,precision,trusted' &&
        bankOk &&
        Number.isSafeInteger(r.amount) &&
        (r.amount as number) >= 1 &&
        (r.amount as number) <= 100_000_000 &&
        typeof r.name === 'string' &&
        [...(r.name as string)].length <= 40 &&
        !/[0-9*]/.test(r.name as string) &&
        AT_RE.test(r.at as string) &&
        (r.precision === 'second' || r.precision === 'minute') &&
        (r.balance === null || Number.isSafeInteger(r.balance))
      return ok ? null : `${String(r.kind)}: ${JSON.stringify(r)}`
    }
    case 'WITHDRAWAL': {
      const ok =
        keys === 'amount,at,balance,bank,kind,precision,trusted' &&
        bankOk &&
        (r.amount === null || (Number.isSafeInteger(r.amount) && (r.amount as number) >= 1 && (r.amount as number) <= 100_000_000)) &&
        AT_RE.test(r.at as string) &&
        (r.balance === null || Number.isSafeInteger(r.balance))
      return ok ? null : `WITHDRAWAL: ${JSON.stringify(r)}`
    }
    default:
      return `모르는 종류: ${JSON.stringify(r)}`
  }
}

const money = fc.oneof(
  fc.integer({ min: 0, max: 2_000_000_000 }).map((n) => n.toLocaleString('en-US')),
  fc.integer({ min: 0, max: 2_000_000_000 }).map(String),
  fc.constantFrom('14,000', '14,000원', '１４，０００', '1,00', '100,000,000', '100,000,001', '0', '-14,000', '+14,000', '999999999999999999999999', '1e5', '14.000', '14,0000', ',000', '00014000'),
)
const word = fc.constantFrom('입금', '출금', '입금취소', '입 금 취 소', '입금 취소', '지급', '승인', '결제', '입출금', '입출금통장', '잔액', '잔액:', '원', '김영희', '홍길동님', '[KB]', '(주)다육', '[Web발신]', '10/31 20:05', '12/31 23:59:59', '13/40 25:61', '2/30 10:00', '→', '*', '***', '110-***-123456', '😀', '​', '\n', '\t', '<script>', '이체', '타행', '취소')
const noticeText = fc.oneof(
  fc.array(fc.oneof(word, money), { maxLength: 14 }).map((parts) => parts.join(' ')),
  fc.string({ maxLength: 120 }),
  fc.string({ unit: 'binary', maxLength: 80 }),
  fc.array(money, { minLength: 1, maxLength: 3000 }).map((parts) => `입금 ${parts.join(' ')}`),
)
const fromArb = fc.oneof(
  fc.constantFrom<string | null>(null, '', '1588-9999', '15889999', '+82 1588-9999', '1577-8000', '1600-0000', '010-1234-5678', 'com.kbstar.kbbank', 'com.kakaobank.channel', 'com.kakao.talk', 'viva.republica.toss', 'KB국민은행'),
  fc.string({ maxLength: 30 }),
)
const inputArb = fc.record({
  channel: fc.constantFrom('SMS', 'APP') as fc.Arbitrary<'SMS' | 'APP'>,
  from: fromArb,
  title: fc.option(noticeText, { nil: null }),
  text: noticeText,
  receivedAt: fc.oneof(fc.constant(RECEIVED), fc.constantFrom('2026-01-01T00:00:10+09:00', '2026-12-31T23:59:59+09:00', 'not-a-date', '')),
})

describe('AC-SMS3-04 readBankNotice — 예외 없음·모양', () => {
  it('임의 입력(본문 1,000자 임의 글·제목/보낸 곳 null·금액 모양 수천 개)에도 예외 없이 결과 하나, 입금·입금 취소 금액은 1~100,000,000 정수', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const text = input.text.length > 1000 ? input.text : input.text
        let result: unknown
        expect(() => {
          result = readBankNotice({ ...input, text })
        }).not.toThrow()
        expect(shapeProblem(result)).toBeNull()
        // 같은 입력 = 같은 결과
        expect(readBankNotice({ ...input, text })).toEqual(result)
      }),
      { numRuns: 500 },
    )
  })

  it('글이 아닌 값·빠진 칸·이상한 객체에도 예외가 없다', () => {
    for (const odd of [null, undefined, 1, 'x', [], {}, { channel: 'FAX' }, { channel: 'SMS', from: 1588, text: 14000 }, { channel: 'APP', from: {}, title: [], text: null, receivedAt: 5 }]) {
      expect(shapeProblem(readBankNotice(odd as unknown as NoticeInput))).toBeNull()
    }
  })
})

describe('믿을 보낸 곳 흉내 (DP-9 1 — 표와 정확히 같을 때만 믿는다)', () => {
  const deposit = (channel: 'SMS' | 'APP', from: string | null, title: string | null = null) =>
    readBankNotice({ channel, from, title, text: '신한 10/31 20:05 입금 14,000 잔액 1,028,000 김영희', receivedAt: RECEIVED })

  it('표의 패키지·대표번호는 믿는다 (기준)', () => {
    for (const bank of BANKS) {
      // D-DEP2-18: 은행마다 앱 여럿 — 모두 믿는다
      for (const app of bank.apps) expect(deposit('APP', app)).toMatchObject({ kind: 'DEPOSIT', trusted: true, bank: bank.code })
      for (const number of bank.numbers) {
        const dashed = `${number.slice(0, 4)}-${number.slice(4)}`
        expect(deposit('SMS', dashed)).toMatchObject({ kind: 'DEPOSIT', trusted: true, bank: bank.code })
      }
    }
  })

  it('비슷한 앱 패키지(뒤에 붙임·대소문자·앞뒤 공백·키릴 글자·메신저)는 믿지 않는다 — 제목에 은행 이름이 있어도', () => {
    const lookalikes = [
      'com.kbstar.kbbank.fake',
      'com.kbstar.kbban',
      'COM.KBSTAR.KBBANK',
      'Com.kakaobank.channel',
      ' com.kakaobank.channel',
      'com.kakaobank.channel ',
      'com.kakaobank.channel​',
      'com.kbstar.kbbаnk', // а = 키릴 U+0430
      'com.kakao.talk',
      'com.samsung.android.messaging',
      'com.android.mms',
      'viva.republica.toss.fake',
      '15889999',
      '',
    ]
    for (const from of lookalikes) {
      expect(deposit('APP', from, '카카오뱅크'), from).toMatchObject({ kind: 'DEPOSIT', trusted: false, bank: null })
      expect(trustedBank('APP', from), from).toBeNull()
    }
    expect(deposit('APP', null, '신한')).toMatchObject({ trusted: false, bank: null })
  })

  it('앱 알림의 보낸 곳에 대표번호를 넣어도, 문자의 보낸 곳에 패키지 이름을 넣어도 믿지 않는다 (채널이 섞이지 않는다)', () => {
    expect(trustedBank('APP', '1588-9999')).toBeNull()
    expect(trustedBank('SMS', 'com.kbstar.kbbank')).toBeNull()
  })

  it('대표번호와 비슷한 번호(한 자리 다름·더 김·지역번호 붙음·휴대폰 번호·해외 번호)는 믿지 않는다', () => {
    for (const from of ['1588-9998', '1588-99990', '11588-9999', '02-1588-9999', '0215889999', '010-1588-9999', '+1 1588-9999', '+8215889999 1', '1588', '9999', '1588-999', '+82 2-1588-9999', '+82 10-1588-9999']) {
      expect(deposit('SMS', from), from).toMatchObject({ trusted: false, bank: null })
    }
  })

  it('보낸 곳이 null이거나 글이 아니면 믿지 않는다', () => {
    expect(deposit('SMS', null)).toMatchObject({ trusted: false, bank: null })
    expect(trustedBank('SMS', 15889999)).toBeNull()
    expect(trustedBank('APP', null)).toBeNull()
  })

  it('속성: 믿음이면 앱은 패키지가 표와 정확히 같고, 문자는 보낸 곳에 대표번호 숫자가 그대로 들어 있다', () => {
    const apps = new Set(BANKS.flatMap((bank) => bank.apps)) // D-DEP2-18: 은행마다 앱 여럿
    const numbers = new Set(BANKS.flatMap((bank) => bank.numbers))
    fc.assert(
      fc.property(fc.constantFrom('SMS', 'APP') as fc.Arbitrary<'SMS' | 'APP'>, fromArb, (channel, from) => {
        const code = trustedBank(channel, from)
        if (code === null) return
        if (channel === 'APP') expect(apps.has(from as string)).toBe(true)
        else {
          const digits = (from as string).normalize('NFKC').replace(/[^0-9]/g, '')
          expect([...numbers].some((n) => digits === n || digits === `82${n}`)).toBe(true)
        }
      }),
      { numRuns: 500 },
    )
  })
})

describe('출금·입금 취소는 입금이 아니다 (DP-9 3 → DP-INV-7 앞단)', () => {
  const kindOf = (text: string, channel: 'SMS' | 'APP' = 'SMS', title: string | null = null) =>
    readBankNotice({ channel, from: channel === 'APP' ? 'com.kakaobank.channel' : '1588-9999', title, text, receivedAt: RECEIVED }).kind

  it('입금취소 표기 여럿(글자 사이 공백·줄바꿈·전각 공백·제목에만)은 CANCEL', () => {
    for (const text of ['입금취소 14,000 홍길동', '입금 취소 14,000원 홍길동', '입 금 취 소 14,000', '입금\n취소 14,000', '입금　취소 14,000', '[KB]10/31 20:05 홍길동 입금취소 14,000 잔액 1,000,000', '14,000원 입금취소']) {
      expect(kindOf(text), text).toBe('CANCEL')
    }
    expect(kindOf('홍길동', 'APP', '입금취소 14,000원')).toBe('CANCEL')
  })

  it('출금 낱말(출금·지급·승인·결제)이 든 알림은 입금이 아니다 — 입금과 함께 있어도(읽지 못함)', () => {
    for (const text of ['출금 14,000 김영희', '체크카드 승인 14,000 김영희', '결제 14,000원', '지급 14,000', '입출금통장 출금 14,000 잔액 1,000', '[KB] 김영희 입금 14,000 결제', '입금 14,000 출금 14,000', '이체 출금 14,000']) {
      expect(kindOf(text), text).not.toBe('DEPOSIT')
    }
  })

  it('입출금통장의 "출금"은 출금으로 읽지 않는다 (입금 알림이 읽지 못함이 되지 않는다)', () => {
    expect(kindOf('입출금통장 입금 14,000 김영희')).toBe('DEPOSIT')
  })

  it('금액 경계: 1원·100,000,000원은 입금, 0원·100,000,001원·15자리 넘음은 읽지 못함', () => {
    const read = (amount: string) => readBankNotice({ channel: 'SMS', from: '1588-9999', title: null, text: `입금 ${amount} 김영희`, receivedAt: RECEIVED })
    expect(read('1')).toMatchObject({ kind: 'DEPOSIT', amount: 1 })
    expect(read('100,000,000')).toMatchObject({ kind: 'DEPOSIT', amount: 100_000_000 })
    expect(read('0').kind).toBe('UNREADABLE')
    expect(read('100,000,001').kind).toBe('UNREADABLE')
    expect(read('9999999999999999').kind).toBe('UNREADABLE')
    expect(read('999,999,999,999,999,999').kind).toBe('UNREADABLE')
  })

  it('입금자명에 숫자·* 든 토큰·은행 이름은 들어가지 않는다 (계좌번호·전화번호가 이름이 되지 않는다)', () => {
    const r = readBankNotice({ channel: 'SMS', from: '1588-9999', title: null, text: '[KB국민] 10/31 20:05 110-***-123456 010-1234-5678 입금 14,000 잔액 1,028,000 김영희님', receivedAt: RECEIVED })
    expect(r).toMatchObject({ kind: 'DEPOSIT', name: '김영희', amount: 14_000, balance: 1_028_000, at: '2026-10-31T20:05:00+09:00', precision: 'minute' })
  })

  it('12월 31일 알림을 1월 1일에 받으면 한 해 앞, 13월·25시는 받은 시각', () => {
    expect(readBankNotice({ channel: 'SMS', from: '1588-9999', title: null, text: '12/31 23:59 입금 14,000 김영희', receivedAt: '2027-01-01T00:00:10+09:00' })).toMatchObject({ at: '2026-12-31T23:59:00+09:00' })
    expect(readBankNotice({ channel: 'SMS', from: '1588-9999', title: null, text: '13/31 25:59 입금 14,000 김영희', receivedAt: '2026-10-31T20:05:30+09:00' })).toMatchObject({ at: '2026-10-31T20:05:30+09:00', precision: 'second' })
  })
})

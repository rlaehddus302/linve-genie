// I2 화면 값 고르기 (AC-I2-02·22·35~38·52·65): 포장 거르기·순서·바뀐 품목 안내, 파일 이름, 크기·시각 글, 가게 계좌 미리 보기, 판매대장 주소, 가져오기 문제 말.
import { describe, expect, it } from 'vitest'
import { fileNameOf } from '../src/api/client.ts'
import type { PackingEntry, PackingItem } from '../src/api/types.ts'
import { importProblemWords } from '../src/components/ImportDialog.tsx'
import { ledgerPath } from '../src/components/LedgerDialog.tsx'
import { accountPreview, backupStopped } from '../src/components/SettingsPage.tsx'
import { sizeWords } from '../src/lib/files.ts'
import { kstDateTimeLong } from '../src/lib/kst.ts'
import { PACKING_TONE, changeNotice, changeWords, checklistSpansBroadcasts, diffItems, inFilter, nextBuyer, packingWords, sameKeys, sortEntries, spansBroadcasts } from '../src/lib/packing.ts'
import { parseRoute, routePath } from '../src/lib/router.ts'
import { closingSignature, packingLabelSignature } from '../src/lib/use-packing.ts'
import { chat, dataOf, register } from './engine.ts'
import { DATE } from './support.ts'

const item = (no: number, patch: Partial<PackingItem> = {}): PackingItem => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '1부', no, name: '핑크프릴', price: 10000, ...patch })
const entry = (buyer: string, name: string, patch: Partial<PackingEntry> = {}): PackingEntry => ({
  buyer,
  name,
  phoneLast4: null,
  payment: 'UNPAID',
  items: [item(15)],
  status: '포장 대기',
  invoice: null,
  add: [],
  remove: [],
  ...patch,
})

describe('포장 목록 (AC-I2-35)', () => {
  it('걸러 보기: 포장할 것 = 포장 대기·포장 다시 확인, 포장 완료, 배송 완료 = 배송 완료·배송 뒤 바뀜, 전체', () => {
    const statuses = ['포장 대기', '포장 완료', '포장 다시 확인', '배송 완료', '배송 뒤 바뀜'] as const
    const pick = (filter: Parameters<typeof inFilter>[1]) => statuses.filter((status) => inFilter({ status }, filter))
    expect(pick('todo')).toEqual(['포장 대기', '포장 다시 확인'])
    expect(pick('packed')).toEqual(['포장 완료'])
    expect(pick('shipped')).toEqual(['배송 완료', '배송 뒤 바뀜'])
    expect(pick('all')).toEqual([...statuses])
  })

  it('상태 뜻: 포장 대기 = 보통, 완료 = 성공, 다시 확인·배송 뒤 바뀜 = 주의 (D-102)', () => {
    expect(PACKING_TONE).toEqual({ '포장 대기': 'info', '포장 완료': 'success', '배송 완료': 'success', '포장 다시 확인': 'warning', '배송 뒤 바뀜': 'warning' })
    expect(packingWords('배송 완료', '123456789012')).toBe('배송 완료 · 송장 123456789012')
    expect(packingWords('배송 완료', null)).toBe('배송 완료')
    expect(packingWords('포장 완료', null)).toBe('포장 완료')
  })

  it('순서: 포장 다시 확인·배송 뒤 바뀜 먼저, 그다음 표시 이름 한국어 순, 같으면 구매자 ID 순', () => {
    const list = [
      entry('c3', '홍길동'),
      entry('c1', '가람', { status: '포장 완료' }),
      entry('c4', '나비', { status: '배송 뒤 바뀜' }),
      entry('c2', '홍길동'),
      entry('c5', '다솜', { status: '포장 다시 확인' }),
    ]
    expect(sortEntries(list, (e) => e.name).map((e) => e.buyer)).toEqual(['c4', 'c5', 'c1', 'c2', 'c3'])
  })

  it('다음 구매자: 정렬한 "포장할 것"에서 지금 다음 사람, 끝이면 앞에서, 없으면 null', () => {
    const sorted = [entry('a', '가'), entry('b', '나', { status: '포장 완료' }), entry('c', '다'), entry('d', '라')]
    expect(nextBuyer(sorted, 'a')).toBe('c')
    expect(nextBuyer(sorted, 'b')).toBe('c')
    expect(nextBuyer(sorted, 'd')).toBe('a')
    expect(nextBuyer([entry('a', '가')], 'a')).toBeNull()
  })
})

describe('바뀐 품목 (AC-I2-37)', () => {
  it('처음 품목과 지금 품목의 차이 → "새로 담을 것: 31번 · 뺄 것: 28번"', () => {
    const change = diffItems([item(15), item(28)], [item(15), item(31)])
    expect(change.add.map((x) => x.no)).toEqual([31])
    expect(change.remove).toEqual([{ key: 'b1/28', broadcast: 'b1', title: '1부', no: 28 }])
    expect(changeNotice(change, false, false)).toBe('구매 내역이 바뀌었어요 — 새로 담을 것: 31번 · 뺄 것: 28번')
    expect(changeNotice(change, false, true)).toBe('배송한 뒤 구매 내역이 바뀌었어요 — 새로 담을 것: 31번 · 뺄 것: 28번. 따로 보내거나 환불해 주세요.')
    expect(changeWords({ add: [], remove: change.remove }, false)).toBe('뺄 것: 28번')
  })

  it('방송이 둘 이상이면 방송 제목을 붙인다', () => {
    const items = [item(15), item(31, { key: 'b2/31', broadcast: 'b2', title: '2부' })]
    expect(spansBroadcasts(items)).toBe(true)
    expect(spansBroadcasts([item(15), item(28)])).toBe(false)
    expect(changeWords({ add: [items[1] as PackingItem], remove: [] }, true)).toBe('새로 담을 것: 2부 31번')
  })

  it('지금 품목은 1부 7번뿐이고 2부 7번이 빠지면 방송 제목을 붙인다 — "뺄 것: 2부 7번" (TD-I2-002)', () => {
    const now = [item(7)]
    const removed = { key: 'b2/7', broadcast: 'b2', title: '2부', no: 7 }
    expect(spansBroadcasts(now)).toBe(false)
    expect(spansBroadcasts([removed])).toBe(false)
    const change = { add: [], remove: [removed] }
    expect(checklistSpansBroadcasts(now, change)).toBe(true)
    expect(changeNotice(change, checklistSpansBroadcasts(now, change), false)).toBe('구매 내역이 바뀌었어요 — 뺄 것: 2부 7번')
    // 한 방송 안에서만 바뀌면 그대로 "뺄 것: 28번"
    expect(checklistSpansBroadcasts(now, { add: [], remove: [{ key: 'b1/28', broadcast: 'b1', title: '1부', no: 28 }] })).toBe(false)
    // 새로 담을 것이 다른 방송이어도
    expect(checklistSpansBroadcasts(now, { add: [item(7, { key: 'b2/7', broadcast: 'b2', title: '2부' })], remove: [] })).toBe(true)
  })

  it('상품 키 집합 비교', () => {
    expect(sameKeys([item(15), item(28)], [item(28), item(15)])).toBe(true)
    expect(sameKeys([item(15)], [item(15), item(28)])).toBe(false)
  })
})

describe('다시 받는 때 (AC-I2-39·34, LBL-03, SA-I2-002)', () => {
  const base = [register(15, '핑크프릴', 10000), register(28, '청보석', 5000), chat('m1', 'c1', '가나', '15'), chat('m2', 'c2', '다라', '28')]

  it('포장 라벨: 입금 전 찜까지 가격을 바꿔 상품 합계가 바뀌면 달라진다 — 품목 키·품종은 그대로여도', () => {
    const before = dataOf(base)
    const after = dataOf([...base, { type: 'product.update', b: 'b1', no: 15, price: 12000, applyTo: 'UNPAID_CLAIMS' }])
    expect(after.settlements.get(JSON.stringify(['c1', DATE]))?.subtotal).toBe(12000)
    expect(packingLabelSignature(after, 'c1')).not.toBe(packingLabelSignature(before, 'c1'))
    // 포장 목록(품목의 가격 스냅샷)도 다시 받는다
    expect(closingSignature(after)).not.toBe(closingSignature(before))
    // 새 찜에만(NEW_ONLY) 바꾸면 그 묶음의 합계·라벨은 그대로
    const newOnly = dataOf([...base, { type: 'product.update', b: 'b1', no: 15, price: 12000 }])
    expect(packingLabelSignature(newOnly, 'c1')).toBe(packingLabelSignature(before, 'c1'))
  })

  it('포장 라벨: 구매자 표시 이름(닉네임)이 바뀌면 달라진다, 그 묶음과 상관없는 변경(다른 구매자 입금·채팅)에는 그대로', () => {
    const before = dataOf(base)
    const renamed = dataOf([...base, chat('m3', 'c1', '가나다', '안녕하세요')])
    expect(renamed.buyers.get('c1')?.display).toBe('가나다')
    expect(packingLabelSignature(renamed, 'c1')).not.toBe(packingLabelSignature(before, 'c1'))
    const other = dataOf([...base, { type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 5000 }, chat('m4', 'c2', '다라', '감사해요')])
    expect(packingLabelSignature(other, 'c1')).toBe(packingLabelSignature(before, 'c1'))
  })

  it('포장 라벨: 품목·방송 제목이 바뀌면 달라진다', () => {
    const before = dataOf(base)
    expect(packingLabelSignature(dataOf([...base, register(31, '금황', 8000), chat('m5', 'c1', '가나', '31')]), 'c1')).not.toBe(packingLabelSignature(before, 'c1'))
    expect(packingLabelSignature(dataOf([...base, { type: 'host.cancel', b: 'b1', no: 15, buyer: 'c1', reason: '취소 요청' }]), 'c1')).not.toBe(packingLabelSignature(before, 'c1'))
  })
})

describe('주소 (AC-I2-35)', () => {
  it('/packing?date=&buyer= · /settings', () => {
    expect(parseRoute('/packing', '?date=2026-10-18&buyer=UC_A')).toEqual({ name: 'packing', date: '2026-10-18', buyer: 'UC_A' })
    expect(parseRoute('/packing', '?date=10/18')).toEqual({ name: 'packing' })
    expect(routePath({ name: 'packing', date: '2026-10-18', buyer: 'sms:r1' })).toBe('/packing?date=2026-10-18&buyer=sms%3Ar1')
    expect(routePath({ name: 'packing' })).toBe('/packing')
    expect(parseRoute('/settings')).toEqual({ name: 'settings' })
    expect(routePath({ name: 'settings' })).toBe('/settings')
  })
})

describe('파일 이름·크기·시각 (D-I2-01, AC-I2-65)', () => {
  it('Content-Disposition: UTF-8 filename*이 먼저, 없으면 따옴표 이름, 경로·제어 글자는 뺀다', () => {
    expect(fileNameOf(`attachment; filename="receipt-2026-10-18.png"; filename*=UTF-8''${encodeURIComponent('확인서-2026-10-18-길동이.png')}`, 'x')).toBe('확인서-2026-10-18-길동이.png')
    expect(fileNameOf('attachment; filename="receipt-2026-10-18.pdf"', 'x')).toBe('receipt-2026-10-18.pdf')
    expect(fileNameOf(`attachment; filename*=UTF-8''${encodeURIComponent('../a\r\nb.png')}`, 'x')).toBe('..ab.png')
    expect(fileNameOf(null, 'fallback.pdf')).toBe('fallback.pdf')
    expect(fileNameOf("attachment; filename*=UTF-8''%E0%A4%A", 'fallback.pdf')).toBe('fallback.pdf')
  })

  it('크기 "1.2MB"·"3.4KB"', () => {
    expect(sizeWords(1.2 * 1024 * 1024)).toBe('1.2MB')
    expect(sizeWords(3500)).toBe('3.4KB')
    expect(sizeWords(10)).toBe('0.1KB')
  })

  it('KST 시각 "2026년 10월 20일 (화) 04:00" — 실행 환경 시간대와 상관없이', () => {
    expect(kstDateTimeLong('2026-10-19T19:00:00.000Z')).toBe('2026년 10월 20일 (화) 04:00')
    expect(kstDateTimeLong('2026-10-19T14:59:00.000Z')).toBe('2026년 10월 19일 (월) 23:59')
    expect(kstDateTimeLong('엉뚱한 값')).toBe('')
  })
})

describe('가게 설정 (AC-I2-02·65)', () => {
  const shop = { name: '초록다육', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로 적어 주세요' }

  it('확인서에 나올 계좌: 셋 다 있을 때만 "농협 302-9988-7766-11 (예금주 김판매)"와 안내 문장', () => {
    expect(accountPreview(shop)).toEqual({ text: '농협 302-9988-7766-11 (예금주 김판매)', note: '입금자명은 닉네임으로 적어 주세요' })
    expect(accountPreview({ ...shop, accountNote: '  ' })).toEqual({ text: '농협 302-9988-7766-11 (예금주 김판매)', note: null })
    expect(accountPreview({ ...shop, bank: '', accountNumber: '', accountHolder: '' })).toBe('none')
    expect(accountPreview({ ...shop, accountHolder: ' ' })).toBe('partial')
  })

  it('자동 백업이 멈춤: 꺼짐·성공 없음·26시간보다 오래됨', () => {
    const now = Date.parse('2026-10-20T10:00:00.000Z')
    expect(backupStopped({ enabled: true, lastSuccessAt: '2026-10-19T19:00:00.000Z' }, now)).toBe(false)
    expect(backupStopped({ enabled: true, lastSuccessAt: '2026-10-19T07:59:59.000Z' }, now)).toBe(true)
    expect(backupStopped({ enabled: true, lastSuccessAt: '2026-10-19T08:00:00.000Z' }, now)).toBe(false)
    expect(backupStopped({ enabled: false, lastSuccessAt: '2026-10-20T09:00:00.000Z' }, now)).toBe(true)
    expect(backupStopped({ enabled: true, lastSuccessAt: null }, now)).toBe(true)
  })
})

describe('판매대장 주소 (AC-I2-22)', () => {
  it('기간 안 방송을 모두 골랐으면 b를 적지 않는다, 일부면 고른 것만', () => {
    expect(ledgerPath('2026-10-01', '2026-10-31', ['b1', 'b2'], true)).toBe('/api/ledger.xlsx?from=2026-10-01&to=2026-10-31')
    expect(ledgerPath('2026-10-19', '2026-10-19', ['b1', 'b 2'], false)).toBe('/api/ledger.xlsx?from=2026-10-19&to=2026-10-19&b=b1&b=b+2')
  })
})

describe('가져오기 문제 말 (AC-I2-52)', () => {
  it('코드는 보이지 않고 쉬운 말 — 번호 범위는 그 방송의 최대 번호', () => {
    expect(importProblemWords('CELLS', 999)).toBe('번호, 품종, 가격 세 칸이 필요해요.')
    expect(importProblemWords('NUMBER_INVALID', 999)).toBe('번호를 확인해 주세요(1~999).')
    expect(importProblemWords('NUMBER_INVALID', 50)).toBe('번호를 확인해 주세요(1~50).')
    expect(importProblemWords('DUPLICATE', 999)).toBe('목록에 같은 번호가 또 있어요.')
    expect(importProblemWords('EXISTS', 999)).toBe('이 방송에 이미 있는 번호예요.')
    expect(importProblemWords('NAME_PHONE', 999)).toBe('품종에 전화번호처럼 보이는 숫자가 있어요.')
    expect(importProblemWords('PRICE_MISSING', 999)).toBe('가격이 비었어요.')
    expect(importProblemWords('PRICE_INVALID', 999)).toBe('가격을 읽지 못했어요.')
    expect(importProblemWords('PRICE_TOO_LOW', 999)).toBe('가격이 100원보다 적어요.')
  })
})

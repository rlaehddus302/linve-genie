// 앱이 따로 든 규칙이 웹과 같은지 (APP-01 AC5 "같은 낱말", D-088): 낱말 표·구매자 이름 표기·알림 수·찜 상태 낱말·증분 덮기·빠른 입력 읽기.
// 웹 모듈은 코어 전체를 불러오므로 시험에서만 견준다(앱 번들에는 들어가지 않는다).
// @vitest-environment node
import * as webWords from '@livejjim/web/src/lib/words.ts'
import * as webDerive from '@livejjim/web/src/lib/derive.ts'
import * as webScope from '@livejjim/web/src/lib/scope-data.ts'
import * as webQuick from '@livejjim/web/src/lib/quick.ts'
import * as webPacking from '@livejjim/web/src/lib/packing.ts'
import * as webYoutube from '@livejjim/web/src/lib/youtube.ts'
import * as webBuyers from '@livejjim/web/src/lib/buyers.ts'
import { SERVER_ROUTE } from '@livejjim/web/src/lib/extension.ts'
import { PRINT_ACTION as WEB_PRINT_ACTION, PRINT_ALERT_WORD as WEB_PRINT_ALERT_WORD } from '@livejjim/web/src/lib/print-words.ts'
import { CONNECTION_STATE_NAMES } from '@livejjim/printer'
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import * as words from '../src/lib/words.ts'
import * as derive from '../src/lib/derive.ts'
import * as scope from '../src/lib/scope-data.ts'
import * as quick from '../src/lib/quick.ts'
import * as packing from '../src/lib/packing.ts'
import * as youtube from '../src/lib/youtube.ts'
import * as buyers from '../src/lib/buyers.ts'
import { readText } from '../../../packages/voice-session/src/read/index.ts'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { buyer, changes, claim, fullView, product } from './support.ts'

describe('낱말 표가 웹과 같다', () => {
  it('상태·알림·라벨·입금·출력 낱말', () => {
    expect(words.PRODUCT_STATUS_WORD).toEqual(webWords.PRODUCT_STATUS_WORD)
    expect(words.REJECT_REASON_WORD).toEqual(webWords.REJECT_REASON_WORD)
    expect(words.ALERT_WORD).toEqual(webWords.ALERT_WORD)
    expect(words.LABEL_WORD).toEqual(webWords.LABEL_WORD)
    expect(words.PAYMENT_WORD).toEqual(webWords.PAYMENT_WORD)
    expect(words.paymentWord('OVERPAID', 5000)).toBe(webWords.paymentWord('OVERPAID', 5000))
    expect(words.PRINT_ACTION).toEqual(WEB_PRINT_ACTION)
    expect(words.PRINT_ALERT_WORD).toEqual(WEB_PRINT_ALERT_WORD)
    expect(words.CONNECTION_STATE_WORD).toEqual(CONNECTION_STATE_NAMES)
    for (const status of ['CONFIRMED', 'PENDING', 'CONFLICT', 'CANCELLED', 'DUPLICATE'] as const) expect(words.claimStatusWord(status, null, null)).toBe(webWords.claimStatusWord(status, null, null))
    expect(words.claimStatusWord('WAITLISTED', null, 2)).toBe(webWords.claimStatusWord('WAITLISTED', null, 2))
    expect(words.claimStatusWord('REJECTED', 'SOLD_OUT', null)).toBe(webWords.claimStatusWord('REJECTED', 'SOLD_OUT', null))
  })

  it('포장 낱말·거르기·순서', () => {
    expect(packing.PACKING_FILTERS).toEqual(webPacking.PACKING_FILTERS)
    expect(packing.PACKING_TONE).toEqual(webPacking.PACKING_TONE)
    expect(packing.packingWords('배송 완료', '123')).toBe(webPacking.packingWords('배송 완료', '123'))
    expect(packing.itemLineWords({ no: 21, name: '반바지', variant: 'L', qty: 2 })).toBe(webPacking.itemLineWords({ no: 21, name: '반바지', variant: 'L' }) + ' 2개')
    expect(packing.NO_SALES).toBe('아직 판매 기록이 없어요.')
  })
})

describe('고르기 규칙이 웹과 같다', () => {
  const view = fullView({
    products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 'u3'], waitlistClaims: ['c2', 'c3'] }), product(16, { conflict: true, conflictClaim: 'c4', conflictBuyer: 'u1' }), product(17, { awaitingSuccession: true })],
    claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 }), claim('c3', 15, 'u3', { status: 'WAITLISTED', seq: 12 }), claim('c4', 16, 'u1', { status: 'CONFLICT' }), claim('c5', 20, 'u2', { status: 'PENDING', reason: 'UNOPENED', productId: null })],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '홍길동'), buyer('u3', '김영희', { kind: 'sms', phoneLast4: '1234' })],
    pending: [{ product: 'b1/20', broadcast: 'b1', no: 20, buyers: ['u2'], claims: ['c5'] }],
    cancelRequests: [],
    attention: [{ seq: 3, message: '확인' }],
  })
  const mine = scope.fromFull(view)
  const theirs = webScope.fromFull(view)

  it('구매자 이름 표기·찜 낱말', () => {
    expect([...derive.buyerLabels(mine.buyers, mine.claims)]).toEqual([...webDerive.buyerLabels(theirs.buyers, theirs.claims)])
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) expect(derive.claimWord(mine, mine.claims.get(id)!)).toBe(webDerive.claimWord(theirs, theirs.claims.get(id)!))
  })

  it('구매자 화면 고르기·합치기 낱말 (D-APPX-03 — 앱 lib/buyers.ts 사본)', () => {
    const counts = buyers.sameNameCounts(mine.buyers)
    expect([...counts]).toEqual([...webBuyers.sameNameCounts(theirs.buyers)])
    for (const sort of ['name', 'total'] as const) for (const all of [true, false]) expect(buyers.buyerList(mine.buyers, { all, sort }).map((item) => item.id)).toEqual(webBuyers.buyerList(theirs.buyers, { all, sort }).map((item) => item.id))
    for (const id of ['u1', 'u2', 'u3']) {
      expect(buyers.distinguishWords(mine.buyers.get(id)!, counts)).toEqual(webBuyers.distinguishWords(theirs.buyers.get(id)!, webBuyers.sameNameCounts(theirs.buyers)))
      expect(buyers.claimsOf(mine, id).map((item) => item.id)).toEqual(webBuyers.claimsOf(theirs, id).map((item) => item.id))
      expect(buyers.isUnknownSms(mine.buyers.get(id)!)).toBe(webBuyers.isUnknownSms(theirs.buyers.get(id)!))
    }
    expect(buyers.searchBuyers(mine.buyers, '1234').map((hit) => hit.current.id)).toEqual(webBuyers.searchBuyers(theirs.buyers, '1234').map((hit) => hit.current.id))
    expect(buyers.defaultInto(mine.buyers.get('u3')!, mine.buyers.get('u1')!).id).toBe(webBuyers.defaultInto(theirs.buyers.get('u3')!, theirs.buyers.get('u1')!).id)
    const preview = { from: 'u2', into: 'u1', target: 'u1', blocked: null, bothConfirmed: [], duplicates: [{ claim: 'c2', product: 'b1/15', buyer: 'u2', status: 'WAITLISTED' }], moving: { items: ['b1/15'], subtotal: 10_000 }, after: { items: ['b1/15'], subtotal: 20_000 } } as unknown as Parameters<typeof buyers.mergeWords>[2]
    const label = (_b: string, no: number) => `${String(no)}번`
    expect(buyers.mergeWords(mine, new derive.BuyerNames(mine.buyers, mine.claims), preview, label)).toEqual(webBuyers.mergeWords(theirs, new webDerive.BuyerNames(theirs.buyers, theirs.claims), preview, label))
  })

  it('알림 수·상품 자리·보드 순서', () => {
    expect(derive.alertCounts(mine)).toEqual(webDerive.alertCounts(theirs))
    for (const key of mine.products.keys()) expect(derive.productSlots(mine.products.get(key)!)).toEqual(webDerive.productSlots(theirs.products.get(key)!))
    expect(derive.boardProducts(mine, 'b1').map((item) => item.no)).toEqual(webDerive.boardProducts(theirs, 'b1').map((item) => item.no))
    expect(derive.latestProduct(mine, 'b1')?.no).toBe(webDerive.latestProduct(theirs, 'b1')?.no)
  })

  it('정하기 단위·조치 options 칸 (D-APPX-03)', () => {
    for (const key of mine.products.keys()) {
      const a = mine.products.get(key)!
      const b = theirs.products.get(key)!
      expect(derive.successionUnits(a).map((unit) => [unit.product.key, unit.variant?.text ?? null, unit.waitlistClaims])).toEqual(webDerive.successionUnits(b).map((unit) => [unit.product.key, unit.variant?.text ?? null, unit.waitlistClaims]))
      expect(derive.conflictUnits(a).map((unit) => [unit.product.key, unit.variant?.text ?? null])).toEqual(webDerive.conflictUnits(b).map((unit) => [unit.product.key, unit.variant?.text ?? null]))
    }
    for (const id of mine.claims.keys()) expect(derive.claimOptionsField(mine.claims.get(id)!)).toEqual(webDerive.claimOptionsField(theirs.claims.get(id)!))
    expect(derive.variantOptionsField(undefined)).toEqual(webDerive.variantOptionsField(undefined))
  })

  it('증분 덮기 결과가 같다', () => {
    const delta = changes(5, 9, { products: [product(15, { status: 'SOLD' })], claims: [claim('c6', 15, 'u3')], removed: { broadcasts: [], products: [], claims: ['c2'], pending: ['b1/20'], buyers: [], settlements: [], effects: [], cancelRequests: [] }, attention: [{ seq: 3, message: '확인' }, { seq: 8, message: '새 확인' }] })
    const a = scope.applyChanges(mine, delta)
    const b = webScope.applyChanges(theirs, delta)
    const lists = webScope.sortedLists(b)
    expect([...a.products.values()].sort((x, y) => x.key.localeCompare(y.key))).toEqual(lists.products)
    expect([...a.claims.values()].sort((x, y) => x.id.localeCompare(y.id))).toEqual(lists.claims)
    expect([...a.pending.keys()]).toEqual(Object.keys(Object.fromEntries(lists.pending.map((item) => [(item as { product: string }).product, item]))))
    expect(a.attention).toEqual(b.attention)
    expect(a.seq).toBe(b.seq)
    expect(() => scope.applyChanges(mine, changes(4, 9))).toThrow()
  })
})

// SRV1 (D-APP-23·24): 줄 읽기는 서버 한 곳(packages/voice-session/src/read)이다. 옛 기대는 "앱·웹이 각자 읽은 결과가 같다"였고,
// 새 기대는 "서버가 읽은 같은 결과(서버 읽기 입구 kind quick)로 앱·웹이 같은 할 일·같은 문장을 정한다"이다 (견주는 줄·단언은 그대로).
describe('빠른 입력 할 일이 웹과 같다 (서버가 읽은 결과로)', () => {
  const settings = { 'price.unit': DEFAULT_SETTINGS['price.unit'], 'claim.maxNumber': DEFAULT_SETTINGS['claim.maxNumber'] }
  const find = (): Product | undefined => undefined
  /** 서버 읽기 입구가 그 방송 상품으로 읽은 결과 */
  const readQuick = (line: string, findProduct: (no: number) => Product | undefined = find) => {
    const read = readText('quick', line, {
      settings,
      findProduct: (no) => {
        const found = findProduct(no)
        return found === undefined ? undefined : { id: found.id, no: found.no, name: found.name, price: found.price, closed: found.status === 'CLOSED' }
      },
      now: 0,
    })
    if (read.kind !== 'quick') throw new Error('quick')
    return read
  }
  it('등록·오류·단위 줄', () => {
    for (const line of ['15 핑크프릴 10000', '15 핑크프릴 2만', '15 10', '핑크프릴 10000', '15 핑크프릴', '15 핑크프릴 50', '1000 핑크 10', '']) {
      const reading = readQuick(line)
      const a = quick.decideQuick(reading, find)
      const b = webQuick.decisionOf(reading, find)
      expect(a.kind).toBe(b.kind)
      if (a.kind === 'register' && b.kind === 'register') expect([a.no, a.name, a.price]).toEqual([b.no, b.name, b.price])
      if (a.kind === 'fix' && b.kind === 'fix') expect(a.message).toBe(b.message)
    }
    for (const unit of ['WON', 'THOUSAND', 'TEN_THOUSAND', 'AUTO'] as const) expect(quick.unitLine(unit)).toBe(webQuick.unitLine(unit))
    expect(quick.registerPreview(readQuick('15 핑크프릴 10'))).toBe('등록하면: 15번 핑크프릴 10,000원')
    expect(quick.registerPreview(null)).toBeNull()
    expect(quick.editQuestion(15, true)).toBe(webQuick.editQuestion(15, true))
  })
  it('있는 번호는 고치기, 번호만이면 열기', () => {
    const existing = product(15)
    const findExisting = (no: number) => (no === 15 ? existing : undefined)
    expect(quick.decideQuick(readQuick('15 핑크 12000', findExisting), findExisting).kind).toBe('edit')
    expect(quick.decideQuick(readQuick('15', findExisting), findExisting).kind).toBe('open')
    expect(quick.decideQuick(readQuick('15'), find).kind).toBe('fix')
  })
})

describe('유튜브 낱말·판단이 웹과 같다 (YT-11, D-YT-SRV-03·06·07·11)', () => {
  const view = (patch: Record<string, unknown>) => ({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, mode: 'WEB', lastMessageAt: null, recorded: 0, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false, ...patch }) as Parameters<typeof webYoutube.collectorWarning>[0] & object

  it('문장', () => {
    for (const key of ['NOT_CONFIGURED_MESSAGE', 'WEB_CHAT_OFF_MESSAGE', 'WEB_CHAT_RESUMED', 'STOP_WARNING_PREFIX', 'RETRYING_WARN_MS', 'RECENT_AGAIN', 'NO_BROADCAST_TITLE', 'NO_CHANNEL_NAME', 'CHANNEL_NAME_MAX', 'INVITED_CONFIRM_CODE'] as const) {
      expect(youtube[key], key).toEqual(webYoutube[key])
    }
    // D-UX4-112: 옛 기대 "FIRST_CHANNEL_GROUP·RECENT_TITLE·RECENT_EMPTY·RECENT_SEARCHING은 웹과 같은 글" → 앱은 '잇다' 대신 '연결'만 다르고 나머지는 웹 글 그대로
    expect(youtube.FIRST_CHANNEL_GROUP).toBe(webYoutube.FIRST_CHANNEL_GROUP.replace('처음 잇는', '처음 연결하는'))
    for (const key of ['RECENT_TITLE', 'RECENT_EMPTY', 'RECENT_SEARCHING'] as const) expect(youtube[key], key).toBe(webYoutube[key].replace('최근 이은', '최근 연결한'))
    expect(youtube.FIRST_CHANNEL_GROUP).toBe('처음 연결하는 채널 확인')
    expect(youtube.RECENT_TITLE).toBe('최근 연결한 채널의 라이브')
    expect(youtube.WEB_TROUBLE_FALLBACK).toEqual(webYoutube.WEB_TROUBLE_FALLBACK)
    expect([...youtube.WARN_REASONS]).toEqual([...webYoutube.WARN_REASONS])
    expect(youtube.SERVER_ROUTE_SERVER).toBe(SERVER_ROUTE.SERVER)
    // 구글 연결로 읽는 서버의 "먼저 연결" 안내는 웹 콘솔과 같은 문장 (D-UX2-07)
    expect(youtube.NOT_CONNECTED_FIRST).toBe(webYoutube.CONSOLE_NOT_CONNECTED)
    expect(youtube.RECONNECT_FIRST).toBe(webYoutube.RECONNECT_NEEDED_MESSAGE)
    // D-UX4-112: 옛 기대 "웹과 같은 글" → '처음 잇는' 대신 '처음 연결하는'만 다르다
    expect(youtube.firstChannelQuestion('가')).toBe(webYoutube.firstChannelQuestion('가').replace('처음 잇는', '처음 연결하는'))
    expect(youtube.broadcastChannelLine('가')).toBe(webYoutube.broadcastChannelLine('가'))
    for (const title of ['', '  ', '다육이네', '가'.repeat(41), 3]) expect(youtube.channelName(title)).toBe(webYoutube.channelName(title))
  })

  it('경고 문장·다시 받음 전환·최근 줄', () => {
    const views = [
      view({ status: 'RETRYING', reason: 'BLOCKED', reasonMessage: '막힘' }),
      view({ status: 'RETRYING', reason: 'FORMAT' }),
      view({ status: 'STOPPED', reason: 'OPERATOR_OFF' }),
      view({ status: 'RETRYING', statusMessage: '다시 연결하는 중' }),
      view({ status: 'STOPPED', reason: 'CHAT_NOT_FOUND', reasonMessage: '채팅을 찾을 수 없어요.' }),
      view({ status: 'STOPPED', reason: 'UNLINKED' }),
      view({}),
      null,
    ]
    for (const item of views) {
      for (const long of [false, true]) expect(youtube.warningLine(item, long)).toBe(webYoutube.collectorWarning(item, long)?.message ?? null)
      expect(youtube.webChatTrouble(item)).toBe(webYoutube.webChatTrouble(item))
    }
    let mine: youtube.ResumeStep = { trouble: false, resumed: false }
    let theirs: webYoutube.ResumeStep = { trouble: false, resumed: false }
    for (const item of views) {
      mine = youtube.resumeStep(mine, item)
      theirs = webYoutube.resumeStep(theirs, item)
      expect(mine).toEqual(theirs)
    }
    const line = { videoId: 'V', title: '', status: 'LIVE' as const, scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelTitle: null }
    expect(youtube.recentLine(line)).toBe(webYoutube.recentLine(line))
    expect(youtube.readModeOf({ webChat: { on: false }, oauth: false })).toEqual(webYoutube.readModeOf({ webChat: { on: false }, oauth: false }))
  })
})

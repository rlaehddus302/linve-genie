// 영수증 보내기 화면 (N4b AC-N4b-30~35): 실제 코어로 도는 가짜 서버 + 가짜 링크 서버(receipt-buyers·receipt-links).
// 클립보드·navigator.share는 가짜로 바꾼다. 콘솔의 "영수증 보내기"·보조자 막힘·개인정보처리방침 문단도 본다.
import { formatWon, listBuyers, listSettlements } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_BLOCKED, App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import type { ReceiptBuyerRow, ReceiptLink } from '../src/api/types.ts'
import { PrivacyPage } from '../src/components/PolicyPages.tsx'
import { COPIED, COPY_BY_HAND, LINK_REVOKED_DONE, NOT_ENDED, NO_NEW_LINKS, NO_RECEIPT_ROWS, REHEARSAL_NOTE, ReceiptsPage, SAME_DAY_NOTE, revokeQuestion } from '../src/components/ReceiptsPage.tsx'
import { kstMonthDayWeekday } from '../src/lib/kst.ts'
import { linkWords, shareText } from '../src/lib/receipt-links.ts'
import { menuOf, parseRoute, routePath, type Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, apiError, broadcastView, flush, type Call, type Reply } from './support.ts'

const EXPIRES = '2026-11-02T11:31:00.000Z' // KST 11월 2일 (월) 20:31

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

/** 가짜 링크 서버: 구매자 줄은 코어 묶음에서(품목 있는 것, 이름 순), 링크는 메모리. 같은 요청 번호는 처음 답 그대로 */
class FakeReceipts {
  readonly links = new Map<string, ReceiptLink>()
  readonly posts: { path: string; body: Record<string, unknown> }[] = []
  readonly #seen = new Map<string, Reply>()
  failNext: Reply | null = null
  #n = 0

  readonly engine: EngineServer

  constructor(engine: EngineServer) {
    this.engine = engine
    engine.server
      .on('GET', new RegExp(`^/api/days/${DATE}/receipt-buyers`), (call) => ({ body: { date: DATE, rehearsal: call.path.includes('rehearsal=true'), buyers: this.rows(call.path.includes('rehearsal=true')) } }))
      .on('POST', new RegExp(`^/api/days/${DATE}/receipt-links(/all|/revoke)?$`), (call, match) => this.#post(call, match[1] ?? ''))
      .on('GET', new RegExp(`^/api/days/${DATE}/receipts\\.(pdf|zip)`), () => ({ body: {} }))
      .on('GET', /^\/api\/ledger\.xlsx/, () => ({ body: {} }))
  }

  rows(rehearsal: boolean): ReceiptBuyerRow[] {
    const names = new Map(listBuyers(this.engine.state).map((buyer) => [buyer.id, buyer.display]))
    return listSettlements(this.engine.state)
      .filter((s) => s.date === DATE && s.items.length > 0)
      .map((s) => ({
        buyer: s.buyer,
        name: names.get(s.buyer) ?? s.buyer,
        phoneLast4: null,
        itemCount: s.items.length,
        total: s.total,
        payment: s.payment,
        received: s.received,
        remaining: Math.max(s.total - s.received, 0),
        link: rehearsal ? null : (this.links.get(s.buyer) ?? { buyer: s.buyer, status: 'NONE', url: null, expiresAt: null, revokedAt: null }),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  #active(buyer: string): ReceiptLink {
    this.#n++
    const link: ReceiptLink = { buyer, status: 'ACTIVE', url: `http://localhost/r/token${String(this.#n)}`, expiresAt: EXPIRES, revokedAt: null }
    this.links.set(buyer, link)
    return link
  }

  #post(call: Call, kind: string): Reply {
    const body = call.body ?? {}
    this.posts.push({ path: call.path, body })
    const prior = this.#seen.get(String(body.requestId))
    if (prior !== undefined) return prior
    if (this.failNext !== null) {
      const reply = this.failNext
      this.failNext = null
      return reply
    }
    let reply: Reply
    if (kind === '/all') {
      let created = 0
      for (const row of this.rows(false)) {
        if (this.links.get(row.buyer)?.status !== 'ACTIVE') {
          this.#active(row.buyer)
          created++
        }
      }
      reply = { body: { date: DATE, created, links: [...this.links.values()] } }
    } else if (kind === '/revoke') {
      const buyer = String(body.buyer)
      const current = this.links.get(buyer)
      const link: ReceiptLink = { buyer, status: 'REVOKED', url: null, expiresAt: current?.expiresAt ?? null, revokedAt: '2026-10-21T12:00:00.000Z' }
      this.links.set(buyer, link)
      reply = { body: { date: DATE, revoked: true, link } }
    } else {
      const buyer = String(body.buyer)
      const current = this.links.get(buyer)
      reply = current?.status === 'ACTIVE' ? { body: { date: DATE, created: false, link: current } } : { body: { date: DATE, created: true, link: this.#active(buyer) } }
    }
    this.#seen.set(String(body.requestId), reply)
    return reply
  }
}

/** 가나: 15·28번 · 다라: 41번 · 마바: 42번 — 1부를 끝냈다 */
const BASE = [
  register(15, '핑크프릴', 10000),
  register(28, '청보석', 5000),
  register(41, '사파이어', 3000),
  register(42, '금황', 4000),
  chat('m1', 'c1', '가나', '15'),
  chat('m2', 'c1', '가나', '28'),
  chat('m3', 'c2', '다라', '41'),
  chat('m4', 'c3', '마바', '42'),
  { type: 'broadcast.end', b: 'b1' },
]

function Harness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'receipts' ? <ReceiptsPage broadcastId={route.id} navigate={setRoute} shopName="구피 가게" /> : <p>콘솔 {route.name}</p>
}

async function open(events: readonly Record<string, unknown>[] = BASE, ended: readonly string[] = ['b1']) {
  const engine = new EngineServer(events, { ended })
  const receipts = new FakeReceipts(engine)
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<Harness initial={{ name: 'receipts', id: 'b1' }} />)
  await flush(15)
  return { engine, receipts }
}

const rowsList = () => screen.getByRole('list', { name: '구매자' })
const row = (name: string) => screen.getByRole('group', { name })

function stubClipboard(write: (text: string) => Promise<void>) {
  const writeText = vi.fn(write)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as Navigator, { clipboard: { writeText } }))
  return writeText
}

describe('링크 글 (AC-N4b-33)', () => {
  it('링크 상태 말과 복사 글 — KST 월·일·요일·시각, 링크가 맨 끝', () => {
    expect(kstMonthDayWeekday(EXPIRES)).toBe('11월 2일 (월)')
    expect(linkWords({ buyer: 'c1', status: 'ACTIVE', url: 'u', expiresAt: EXPIRES, revokedAt: null })).toBe('링크 있음 · 11월 2일 (월) 20:31까지')
    expect(linkWords({ buyer: 'c1', status: 'EXPIRED', url: null, expiresAt: EXPIRES, revokedAt: null })).toBe('링크 기간 지남')
    expect(linkWords({ buyer: 'c1', status: 'REVOKED', url: null, expiresAt: EXPIRES, revokedAt: EXPIRES })).toBe('링크 끊음')
    expect(linkWords(null)).toBe('링크 없음')
    expect(shareText('구피 가게', EXPIRES, 'https://a.example/r/x')).toBe('구피 가게 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. https://a.example/r/x')
  })
})

describe('영수증 보내기 화면 (AC-N4b-31·32)', () => {
  it('머리: 제목·날짜(요일)·방송 제목·같은 날 다른 방송 안내·고지, 한 번에 하는 버튼 넷(주 버튼 "링크 전부 만들기")', async () => {
    await open()
    expect(screen.getByRole('heading', { level: 1, name: '영수증 보내기' })).toBeDefined()
    expect(screen.getByText('2026-10-19 (월)')).toBeDefined()
    expect(screen.getByText('1부')).toBeDefined()
    expect(screen.getByText(SAME_DAY_NOTE)).toBeDefined()
    expect(screen.getByText(/세법상 증빙이 아니에요/)).toBeDefined()
    const primary = document.querySelectorAll('main .button-primary')
    expect([...primary].map((el) => el.textContent)).toEqual(['링크 전부 만들기'])
    for (const name of ['전원 확인서 PDF', '전원 이미지(JPG) 묶음', '이 방송 판매대장 엑셀']) expect(screen.getByRole('button', { name })).toBeDefined()
  })

  it('구매자 줄: 일괄 순서, 이름·상품 수·최종 금액·입금 상태·링크 상태, 줄마다 JPG·PDF', async () => {
    const { engine } = await open()
    const totalOf = (buyer: string) => listSettlements(engine.state).find((x) => x.buyer === buyer)?.total ?? -1
    const items = within(rowsList()).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const ga = row('가나')
    expect(within(ga).getByText('상품 2개')).toBeDefined()
    expect(within(ga).getByText(formatWon(totalOf('c1')))).toBeDefined()
    expect(items.map((item) => item.querySelector('.receipt-row-name')?.textContent)).toEqual(['가나', '다라', '마바'])
    expect(within(ga).getByText('미입금')).toBeDefined()
    expect(within(ga).getByText('링크 없음')).toBeDefined()
    expect(within(row('마바')).getByText('미입금')).toBeDefined()
    expect(within(ga).getByRole('button', { name: '이미지(JPG)' })).toBeDefined()
    expect(within(ga).getByRole('button', { name: 'PDF' })).toBeDefined()
    // 모든 구매자 링크를 한꺼번에 복사·공유하는 버튼은 없다
    expect(screen.queryByRole('button', { name: /전부 복사|모두 복사|전원 복사/ })).toBeNull()
  })

  it('판매대장은 그 날짜·이 방송만, 전원 파일은 그 날짜 범위로 받는다', async () => {
    const { engine } = await open()
    fireEvent.click(screen.getByRole('button', { name: '이 방송 판매대장 엑셀' }))
    fireEvent.click(screen.getByRole('button', { name: '전원 이미지(JPG) 묶음' }))
    fireEvent.click(screen.getByRole('button', { name: '전원 확인서 PDF' }))
    await flush(10)
    expect(engine.server.callsTo('GET', /^\/api\/ledger\.xlsx/).map((c) => c.path)).toEqual([`/api/ledger.xlsx?from=${DATE}&to=${DATE}&b=b1`])
    expect(engine.server.callsTo('GET', /receipts\.zip/).map((c) => c.path)).toEqual([`/api/days/${DATE}/receipts.zip`])
    expect(engine.server.callsTo('GET', /receipts\.pdf/).map((c) => c.path)).toEqual([`/api/days/${DATE}/receipts.pdf`])
  })

  it('"링크 전부 만들기": 링크 N개를 만들었어요 → 다시 누르면 새로 만들 링크가 없어요', async () => {
    const { receipts } = await open()
    fireEvent.click(screen.getByRole('button', { name: '링크 전부 만들기' }))
    await flush(10)
    expect(screen.getByText('링크 3개를 만들었어요.')).toBeDefined()
    expect(within(row('가나')).getByText('링크 있음 · 11월 2일 (월) 20:31까지')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '링크 전부 만들기' }))
    await flush(10)
    expect(screen.getByText(NO_NEW_LINKS)).toBeDefined()
    const ids = receipts.posts.map((p) => p.body.requestId)
    expect(new Set(ids).size).toBe(2)
  })

  it('다른 기기에서 입금하면 실시간 알림으로 줄의 입금 상태가 바뀐다', async () => {
    const { engine } = await open()
    expect(within(row('다라')).getByText('미입금')).toBeDefined()
    const total = listSettlements(engine.state).find((x) => x.buyer === 'c2')?.total ?? 0
    act(() => engine.write({ type: 'settlement.payment', buyer: 'c2', date: DATE, amount: total }))
    await flush(15)
    expect(within(row('다라')).getByText('입금 완료')).toBeDefined()
  })

  it('품목 있는 묶음이 없으면 안내 한 줄과 판매대장만', async () => {
    await open([{ type: 'broadcast.end', b: 'b1' }])
    expect(screen.getByText(NO_RECEIPT_ROWS)).toBeDefined()
    expect(screen.queryByRole('button', { name: '링크 전부 만들기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '전원 확인서 PDF' })).toBeNull()
    expect(screen.getByRole('button', { name: '이 방송 판매대장 엑셀' })).toBeDefined()
  })

  it('방송 중이면 목록 대신 "방송을 끝낸 뒤 보낼 수 있어요."와 콘솔로 돌아가기', async () => {
    await open(BASE.slice(0, -1), [])
    expect(screen.getByText(NOT_ENDED)).toBeDefined()
    expect(screen.queryByRole('list', { name: '구매자' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: '콘솔로 돌아가기' }))
    expect(screen.getByText('콘솔 console')).toBeDefined()
  })
})

describe('줄의 링크 조치 (AC-N4b-33·34)', () => {
  it('링크 만들기 → 링크 있음·복사·끊기, 포커스는 "링크 복사"로, 결과는 알림 영역', async () => {
    await open()
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 만들기' }))
    await flush(10)
    const ga = row('가나')
    expect(within(ga).getByText('링크 있음 · 11월 2일 (월) 20:31까지')).toBeDefined()
    expect(within(ga).getByRole('status').textContent).toBe('링크를 만들었어요.')
    expect(document.activeElement).toBe(within(ga).getByRole('button', { name: '링크 복사' }))
    expect(within(ga).queryByRole('button', { name: '링크 만들기' })).toBeNull()
    // navigator.share가 없는 기기: "링크 보내기"가 없다
    expect(within(ga).queryByRole('button', { name: '링크 보내기' })).toBeNull()
  })

  it('링크 복사: 클립보드에 글 한 줄, "복사했어요." — 클립보드를 못 쓰면 고른 글 칸과 "길게 눌러 복사해 주세요."', async () => {
    const { receipts } = await open()
    receipts.links.set('c1', { buyer: 'c1', status: 'ACTIVE', url: 'http://localhost/r/abc', expiresAt: EXPIRES, revokedAt: null })
    cleanup()
    const writeText = stubClipboard(async () => {})
    render(<Harness initial={{ name: 'receipts', id: 'b1' }} />)
    await flush(15)
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 복사' }))
    await flush(5)
    expect(writeText).toHaveBeenCalledWith('구피 가게 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. http://localhost/r/abc')
    expect(within(row('가나')).getByRole('status').textContent).toBe(COPIED)

    stubClipboard(async () => {
      throw new DOMException('막힘', 'NotAllowedError')
    })
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 복사' }))
    await flush(5)
    const field = within(row('가나')).getByLabelText(COPY_BY_HAND) as HTMLInputElement
    expect(field.value).toBe('구피 가게 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. http://localhost/r/abc')
    expect(field.readOnly).toBe(true)
    expect(document.activeElement).toBe(field)
  })

  it('TE-N4b-002: 다른 기기에서 가게 이름을 바꾸면(가게 설정 알림) 복사 글도 서버의 새 가게 이름 — 빈 이름이면 로그인 정보의 이름', async () => {
    const engine = new EngineServer(BASE, { ended: ['b1'] })
    const receipts = new FakeReceipts(engine)
    receipts.links.set('c1', { buyer: 'c1', status: 'ACTIVE', url: 'http://localhost/r/abc', expiresAt: EXPIRES, revokedAt: null })
    let shopName = '구피 가게'
    engine.server.on('GET', /^\/api\/shop$/, () => ({ body: { shop: { name: shopName, bank: '', accountNumber: '', accountHolder: '', accountNote: '' } } }))
    vi.stubGlobal('fetch', engine.server.fetch)
    const writeText = stubClipboard(async () => {})
    render(<Harness initial={{ name: 'receipts', id: 'b1' }} />)
    await flush(15)
    expect(engine.server.callsTo('GET', /^\/api\/shop$/)).toHaveLength(1)
    shopName = '초록다육'
    act(() => FakeEventSource.last.emit('shop', {}))
    await flush(15)
    expect(engine.server.callsTo('GET', /^\/api\/shop$/)).toHaveLength(2)
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 복사' }))
    await flush(5)
    expect(writeText).toHaveBeenLastCalledWith('초록다육 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. http://localhost/r/abc')

    // 서버가 빈 이름을 주면(그럴 일은 없지만) 앞서 읽은 이름 그대로
    shopName = ''
    act(() => FakeEventSource.last.emit('shop', {}))
    await flush(15)
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 복사' }))
    await flush(5)
    expect(writeText).toHaveBeenLastCalledWith('초록다육 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. http://localhost/r/abc')
  })

  it('링크 보내기: 글 공유를 받는 기기만 — 같은 글(text)만 넘기고 파일은 없다, 닫으면 아무 안내도 없다', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('닫음', 'AbortError')
    })
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as Navigator, { share, canShare: () => true }))
    const { receipts } = await open()
    receipts.links.set('c1', { buyer: 'c1', status: 'ACTIVE', url: 'http://localhost/r/abc', expiresAt: EXPIRES, revokedAt: null })
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 만들기' }))
    await flush(10)
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 보내기' }))
    await flush(5)
    expect(share).toHaveBeenCalledWith({ text: '구피 가게 구매 내역 확인서예요. 11월 2일 (월)까지 열 수 있어요. http://localhost/r/abc' })
    expect(within(row('가나')).getByRole('status').textContent).toBe('')
    expect(within(row('가나')).queryByRole('alert')).toBeNull()
  })

  it('링크 끊기: 확인 창(처음 포커스 "닫기", Esc는 보내지 않음) → 숫자 1로 끊기 → "링크를 끊었어요."·링크 끊음·포커스 "링크 만들기"', async () => {
    const { receipts } = await open()
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 만들기' }))
    await flush(10)
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 끊기' }))
    const dialog = screen.getByRole('dialog', { name: '링크 끊기' })
    expect(within(dialog).getByText(revokeQuestion('가나'))).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await flush(3)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(within(row('가나')).getByRole('button', { name: '링크 끊기' }))
    expect(receipts.posts.filter((p) => p.path.endsWith('/revoke'))).toHaveLength(0)

    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 끊기' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: '링크 끊기' }), { key: '1' })
    await flush(10)
    expect(receipts.posts.filter((p) => p.path.endsWith('/revoke')).map((p) => p.body.buyer)).toEqual(['c1'])
    const ga = row('가나')
    expect(within(ga).getByRole('status').textContent).toBe(LINK_REVOKED_DONE)
    expect(within(ga).getByText('링크 끊음')).toBeDefined()
    expect(document.activeElement).toBe(within(ga).getByRole('button', { name: '링크 만들기' }))
  })

  it('보내는 동안 버튼이 잠기고(두 번 눌러도 하나), 연결이 끊겨 다시 보내면 같은 요청 번호', async () => {
    const { receipts, engine } = await open()
    receipts.failNext = { network: true }
    const button = within(row('가나')).getByRole('button', { name: '링크 만들기' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await flush(5)
    // withRetry가 같은 번호로 다시 보낸다 (가짜 서버는 첫 번째를 끊는다)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
    })
    await flush(10)
    const ids = receipts.posts.filter((p) => !p.path.endsWith('/all') && !p.path.endsWith('/revoke')).map((p) => p.body.requestId)
    expect(ids.length).toBeGreaterThanOrEqual(1)
    expect(new Set(ids).size).toBe(1)
    expect(engine.server.callsTo('POST', /receipt-links$/).length).toBe(ids.length)
  })

  it('서버가 거절하면 서버 문장 그대로', async () => {
    const { receipts } = await open()
    receipts.failNext = apiError(409, 'NO_ITEMS', '확인서를 만들 상품이 없어요.')
    fireEvent.click(within(row('가나')).getByRole('button', { name: '링크 만들기' }))
    await flush(10)
    expect(within(row('가나')).getByRole('alert').textContent).toContain('확인서를 만들 상품이 없어요.')
  })
})

describe('리허설 (AC-N4b-31)', () => {
  it('링크·판매대장 없이 안내 한 줄, 주 버튼 "전원 확인서 PDF"', async () => {
    const engine = new EngineServer(BASE, { ended: ['b1'] })
    new FakeReceipts(engine)
    engine.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ id: 'r1', date: DATE, title: '연습', rehearsal: true, ended: true, endedAt: null }] } }))
    engine.server.on('GET', new RegExp(`^/api/days/${DATE}\\?rehearsal=true$`), () => rehearsalView())
    engine.server.on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)&rehearsal=true`), () => ({ body: { date: DATE, rehearsal: true, seq: 0, changes: [] } }))
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<Harness initial={{ name: 'receipts', id: 'r1' }} />)
    await flush(15)
    expect(screen.getByText(REHEARSAL_NOTE)).toBeDefined()
    expect(screen.queryByRole('button', { name: '링크 전부 만들기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '이 방송 판매대장 엑셀' })).toBeNull()
    expect([...document.querySelectorAll('main .button-primary')].map((el) => el.textContent)).toEqual(['전원 확인서 PDF'])
    expect(screen.queryByRole('button', { name: '링크 만들기' })).toBeNull()
    expect(screen.queryByText('링크 없음')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '전원 이미지(JPG) 묶음' }))
    await flush(5)
    expect(engine.server.callsTo('GET', /receipts\.zip/).map((c) => c.path)).toEqual([`/api/days/${DATE}/receipts.zip?rehearsal=true`])
  })
})

/** 리허설 범위 조회: 끝난 리허설 방송 r1 하나 (구매자 줄은 가짜 링크 서버가 준다) */
function rehearsalView(): Reply {
  return {
    body: {
      date: DATE,
      rehearsal: true,
      seq: 0,
      attention: [],
      broadcasts: [broadcastView({ id: 'r1', title: '연습', ended: true, endedAt: '2026-10-19T12:00:00.000Z' })],
      products: [],
      claims: [],
      pending: [],
      buyers: [],
      settlements: [],
      effects: [],
      cancelRequests: [],
    },
  }
}

describe('개인정보처리방침 초안 (AC-N4b-35)', () => {
  it('"구매자 확인서 공유 링크" 문단 — 로그인 없이 한 명의 내역·금액·계좌, 14일·끊기, 끝 4자리', () => {
    render(<PrivacyPage />)
    const section = screen.getByRole('region', { name: '12. 구매자 확인서 공유 링크' })
    expect(section.textContent).toContain('로그인 없이 그 구매자 한 명의 구매 내역·결제 금액·입금 계좌')
    expect(section.textContent).toContain('14일 뒤에 열리지 않아요')
    expect(section.textContent).toContain('언제든 링크를 끊을 수 있어요')
    expect(section.textContent).toContain('끝 4자리만')
    expect(screen.getByText(/초안이에요/)).toBeDefined()
  })
})

describe('콘솔의 "영수증 보내기" (AC-N4b-30)', () => {
  it('끝난 방송의 콘솔: 주 버튼은 "영수증 보내기" 하나 — 누르면 /broadcasts/b1/receipts로', async () => {
    const engine = new EngineServer(BASE, { ended: ['b1'] })
    vi.stubGlobal('fetch', engine.server.fetch)
    const navigate = vi.fn()
    render(<ConsolePage broadcastId="b1" navigate={navigate} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    const link = screen.getByRole('link', { name: '영수증 보내기' })
    expect(link.getAttribute('href')).toBe('/broadcasts/b1/receipts')
    expect([...document.querySelectorAll('main .button-primary')].map((el) => el.textContent)).toEqual(['영수증 보내기'])
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith({ name: 'receipts', id: 'b1' })
  })

  it('방송 중 콘솔에는 없다', async () => {
    const engine = new EngineServer(BASE.slice(0, -1))
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    expect(screen.queryByRole('link', { name: '영수증 보내기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '영수증 보내기' })).toBeNull()
  })

  it('보조자 계정이 주소로 열면 막힌 안내만 — 구매자 줄·링크 요청을 보내지 않는다', async () => {
    const engine = new EngineServer(BASE, { ended: ['b1'] })
    new FakeReceipts(engine)
    engine.server.on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'helper', role: 'ASSISTANT', assistant: { name: '도우미' } } }))
    vi.stubGlobal('fetch', engine.server.fetch)
    window.history.replaceState(null, '', '/broadcasts/b1/receipts')
    render(<App />)
    await flush(15)
    expect(screen.getByText(ASSISTANT_BLOCKED)).toBeDefined()
    expect(engine.server.callsTo('GET', /receipt/)).toHaveLength(0)
    window.history.replaceState(null, '', '/')
  })

  it('주소 /broadcasts/<ID>/receipts ↔ 화면', () => {
    expect(parseRoute('/broadcasts/b%201/receipts')).toEqual({ name: 'receipts', id: 'b 1' })
    expect(parseRoute('/broadcasts/b1/receipts/')).toEqual({ name: 'receipts', id: 'b1' })
    expect(routePath({ name: 'receipts', id: 'b 1' })).toBe('/broadcasts/b%201/receipts')
    expect(menuOf({ name: 'receipts', id: 'b1' })).toBe('broadcasts')
    expect(parseRoute('/broadcasts/b1')).toEqual({ name: 'console', id: 'b1' })
  })
})

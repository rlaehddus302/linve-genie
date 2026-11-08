// EP1 우체국 창구소포 간편사전접수 화면 (PARCEL_RULES PC-9): 택배 화면의 우체국 안내·단추·무리·주소 파일, 그리고 앱 안 우체국 화면 —
// 우체국 쪽에서만 칸 채우기 → 입력 완료 → 접수번호 찾기 → 판매자 확인 뒤 잇기 → 다음 주문. 전에 입력한 주문은 신청 내역부터 묻는다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpostFillView, ParcelDay, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { setNativeModules } from '../src/native/index.ts'
import { shareFile } from '../src/native/share.ts'
import { EpostScreen } from '../src/screens/EpostScreen.tsx'
import { ParcelsScreen } from '../src/screens/ParcelsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

// 앱 안 웹 화면은 가짜: 받은 속성과 넣은 스크립트·연 주소를 모은다
const web = vi.hoisted(() => ({
  props: [] as { url: string; testID?: string; beforeLoad?: string; onMessage: (data: string) => void; onLoaded: (url: string) => void }[],
  injected: [] as string[],
  loaded: [] as string[],
}))
vi.mock('../src/native/epost-view.tsx', () => ({
  EpostView: forwardRef(function FakeEpostView(props: { url: string; testID?: string; beforeLoad?: string; onMessage: (data: string) => void; onLoaded: (url: string) => void }, ref) {
    web.props.push(props)
    useImperativeHandle(ref, () => ({ inject: (script: string) => web.injected.push(script), goBack: () => undefined, load: (url: string) => web.loaded.push(url) }))
    return <div data-testid={props.testID} />
  }),
}))

const DATE = '2026-10-29'
const row = (buyer: string, name: string, patch: Partial<ParcelRow> = {}): ParcelRow => ({
  buyer,
  name,
  phoneLast4: null,
  itemCount: 2,
  qty: 2,
  total: 14_000,
  payment: 'PAID',
  packing: '포장 완료',
  shipping: 'FIXED',
  address: 'CONFIRMED',
  ready: true,
  reason: null,
  message: null,
  box: '80',
  parcel: null,
  epost: null,
  ...patch,
})

const day = (patch: Partial<ParcelDay> = {}): ParcelDay => ({
  date: DATE,
  seq: 5,
  blocked: { code: 'NO_AUTO_BOOK', message: '고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요.' },
  carrier: { code: 'EPOST', name: '우체국택배' } as ParcelDay['carrier'],
  box: '80',
  ready: [row('u1', '다육맘'), row('u2', '초록손', { epost: { state: 'FILLED', word: '우체국 입력 완료', receiptNo: null, at: '2026-10-29T01:00:00.000Z' } })],
  excluded: [],
  booked: [],
  epost: [row('u5', '금황', { epost: { state: 'RECEIVED', word: '우체국 사전접수 완료', receiptNo: '6012345678901', at: '2026-10-29T02:00:00.000Z' } })],
  ...patch,
})

const fillView = (patch: Partial<ParcelRow> = {}): EpostFillView => ({
  date: DATE,
  buyer: 'u1',
  fill: {
    receiver: { name: '홍길동', zip: '04524', address: '서울특별시 중구 세종대로 110', detail: '101동 202호', mobile: ['010', '1234', '5678'], phone: null },
    sender: { name: '다육이네', zip: '16490', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', mobile: null, phone: ['031', '123', '4567'] },
    item: '식물',
    qty: 2,
    memo: '',
  },
  row: row('u1', '다육맘', patch),
  pages: { apply: 'https://service.epost.go.kr/apply', history: 'https://www.epost.go.kr/history', guestHistory: 'https://service.epost.go.kr/guest' },
  hosts: ['service.epost.go.kr', 'www.epost.go.kr', 'epost.go.kr'],
  form: { sections: { receiver: ['받는분'], sender: ['보내는분'] }, fields: { name: ['성명'], zip: ['우편번호'], address: ['주소'], detail: ['상세주소'], mobile: ['휴대전화'], phone: ['일반전화'], item: ['내용품'], memo: ['메모'] }, selectors: {}, receiptWords: ['접수번호'] },
})

function world(options: { fill?: EpostFillView; day?: ParcelDay } = {}) {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  w.server.on('GET', /^\/api\/parcels\/days$/, () => ({ body: { dates: [{ date: DATE, ready: 2, booked: 0 }], selected: DATE } }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: options.day ?? day() }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost\?buyer=u1$/, () => ({ body: options.fill ?? fillView() }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost\?buyer=u2$/, () => ({ body: secondView() }))
  w.server.on('POST', /^\/api\/parcels\/days\/2026-10-29\/epost$/, (call) => {
    posts.push({ path: call.path, body: call.body })
    const action = call.body?.['action']
    const epost = action === 'RECEIVED' ? { state: 'RECEIVED', word: '우체국 사전접수 완료', receiptNo: call.body?.['receiptNo'], at: '2026-10-29T03:00:00.000Z' } : action === 'FILLED' ? { state: 'FILLED', word: '우체국 입력 완료', receiptNo: null, at: '2026-10-29T03:00:00.000Z' } : null
    return { body: { row: row('u1', '다육맘', { epost: epost as ParcelRow['epost'] }) } }
  })
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost-addresses\.xlsx$/, () => ({ bytes: new Uint8Array([80, 75, 3, 4]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return { w, posts }
}

/** 두 번째 받는 분 (여러 명 한 번에 — D-EP1-19) */
const secondView = (): EpostFillView => ({ ...fillView(), buyer: 'u2', fill: { ...fillView().fill, receiver: { ...fillView().fill.receiver, name: '김초록', mobile: ['010', '2222', '3333'] } }, row: row('u2', '초록손'), form: { ...fillView().form, batch: { next: 'a#subStep2', add: '받는 분 추가', list: '#recevList > li', agree: '[name="broken_agree"]' } } })

const message = (value: Record<string, unknown>) => JSON.stringify({ source: 'livejjim-epost', ...value })
/** 쪽에 넣은 일 스크립트 (새 창 판 스크립트는 쪽마다 먼저 들어가므로 빼고 따로 본다) */
const work = () => web.injected.filter((script) => !script.includes('window.open=') && !script.includes("type:'password'"))
const lastWeb = () => web.props.filter((props) => props.testID === 'epost-web').at(-1)!

beforeEach(() => setNativeModules({ webSession: null }))

afterEach(() => {
  web.props.length = 0
  web.injected.length = 0
  web.loaded.length = 0
  setNativeModules({ shareFile })
})

describe('택배 화면 — 우체국을 고른 판매자', () => {
  // D-EP1-21: main의 택배 화면에 넣으며 안내 글·파일 단추 이름이 바뀜 (시험 내용은 같다)
  it('막힘 문장 대신 우체국 안내, 택배 접수 단추·크기 고르기 대신 [N명 우체국 사전접수]·줄마다 [우체국 사전접수], 입력 완료 꼬리표, 사전접수한 무리, 주소 파일', async () => {
    const { w } = world()
    const opened: string[] = []
    const shared: { name: string; type: string }[] = []
    setNativeModules({ shareFile: async (_bytes, name, type) => void shared.push({ name, type }) })
    render(w.wrap(<ParcelsScreen onBack={() => undefined} nav={{ openEpost: (date, buyers) => opened.push(`${date}/${buyers.join(',')}`) }} />))
    expect(await screen.findByText(/우체국 신청서 하나에 차례로 넣어 드려요/)).toBeTruthy()
    expect(screen.queryByText(/포장 화면에서 송장번호를 직접 적어 주세요/)).toBeNull()
    expect(screen.queryByRole('button', { name: /택배 접수하기/ })).toBeNull()
    // D-EP1-19: 여러 명을 한 신청서에 — 고르기 칸으로 고른 주문을 한 번에 (크기 고르기는 없다)
    expect(screen.getByRole('checkbox', { name: '다육맘 고르기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /택배 크기/ })).toBeNull()
    expect(screen.getByText('우체국 입력 완료 · 신청했는지 확인해 주세요')).toBeTruthy()
    expect(screen.getByText('우체국에 사전접수했어요 · 1개')).toBeTruthy()
    expect(screen.getByText('우체국 사전접수 완료 · 접수번호 6012345678901')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다육맘 우체국 사전접수' }))
    expect(opened).toEqual(['2026-10-29/u1'])
    fireEvent.click(screen.getByRole('button', { name: '2명 우체국 사전접수' }))
    expect(opened).toEqual(['2026-10-29/u1', '2026-10-29/u1,u2'])
    fireEvent.click(screen.getByRole('checkbox', { name: '초록손 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: '1명 우체국 사전접수' }))
    expect(opened.at(-1)).toBe('2026-10-29/u1')
    fireEvent.click(screen.getByRole('button', { name: '창구소포 주소 파일 (엑셀)' }))
    await waitFor(() => expect(shared).toEqual([{ name: '우체국-주소-2026-10-29.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]))
  })

  it('접수 기록 지우기는 한 번 더 묻고 CLEAR를 보낸다', async () => {
    const { w, posts } = world()
    render(w.wrap(<ParcelsScreen onBack={() => undefined} nav={{ openEpost: () => undefined }} />))
    fireEvent.click(await screen.findByRole('button', { name: '금황 접수 기록 지우기' }))
    expect(screen.getByText(/우체국 화면에서 신청을 먼저 취소했을 때만 지워 주세요/)).toBeTruthy()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    await waitFor(() => expect(posts.map((post) => post.body?.['action'])).toEqual(['CLEAR']))
    expect(posts[0]!.body).toMatchObject({ buyer: 'u5' })
  })
})

describe('앱 안 우체국 화면 — 여러 명 한 번에 (D-EP1-19)', () => {
  const batchFill = (): EpostFillView => ({ ...fillView(), form: { ...fillView().form, batch: { next: 'a#subStep2', add: '받는 분 추가', list: '#recevList > li', agree: '[name="broken_agree"]' } } })
  it('채움 → [다음] → [받는 분 추가] → 다음 사람 채움 → [다음] → 끝. 목록에 넣은 사람마다 입력 완료, 접수번호는 모두에게 잇는다', async () => {
    const { w, posts } = world({ fill: batchFill() })
    render(w.wrap(<EpostScreen date={DATE} buyers={['u1', 'u2']} nav={{ onBack: () => undefined }} />))
    expect(await screen.findByText(/1\/2 · 다육맘/)).toBeTruthy()
    await waitFor(() => expect(web.props.filter((props) => props.testID === 'epost-web').length).toBeGreaterThan(0))
    lastWeb().onLoaded('https://m.epost.go.kr/form')
    expect(work().at(-2)).toContain('홍길동')
    // 첫 사람 채움 → [다음] 스크립트
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name', 'receiver.zip'], readonly: [], missing: ['item'], ambiguous: [] }))
    expect(work().at(-1)).toContain('subStep2')
    expect(work().at(-1)).not.toContain('홍길동')
    // 늦게 채운 칸의 답이 또 와도 [다음]을 두 번 누르지 않는다
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name', 'receiver.zip', 'item'], readonly: [], missing: [], ambiguous: [] }))
    expect(work().filter((script) => script.includes('subStep2') && script.includes('next.click'))).toHaveLength(1)
    // [필수동의] 전이면 멈추고 안내 → [이어서 넣기]
    lastWeb().onMessage(message({ type: 'commit', ok: false, reason: 'agree', count: 0, messages: [] }))
    expect(await screen.findByText(/\[필수동의\] 우편금지물품 안내 확인에 체크한 뒤/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '이어서 넣기' }))
    expect(work().filter((script) => script.includes('next.click'))).toHaveLength(2)
    lastWeb().onMessage(message({ type: 'commit', ok: true, reason: null, count: 1, messages: ['결제 정보가 입력되지 않았습니다.'] }))
    await waitFor(() => expect(posts.map((post) => [post.body?.['buyer'], post.body?.['action']])).toEqual([['u1', 'FILLED']]))
    expect(work().at(-1)).toContain('받는 분 추가')
    // 칸이 비면 둘째 사람 채움
    lastWeb().onMessage(message({ type: 'added', ok: true }))
    expect(await screen.findByText(/2\/2 · 초록손/)).toBeTruthy()
    expect(work().at(-1)).toContain('김초록')
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name'], readonly: [], missing: [], ambiguous: [] }))
    lastWeb().onMessage(message({ type: 'commit', ok: true, reason: null, count: 2, messages: [] }))
    expect(await screen.findByText(/받는 분을 모두 우체국 목록에 넣었어요/)).toBeTruthy()
    expect(screen.getByText('목록에 2명')).toBeTruthy()
    await waitFor(() => expect(posts.map((post) => [post.body?.['buyer'], post.body?.['action']])).toEqual([['u1', 'FILLED'], ['u2', 'FILLED']]))
    // 접수번호는 목록에 넣은 두 주문 모두에
    fireEvent.click(screen.getByRole('button', { name: '접수번호 잇기' }))
    expect(screen.getByText(/목록에 넣은 주문 2개에 같은 번호를 이어요/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '접수번호' }), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: '잇기' }))
    await waitFor(() => expect(posts.filter((post) => post.body?.['action'] === 'RECEIVED').map((post) => post.body?.['buyer'])).toEqual(['u1', 'u2']))
    expect(await screen.findByText(/주문 2개를 우체국 사전접수 완료로 적었어요/)).toBeTruthy()
  })

  it('우체국이 받는 분을 받지 않으면 멈추고 우체국 문장을 보인다', async () => {
    const { w } = world({ fill: batchFill() })
    render(w.wrap(<EpostScreen date={DATE} buyers={['u1', 'u2']} nav={{ onBack: () => undefined }} />))
    await screen.findByText(/1\/2 · 다육맘/)
    await waitFor(() => expect(web.props.filter((props) => props.testID === 'epost-web').length).toBeGreaterThan(0))
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name'], readonly: [], missing: [], ambiguous: [] }))
    lastWeb().onMessage(message({ type: 'commit', ok: false, reason: 'refused', count: 0, messages: ['받는 분 연락처를 입력해 주세요.'] }))
    expect(await screen.findByText(/우체국 화면이 이 받는 분을 받지 않았어요/)).toBeTruthy()
    expect(screen.getByText('우체국: 받는 분 연락처를 입력해 주세요.')).toBeTruthy()
  })

  it('보내는 사람 전화가 휴대전화가 아니면 우체국 화면에 직접 넣으라고 먼저 알린다 (실제 신청서가 [다음]을 받지 않는다)', async () => {
    const { w } = world()
    const first = render(w.wrap(<EpostScreen date={DATE} buyers={['u1']} nav={{ onBack: () => undefined }} />))
    expect(await screen.findByText(/우체국은 보내는 분 휴대전화를 꼭 받아요/)).toBeTruthy()
    first.unmount()
    const mobile = fillView()
    const { w: w2 } = world({ fill: { ...mobile, fill: { ...mobile.fill, sender: { ...mobile.fill.sender, mobile: ['010', '9876', '5432'], phone: null } } } })
    render(w2.wrap(<EpostScreen date={DATE} buyers={['u1']} nav={{ onBack: () => undefined }} />))
    await screen.findByText('다육맘')
    expect(screen.queryByText(/우체국은 보내는 분 휴대전화를 꼭 받아요/)).toBeNull()
  })

  it('보내는 분 주소 칸을 찾지 못하면 우체국 화면의 [수정]에서 넣으라고 알린다 (회원 정보에 주소가 없던 계정 — D-EP1-20)', async () => {
    const { w } = world()
    render(w.wrap(<EpostScreen date={DATE} buyers={['u1']} nav={{ onBack: () => undefined }} />))
    await waitFor(() => expect(web.props.filter((props) => props.testID === 'epost-web').length).toBeGreaterThan(0))
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name'], readonly: [], missing: ['sender.phone'], ambiguous: [] }))
    await screen.findByText(/칸을 채웠어요/)
    expect(screen.queryByText(/보내는 분 주소를 넣지 못했어요/)).toBeNull()
    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name'], readonly: [], missing: ['sender.zip', 'sender.address'], ambiguous: [] }))
    expect(await screen.findByText(/보내는 분 주소를 넣지 못했어요\. 우체국 화면의 보내는 분 \[수정\]/)).toBeTruthy()
  })
})

describe('앱 안 우체국 화면 — 우체국 로그인 세션 지키기 (D-EP1-17)', () => {
  it('세션을 되살린 뒤에 우체국 화면을 열고, 우체국 쪽마다·나갈 때 세션을 둔다. 쿠키 값은 JS로 오지 않는다(개수만)', async () => {
    const calls: string[] = []
    let release: () => void = () => undefined
    setNativeModules({
      webSession: {
        restore: (domain, maxAge) => {
          calls.push(`restore ${domain} ${String(maxAge)}`)
          return new Promise<number>((resolve) => {
            release = () => resolve(3)
          })
        },
        save: async (domain) => {
          calls.push(`save ${domain}`)
          return 2
        },
        clear: async () => undefined,
      },
    })
    const { w } = world()
    const view = render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined }} />))
    await screen.findByText(/로그인하거나/)
    // 되살리기가 끝나기 전에는 우체국 화면을 열지 않는다
    expect(web.props.filter((props) => props.testID === 'epost-web')).toHaveLength(0)
    expect(calls).toEqual(['restore epost.go.kr 86400'])
    release()
    await waitFor(() => expect(web.props.filter((props) => props.testID === 'epost-web').length).toBeGreaterThan(0))
    lastWeb().onLoaded('https://juso.example.com/x')
    expect(calls).toEqual(['restore epost.go.kr 86400'])
    lastWeb().onLoaded('https://service.epost.go.kr/form')
    await waitFor(() => expect(calls).toEqual(['restore epost.go.kr 86400', 'save epost.go.kr']))
    view.unmount()
    await waitFor(() => expect(calls).toEqual(['restore epost.go.kr 86400', 'save epost.go.kr', 'save epost.go.kr']))
  })

  it('되살리기가 실패해도 우체국 화면은 연다', async () => {
    setNativeModules({ webSession: { restore: async () => Promise.reject(new Error('keychain')), save: async () => 0, clear: async () => undefined } })
    const { w } = world()
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined }} />))
    await screen.findByText(/로그인하거나/)
    await waitFor(() => expect(web.props.filter((props) => props.testID === 'epost-web').length).toBeGreaterThan(0))
  })
})

describe('앱 안 우체국 화면 — 비회원 신청 비밀번호 (D-EP1-14)', () => {
  it('설정한 비밀번호가 있으면 우체국 쪽마다 비밀번호 칸 스크립트를 넣고, 넣었다는 답에 다음 할 일을 안내한다', async () => {
    const { w } = world({ fill: { ...fillView(), password: '4821', form: { ...fillView().form, password: '#guest_orderpw, #guest_orderpw2' } } })
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined }} />))
    await screen.findByText(/로그인하거나/)
    expect(screen.queryByText(/우체국 신청 비밀번호를 적어 두면/)).toBeNull()
    lastWeb().onLoaded('https://service.epost.go.kr/agree')
    const scripts = web.injected.filter((script) => script.includes('4821'))
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).not.toContain('홍길동')
    lastWeb().onLoaded('https://juso.example.com/x')
    expect(web.injected.filter((script) => script.includes('4821'))).toHaveLength(1)
    lastWeb().onMessage(message({ type: 'password', filled: 2 }))
    expect(await screen.findByText('신청 비밀번호를 넣었어요.')).toBeTruthy() // D-EP1-19: 모바일 신청서는 받는 분 목록 단계에서 묻는다 — 약관 문장 없이
  })
})

describe('앱 안 우체국 화면', () => {
  it('우체국 쪽에서만 칸을 채우고, 채웠다는 답이 오면 입력 완료, 접수번호를 찾으면 판매자가 확인한 뒤 잇고 다음 주문으로', async () => {
    const { w, posts } = world()
    const next: string[] = []
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined, openNext: (buyer) => next.push(buyer) }} />))
    expect(await screen.findByText(/로그인하거나 비회원으로 약관에 동의해 주세요/)).toBeTruthy()
    expect(lastWeb().url).toBe('https://service.epost.go.kr/apply')
    // 비밀번호를 설정하지 않았으면 설정 안내 (D-EP1-14)
    expect(screen.getByText(/우체국 신청 비밀번호를 적어 두면/)).toBeTruthy()
    // D-EP1-15: 신청서가 아닌 쪽(약관 등)에서 칸을 하나도 못 찾으면 '못 채운 칸' 목록을 보이지 않는다
    lastWeb().onMessage(message({ type: 'fill', filled: [], readonly: [], missing: ['receiver.name', 'receiver.zip', 'item'], ambiguous: ['receiver.phone'] }))
    expect(screen.queryByText(/못 채운 칸/)).toBeNull()
    expect(screen.queryByText(/가릴 수 없어 비워 둔 칸/)).toBeNull()

    // 우체국이 아닌 쪽: 아무것도 넣지 않는다
    lastWeb().onLoaded('https://juso.example.com/popup')
    expect(web.injected).toHaveLength(0)
    // 우체국 쪽: 칸 채우기 + 접수번호 찾기
    lastWeb().onLoaded('https://service.epost.go.kr/form')
    expect(web.injected.filter((script) => script.includes('window.open='))).toHaveLength(1)
    expect(work()).toHaveLength(2)
    expect(work()[0]).toContain('홍길동')
    expect(work()[1]).not.toContain('홍길동')

    lastWeb().onMessage(message({ type: 'fill', filled: ['receiver.name', 'receiver.zip', 'receiver.address', 'receiver.detail', 'receiver.mobile'], readonly: ['receiver.zip', 'receiver.address'], missing: ['item'], ambiguous: [] }))
    expect(await screen.findByText('칸 5개 채움')).toBeTruthy()
    // D-EP1-12: 실제 우체국 [주소검증]이 주소 글만으로 정상 — 주소 찾기를 시키지 않는다
    expect(screen.getByText(/주소 찾기는 하지 않아도 돼요/)).toBeTruthy()
    expect(lastWeb().beforeLoad).toContain('window.open=')
    expect(screen.getByText('못 채운 칸: 내용품')).toBeTruthy()
    // D-EP1-13: 우체국 모바일 화면의 내용품은 고르기 화면 — 어디서 고르는지 알려 준다
    expect(screen.getByText(/\[내용품 종류 선택\]에서 골라 주세요/)).toBeTruthy()
    await waitFor(() => expect(posts.map((post) => post.body?.['action'])).toEqual(['FILLED']))
    // 다음 쪽에서는 다시 채우지 않는다 (판매자가 고친 값을 덮지 않게) — 접수번호 찾기만
    lastWeb().onLoaded('https://service.epost.go.kr/done')
    expect(work()).toHaveLength(3)
    expect(work()[2]).not.toContain('홍길동')

    lastWeb().onMessage(message({ type: 'receipt', lines: ['접수번호', '6012-3456-7890-1'] }))
    expect(await screen.findByText('접수번호를 찾았어요: 6012345678901')).toBeTruthy()
    expect(posts).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '접수번호 6012345678901 잇기' }))
    expect((screen.getByRole('textbox', { name: '접수번호' }) as HTMLInputElement).value).toBe('6012345678901')
    fireEvent.click(screen.getByRole('button', { name: '잇기' }))
    await waitFor(() => expect(posts.map((post) => post.body?.['action'])).toEqual(['FILLED', 'RECEIVED']))
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1', receiptNo: '6012345678901' })
    expect(await screen.findByText(/우체국 사전접수 완료로 적었어요/)).toBeTruthy()
    // 다음 주문: 고를 수 있고 우체국 기록이 없는 다른 주문 (초록손은 입력 완료라 건너뛴다 — 여기선 없음)
    expect(screen.queryByRole('button', { name: /다음 주문/ })).toBeNull()
  })

  it('다음 주문이 있으면 [다음: 이름]으로 이어 간다', async () => {
    const { w } = world({ day: day({ ready: [row('u1', '다육맘'), row('u3', '선인장')] }) })
    const next: string[] = []
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined, openNext: (buyer) => next.push(buyer) }} />))
    await screen.findByText(/로그인하거나/)
    fireEvent.click(screen.getByRole('button', { name: '접수번호 잇기' }))
    fireEvent.change(screen.getByRole('textbox', { name: '접수번호' }), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: '잇기' }))
    fireEvent.click(await screen.findByRole('button', { name: '다음 주문 선인장 우체국 사전접수' }))
    expect(next).toEqual(['u3'])
  })

  it('전에 입력만 한 주문이면 먼저 묻고, [신청 내역 보기]면 내역 쪽을 열고 채우지 않는다', async () => {
    const { w, posts } = world({ fill: fillView({ epost: { state: 'FILLED', word: '우체국 입력 완료', receiptNo: null, at: '2026-10-29T01:00:00.000Z' } }) })
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined }} />))
    expect(await screen.findByText('전에 이 주문을 우체국 화면에 입력했어요')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '신청 내역 보기' }))
    expect(web.loaded).toEqual(['https://www.epost.go.kr/history'])
    lastWeb().onLoaded('https://www.epost.go.kr/history')
    expect(web.injected.some((script) => script.includes('홍길동'))).toBe(false)
    expect(posts).toHaveLength(0)
    // 판매자가 직접 [칸 다시 채우기]를 누르면 채운다
    fireEvent.click(screen.getByRole('button', { name: '칸 다시 채우기' }))
    expect(web.injected.some((script) => script.includes('홍길동'))).toBe(true)
  })

  it('이미 사전접수한 주문(409)은 서버 문장과 [목록으로]만', async () => {
    const w = makeWorld()
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost\?buyer=u1$/, () => ({ status: 409, body: { error: { code: 'PARCEL_STATE', message: '이미 우체국에 사전접수했어요. 다시 하려면 우체국에서 신청을 취소한 뒤 접수 기록을 지워 주세요.' } } }))
    render(w.wrap(<EpostScreen date={DATE} buyers={["u1"]} nav={{ onBack: () => undefined }} />))
    expect(await screen.findByText(/이미 우체국에 사전접수했어요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '목록으로' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '지금 다시 불러오기' })).toBeNull()
  })
})

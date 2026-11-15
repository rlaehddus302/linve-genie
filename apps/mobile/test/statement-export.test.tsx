import Svg from 'react-native-svg'
import { nativeShareFile, setNativeModules } from '../src/native/index.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { it, expect, vi, onTestFinished } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { statementGeometry, statementPages, STATEMENT_A4_HEIGHT, STATEMENT_WIDTH } from '../src/screens/console/StatementPhoto.tsx'
import { StatementList } from '../src/screens/console/StatementList.tsx'
import { SEND_SHEET_TITLE } from '../src/screens/console/BroadcastSales.tsx'
import { SEND_PILL_TEXT } from '../src/screens/console/StatementPills.tsx'
import type { StatementRow } from '../src/lib/broadcast-sales.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, product, fullView, BROADCAST } from './support.ts'

function sharing() {
  const previous = nativeShareFile()
  const shareFile = vi.fn(async () => undefined)
  setNativeModules({ shareFile })
  // 찍힌 그림(this)을 적어 둔다 — 미리 보기에 보이는 바로 그 그림인지 본다
  const shot: unknown[] = []
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(function (this: unknown, cb: (data: string) => void) { shot.push(this); cb('iVBORw0KGgo=') })
  onTestFinished(() => { setNativeModules({ shareFile: previous }); snapshot.mockRestore() })
  return { shareFile, snapshot, shot }
}

/** [보내기] → "정산서 보내기" → 사진으로 저장하기 */
async function photoMenu() {
  fireEvent.click(screen.getByRole('button', { name: SEND_PILL_TEXT }))
  const menu = await screen.findByRole('dialog', { name: SEND_SHEET_TITLE })
  fireEvent.click(within(menu).getByRole('button', { name: '사진으로 저장하기' }))
}
const papersOf = (root: ParentNode = document) => root.querySelectorAll(`svg[viewBox^="0 0 ${STATEMENT_WIDTH} "]`)

// 옛 기대(D-RETRO-62, 판매자 요청 2026-11-12 "화면에 보이는 정산서를 그대로 사진으로"): 화면의 표가 곧 사진 그림 — 한 장이면 미리 보기 없이 그 그림을 바로 내보낸다.
// 새 기대(D-UX4-171, 사용자 지시 2026-11-16 "직사각형 표로 정산서를 그리는데, 그렇게 하지 말고 우리의 부드럽고 우아한 ui를 사용해서 … 정산 내역서 구매자별, 내 가게 이름, 날짜 이건 지우고"):
// 화면은 카드 줄(머리·가게 이름·날짜 없음), 사진은 지금 A4 그림 그대로 — 저장 전에 그 그림을 미리 보여 주고 [사진 저장]으로 내보낸다
it('양쪽 탭에서 화면은 카드 줄이고, 사진은 A4 그림을 미리 보여 준 뒤 그대로 내보낸다', async () => {
  const world = makeWorld()
  const { shareFile, snapshot, shot } = sharing()
  const samples = [['가을여행-t3u','5개',30000],['가을여행-t3u','분홍에케베리아',10000],['나오미다육','왕색금',250000],['미자네','창금',60000],['행복한미소','방울복랑',30000]] as const
  const products = samples.map(([,name,price],i)=>product(201+i,{name,price}))
  const claims = samples.map(([name,,amount],i)=>claim(String(i),201+i,name,{amount}))
  const buyers = [...new Set(samples.map(([name])=>name))].map(name=>buyer(name,name))
  world.server.on('GET', /^\/api\/broadcasts$/,()=>({body:{broadcasts:[{...BROADCAST,date:'2026-11-12'}]}}))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/,()=>({body:fullView({date:'2026-11-12',products,claims,buyers})}))
  world.server.on('GET', /order-shop$/,()=>({body:{name:'용용다육'}}))
  for(const tab of ['구매자별','상품별'] as const){
    const mounted=render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={()=>{}}/>))
    await screen.findByRole('button',{name:/^나오미다육 정산서/})
    fireEvent.click(screen.getByRole('button',{name:tab}))
    // 화면에는 svg 표가 없고, 머리·가게 이름·날짜 줄도 없다
    expect(papersOf()).toHaveLength(0)
    const list = screen.getByRole('list',{name:`${tab} 정산`})
    for (const gone of ['정산 내역서', '용용다육', '2026-11-12', '-t3u']) expect(document.body.textContent).not.toContain(gone)
    expect(within(list).getByText(tab==='구매자별'?'나오미다육':'분홍에케베리아')).toBeTruthy()
    // 총계: 금액 · 구매자 수 · 개수
    expect(screen.getByTestId('statement-total').textContent).toContain('380,000원')
    expect(screen.getByTestId('statement-total').textContent).toContain('구매자 4명')
    snapshot.mockClear()
    shot.length = 0
    await photoMenu()
    // 저장될 A4 그림(머리·가게 이름·날짜가 있는 지금 그림)을 먼저 보여 준다
    const sheet = await screen.findByRole('dialog', { name: `${tab} 정산 사진` })
    const paper = papersOf(sheet)
    expect(paper).toHaveLength(1)
    for (const word of [`정산 내역서 · ${tab}`, '380,000원', '2026-11-12', '용용다육']) expect(paper[0]!.textContent).toContain(word)
    expect(paper[0]!.textContent).not.toContain('-t3u')
    // 한 장이면 장 고르기 없이 [사진 저장]
    expect(within(sheet).queryByRole('button', { name: '다음 장' })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: '사진 저장' }))
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith(new Uint8Array([137,80,78,71,13,10,26,10]), `정산내역서-2026-11-12-${tab}.png`, 'image/png'))
    // 찍은 그림은 미리 보기의 그 그림 하나
    expect(snapshot).toHaveBeenCalledTimes(1)
    mounted.unmount()
  }
}, 20_000)

const manyRows = (count: number): StatementRow[] => Array.from({ length: count }, (_, i) => ({ key: `k${i}`, no: null, label: `손님${i + 1}`, money: 10000, qty: 1 }))

// 옛 기대: 장 높이 1,600 이하(긴 띠). 새 기대(D-UX4-145, 사용자 2026-11-16 "앱 안에선 그냥 하나로 … 내보내기 할 때는 적당히 A4 사이즈로"): 사진 장은 A4 비율(210:297) 안.
// (옛 "화면용은 한 장"(statementScreenPages)은 D-UX4-171로 화면이 svg 대신 카드 줄이 되어 뺐다 — 화면 쪽은 아래 시험이 본다)
it('사진은 A4 비율 장으로 나누고 총계는 마지막 장에만, 줄이 없어도 한 장을 그린다', () => {
  const pages = statementPages(manyRows(80), 'buyers')
  expect(pages.length).toBeGreaterThan(1)
  expect(pages.flat().map(row => row.row.key)).toEqual(manyRows(80).map(row => row.key))
  expect(STATEMENT_A4_HEIGHT).toBe(Math.round(STATEMENT_WIDTH * 297 / 210))
  pages.forEach((page, i) => {
    expect(statementGeometry(page, '용용다육', i === pages.length - 1, false).height).toBeLessThanOrEqual(STATEMENT_A4_HEIGHT)
  })
  const first = statementGeometry(pages[0]!, '용용다육', false, false)
  const last = statementGeometry(pages[pages.length - 1]!, '용용다육', true, false)
  expect(last.height - last.rowsEnd).toBeGreaterThan(first.height - first.rowsEnd)
  expect(statementPages([], 'products')).toEqual([[]])
})

// 옛 기대(D-UX4-145): 화면은 머리·총계가 한 번씩인 svg 한 장, 사진만 A4 장으로 나눠 고른다.
// 새 기대(D-UX4-171): 화면은 카드 줄(모든 손님 + 총계 한 번), 사진만 A4 장으로 나눠 고른다
it('줄이 많아도 화면은 한 목록으로 잇고, 사진만 A4 장으로 나눠 고른 장을 저장한다', async () => {
  const world = makeWorld()
  const { shareFile } = sharing()
  const names = Array.from({ length: 45 }, (_, i) => `손님${String(i + 1).padStart(2, '0')}`)
  const products = names.map((_, i) => product(101 + i, { name: `다육${i}`, price: 10000 }))
  const claims = names.map((name, i) => claim(String(i), 101 + i, name, { amount: 10000 }))
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12' }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', products, claims, buyers: names.map(name => buyer(name, name)) }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  const list = await screen.findByRole('list', { name: '구매자별 정산' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(45)
  for (const name of ['손님01', '손님45']) expect(within(list).getByText(name)).toBeTruthy()
  expect(screen.getAllByText('총계')).toHaveLength(1)
  expect(screen.getByTestId('statement-total').textContent).toContain('450,000원')
  expect(screen.getByTestId('statement-total').textContent).toContain('구매자 45명 · 45개')
  expect(papersOf()).toHaveLength(0)
  await photoMenu()
  const sheet = await screen.findByRole('dialog', { name: '구매자별 정산 사진' })
  // 고르는 판의 첫 장: 앞 손님만, 총계 없음, A4 비율
  const preview = sheet.querySelector('svg')!
  expect(preview.textContent).toContain('손님01')
  expect(preview.textContent).not.toContain('손님45')
  expect(preview.textContent).not.toContain('총계')
  expect(Number(preview.getAttribute('viewBox')!.split(' ')[3])).toBeLessThanOrEqual(STATEMENT_A4_HEIGHT)
  fireEvent.click(within(sheet).getByRole('button', { name: '다음 장' }))
  expect(sheet.querySelector('svg')!.textContent).not.toContain('손님01')
  fireEvent.click(within(sheet).getByRole('button', { name: '이 장 사진 저장' }))
  await waitFor(() => expect(shareFile).toHaveBeenCalledWith(expect.any(Uint8Array), '정산내역서-2026-11-12-구매자별-2.png', 'image/png'))
}, 20_000)

// 옛 기대: svg 표 위 투명한 누름 자리(StatementPages). 새 기대(D-UX4-171): 카드 줄(StatementList) — 누르는 일은 같다
it('구매자별 줄을 누르면 그 손님을 고르고, 상품별 줄은 누르는 자리가 없다 — 금액을 모르면 "금액 확인 필요"', () => {
  const world = makeWorld()
  const rows: StatementRow[] = [{ key: 'a', no: null, label: '가을여행', money: 40000, qty: 2 }, { key: 'b', no: null, label: '<나오미>다육', money: null, qty: 1 }]
  const picked: string[] = []
  const mounted = render(world.wrap(<StatementList tab="buyers" rows={rows} total={null} qty={3} buyers={2} sent={['a']} onRow={key => picked.push(key)} rowLabel={row => `${row.label} 정산서`} />))
  expect(screen.getAllByText('금액 확인 필요')).toHaveLength(2)
  // 닉네임은 글자 그대로 (꺾쇠도 글자)
  expect(screen.getByText('<나오미>다육')).toBeTruthy()
  // 보낸 손님 표시
  expect(within(screen.getByRole('button', { name: '가을여행 정산서' })).getByText('보냄')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '<나오미>다육 정산서' }))
  expect(picked).toEqual(['b'])
  expect(screen.getByTestId('statement-total').textContent).toContain('구매자 2명 · 3개')
  mounted.unmount()
  render(world.wrap(<StatementList tab="products" rows={[{ key: 'p', no: 12, label: '색금', money: 30000, qty: 1 }]} total={30000} qty={1} buyers={1} sent={[]} rowLabel={row => row.label} />))
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(screen.getByText('12번')).toBeTruthy()
  expect(screen.getAllByText('30,000원')).toHaveLength(2)
})

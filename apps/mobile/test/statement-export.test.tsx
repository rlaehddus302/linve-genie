import Svg from 'react-native-svg'
import { nativeShareFile, setNativeModules } from '../src/native/index.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { it, expect, vi, onTestFinished } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { statementGeometry, statementPages, statementScreenPages, StatementPages, STATEMENT_A4_HEIGHT, STATEMENT_WIDTH } from '../src/screens/console/StatementPhoto.tsx'
import type { StatementRow } from '../src/lib/broadcast-sales.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, claim, product, fullView, BROADCAST } from './support.ts'

function sharing() {
  const previous = nativeShareFile()
  const shareFile = vi.fn(async () => undefined)
  setNativeModules({ shareFile })
  // 찍힌 그림(this)을 적어 둔다 — 화면에 보이는 바로 그 그림인지 본다
  const shot: unknown[] = []
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(function (this: unknown, cb: (data: string) => void) { shot.push(this); cb('iVBORw0KGgo=') })
  onTestFinished(() => { setNativeModules({ shareFile: previous }); snapshot.mockRestore() })
  return { shareFile, snapshot, shot }
}

// 옛 기대: [사진으로 저장하기] → 따로 그린 미리 보기(폭 480 그림, ₩ 기호) 판 → [사진 저장].
// 새 기대(D-RETRO-62, 판매자 요청 2026-11-12 "화면에 보이는 정산서를 그대로 사진으로"): 화면의 표가 곧 사진 그림 — 한 장이면 미리 보기 없이 그 그림을 바로 내보낸다
it('양쪽 탭에서 화면에 보이는 표를 그대로 사진으로 내보낸다', async () => {
  const world = makeWorld()
  const { shareFile, snapshot } = sharing()
  const samples = [['가을여행-t3u','5개',30000],['가을여행-t3u','분홍에케베리아',10000],['나오미다육','왕색금',250000],['미자네','창금',60000],['행복한미소','방울복랑',30000]] as const
  const products = samples.map(([,name,price],i)=>product(201+i,{name,price}))
  const claims = samples.map(([name,,amount],i)=>claim(String(i),201+i,name,{amount}))
  const buyers = [...new Set(samples.map(([name])=>name))].map(name=>buyer(name,name))
  world.server.on('GET', /^\/api\/broadcasts$/,()=>({body:{broadcasts:[{...BROADCAST,date:'2026-11-12'}]}}))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/,()=>({body:fullView({date:'2026-11-12',products,claims,buyers})}))
  world.server.on('GET', /order-shop$/,()=>({body:{name:'용용다육'}}))
  for(const tab of ['구매자별','상품별'] as const){
    const mounted=render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={()=>{}}/>))
    await screen.findByText('용용다육')
    fireEvent.click(screen.getByRole('button',{name:tab}))
    // 화면의 표는 그림 하나 — 사진과 같은 그림이다
    const papers=document.querySelectorAll(`svg[viewBox^="0 0 ${STATEMENT_WIDTH} "]`)
    expect(papers).toHaveLength(1)
    const paper=papers[0]!
    expect(paper.textContent).toContain(`정산 내역서 · ${tab}`)
    expect(paper.textContent).toContain('380,000원')
    expect(paper.textContent).toContain('2026-11-12')
    expect(paper.textContent).not.toContain('-t3u')
    expect(paper.textContent).toContain(tab==='구매자별'?'나오미다육':'분홍에케베리아')
    fireEvent.click(screen.getByRole('button',{name:'내보내기'}))
    for(const name of ['사진으로 저장하기','CSV 파일로 저장하기','엑셀 파일로 저장하기']) expect(screen.getByRole('button',{name})).toBeTruthy()
    snapshot.mockClear()
    fireEvent.click(screen.getByRole('button',{name:'사진으로 저장하기'}))
    await waitFor(() => expect(shareFile).toHaveBeenCalledWith(new Uint8Array([137,80,78,71,13,10,26,10]), `정산내역서-2026-11-12-${tab}.png`, 'image/png'))
    // 따로 그린 미리 보기는 없다 — 그림은 여전히 화면의 그 하나, 찍기도 한 번
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll(`svg[viewBox^="0 0 ${STATEMENT_WIDTH} "]`)).toHaveLength(1)
    expect(screen.queryByRole('button',{name:'사진 저장'})).toBeNull()
    mounted.unmount()
  }
})

const manyRows = (count: number): StatementRow[] => Array.from({ length: count }, (_, i) => ({ key: `k${i}`, no: null, label: `손님${i + 1}`, money: 10000, qty: 1 }))

// 옛 기대: 장 높이 1,600 이하(긴 띠). 새 기대(D-UX4-145, 사용자 2026-11-16 "앱 안에선 그냥 하나로 … 내보내기 할 때는 적당히 A4 사이즈로"):
// 사진 장은 A4 비율(210:297) 안, 화면용은 줄이 아무리 많아도 한 장
it('사진은 A4 비율 장으로 나누고 총계는 마지막 장에만, 화면용은 한 장, 줄이 없어도 한 장을 그린다', () => {
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
  const screenPages = statementScreenPages(manyRows(300), 'buyers')
  expect(screenPages).toHaveLength(1)
  expect(screenPages[0]!.map(row => row.row.key)).toEqual(manyRows(300).map(row => row.key))
  expect(statementPages([], 'products')).toEqual([[]])
})

// 옛 기대: 화면에도 장(1/2, 2/2)이 나뉘어 이어 보이고, 고르는 판의 장 = 화면의 장.
// 새 기대(D-UX4-145, 사용자 2026-11-16): 화면은 머리·총계가 한 번씩인 한 장, 사진만 A4 장으로 나눠 고른다
it('줄이 많아도 화면은 한 장으로 잇고, 사진만 A4 장으로 나눠 고른 장을 저장한다', async () => {
  const world = makeWorld()
  const { shareFile } = sharing()
  const names = Array.from({ length: 45 }, (_, i) => `손님${String(i + 1).padStart(2, '0')}`)
  const products = names.map((_, i) => product(101 + i, { name: `다육${i}`, price: 10000 }))
  const claims = names.map((name, i) => claim(String(i), 101 + i, name, { amount: 10000 }))
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12' }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', products, claims, buyers: names.map(name => buyer(name, name)) }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  await screen.findAllByText('용용다육')
  const onScreen = [...document.querySelectorAll(`svg[viewBox^="0 0 ${STATEMENT_WIDTH} "]`)]
  expect(onScreen).toHaveLength(1)
  const paper = onScreen[0]!.textContent ?? ''
  for (const name of ['손님01', '손님45']) expect(paper).toContain(name)
  // 머리·총계는 한 번씩, 장 번호(1/2)는 없다
  expect(paper.split('정산 내역서 · 구매자별')).toHaveLength(2)
  expect(paper.split('총계')).toHaveLength(2)
  expect(paper).toContain('450,000원')
  expect(paper).not.toMatch(/\d+\/\d+/)
  fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
  fireEvent.click(screen.getByRole('button', { name: '사진으로 저장하기' }))
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

it('구매자별 표의 줄을 누르면 그 손님을 고르고, 상품별 표는 누르는 자리가 없다', () => {
  const world = makeWorld()
  const rows: StatementRow[] = [{ key: 'a', no: null, label: '가을여행', money: 40000, qty: 2 }, { key: 'b', no: null, label: '나오미다육', money: null, qty: 1 }]
  const sheet = { tab: 'buyers', shop: '용용다육', date: '2026-11-12', total: null, qty: 3 } as const
  const picked: string[] = []
  const mounted = render(world.wrap(<StatementPages pages={statementPages(rows, 'buyers')} sheet={sheet} width={320} refs={{ current: [] }} onRow={key => picked.push(key)} rowLabel={row => `${row.label} 정산서`} />))
  expect(document.querySelector('svg')!.textContent).toContain('금액 확인 필요')
  fireEvent.click(screen.getByRole('button', { name: '나오미다육 정산서' }))
  expect(picked).toEqual(['b'])
  mounted.unmount()
  render(world.wrap(<StatementPages pages={statementPages(rows, 'products')} sheet={{ ...sheet, tab: 'products' }} width={320} refs={{ current: [] }} />))
  expect(screen.queryAllByRole('button')).toHaveLength(0)
})

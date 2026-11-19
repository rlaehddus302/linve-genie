// 구매자마다 따로 저장 (D-STMT-EACH-01) · 정산서 손님 합치기 (D-STMT-JOIN-01), 판매자 요청 2026-11-20
import Svg from 'react-native-svg'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { nativeSaveFolder, nativeShareFile, setNativeModules } from '../src/native/index.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { SEND_SHEET_TITLE } from '../src/screens/console/BroadcastSales.tsx'
import { SEND_TEXT } from '../src/screens/console/StatementControls.tsx'
import { EACH_ROW, EACH_TITLE, eachDone, eachFileName, fileSafe } from '../src/screens/console/StatementEachSave.tsx'
import { APART_BUTTON, APART_QUESTION, JOIN_BUTTON, JOIN_TITLE } from '../src/lib/statement-joins.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, buyer, claim, fullView, product } from './support.ts'

const DATE = '2026-11-12'
const NAMES = ['구제불능', '구제불능2', '나래'] as const

function setup(groups: { buyers: string[]; auto: boolean }[] = []) {
  const world = makeWorld()
  const products = NAMES.map((_, i) => product(11 + i, { name: `다육${i}`, price: 20000 }))
  const claims = NAMES.map((name, i) => claim(String(i), 11 + i, name, { amount: 20000 }))
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: DATE }] } }))
  world.server.on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: fullView({ date: DATE, products, claims, buyers: NAMES.map(name => buyer(name, name)) }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  let current = groups
  world.server.on('GET', /statement-joins$/, () => ({ body: { groups: current } }))
  world.server.on('POST', /statement-joins$/, call => {
    const body = call.body as { kind: string; buyers: string[] }
    current = body.kind === 'join' ? [{ buyers: body.buyers, auto: false }] : []
    return { body: { groups: current } }
  })
  return world
}

function folder() {
  const written: { name: string; bytes: Uint8Array; mime: string }[] = []
  const previous = { saveFolder: nativeSaveFolder(), shareFile: nativeShareFile() }
  const shareFile = vi.fn(async () => undefined)
  setNativeModules({ saveFolder: async () => ({ write: (name, bytes, mime) => { written.push({ name, bytes, mime }) } }), shareFile })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { setNativeModules(previous); snapshot.mockRestore() })
  return { written, shareFile }
}

async function openEach() {
  fireEvent.click(await screen.findByRole('button', { name: SEND_TEXT }))
  const menu = await screen.findByRole('dialog', { name: SEND_SHEET_TITLE })
  fireEvent.click(within(menu).getByRole('button', { name: EACH_ROW }))
  return screen.findByRole('dialog', { name: EACH_TITLE })
}

it('파일 이름은 목록 순번 · 닉네임(쓸 수 없는 글자는 뺀다)', () => {
  expect(fileSafe('../가을/여행:*-t3u')).toBe('가을여행-t3u')
  expect(fileSafe('🌵')).toBe('구매자')
  expect(eachFileName(DATE, 2, 10, '나래', 'csv')).toBe(`정산서-${DATE}-03-나래.csv`)
  expect(eachFileName(DATE, 0, 3, '나래', 'photo', { index: 1, count: 2 })).toBe(`정산서-${DATE}-1-나래-2.png`)
})

it('엑셀·CSV: 고른 폴더에 구매자마다 서버 파일 하나씩, 목록 순서대로 저장한다', async () => {
  const world = setup()
  const { written } = folder()
  world.server.on('GET', /statement\/buyer\/csv\?buyer=/, call => ({ bytes: new TextEncoder().encode(call.path), contentType: 'text/csv' }))
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  await screen.findByRole('button', { name: /^나래 정산서/ })
  const sheet = await openEach()
  fireEvent.click(within(sheet).getByRole('button', { name: /CSV 파일로 저장하기/ }))
  await waitFor(() => expect(screen.getByTestId('statement-each-note').textContent).toBe(eachDone(3)), { timeout: 5000 })
  expect(written.map(file => file.name)).toEqual([`정산서-${DATE}-1-구제불능.csv`, `정산서-${DATE}-2-구제불능2.csv`, `정산서-${DATE}-3-나래.csv`])
  expect(written.every(file => file.mime === 'text/csv')).toBe(true)
  expect(new TextDecoder().decode(written[2]!.bytes)).toContain('buyer=%EB%82%98%EB%9E%98')
}, 15_000)

it('사진: 구매자마다 정산서 그림을 한 장씩 찍어 저장하고, 같은 번호로 합친 손님은 한 장이다', async () => {
  const world = setup([{ buyers: ['구제불능', '구제불능2'], auto: true }])
  const { written } = folder()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  // 합친 정산서는 구매자별 한 줄 · 구매자 수도 하나 준다
  await screen.findByRole('button', { name: /^구제불능 · 구제불능2 정산서/ })
  expect(screen.getByTestId('statement-total').textContent).toContain('구매자 2명')
  const sheet = await openEach()
  fireEvent.click(within(sheet).getByRole('button', { name: /사진으로 저장하기/ }))
  await waitFor(() => expect(screen.getByTestId('statement-each-note').textContent).toBe(eachDone(2)), { timeout: 5000 })
  expect(written.map(file => file.name)).toEqual([`정산서-${DATE}-1-구제불능 구제불능2.png`, `정산서-${DATE}-2-나래.png`])
  expect(written.every(file => file.mime === 'image/png')).toBe(true)
}, 15_000)

it('손님 정산서에서 다른 닉네임을 골라 합치고, 합친 정산서는 한 번 물은 뒤 나눈다', async () => {
  const world = setup()
  folder()
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
  fireEvent.click(await screen.findByRole('button', { name: /^구제불능 정산서/ }))
  fireEvent.click(await screen.findByRole('button', { name: JOIN_BUTTON }))
  const pick = await screen.findByRole('dialog', { name: JOIN_TITLE })
  fireEvent.click(within(pick).getByRole('checkbox', { name: /^구제불능2/ }))
  fireEvent.click(within(pick).getByRole('button', { name: '합치기 (1)' }))
  await waitFor(() => expect(world.server.callsTo('POST', /statement-joins$/)).toHaveLength(1))
  expect(world.server.callsTo('POST', /statement-joins$/)[0]!.body).toMatchObject({ kind: 'join', buyers: ['구제불능', '구제불능2'] })
  await screen.findByText('닉네임 2개를 한 정산서로 합쳤어요.')
  fireEvent.click(screen.getByRole('button', { name: APART_BUTTON }))
  const ask = await screen.findByRole('dialog', { name: APART_QUESTION })
  fireEvent.click(within(ask).getByRole('button', { name: APART_BUTTON }))
  await waitFor(() => expect(world.server.callsTo('POST', /statement-joins$/)).toHaveLength(2))
  expect(world.server.callsTo('POST', /statement-joins$/)[1]!.body).toMatchObject({ kind: 'apart', buyers: ['구제불능', '구제불능2'] })
})

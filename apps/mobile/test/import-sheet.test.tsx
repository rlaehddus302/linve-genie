// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 상품 목록 가져오기 시트 (PRD-05 앱, D-V3-128): 붙여 넣은 글 → 미리 보기(서버 해석) → 문제 없는 줄만 "n개 등록하기" → 공개 전 상품.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleToolScreen } from '../src/screens/console/StackScreens.tsx'
import { APP_IMPORT_TITLE, importDoneMessage } from '../src/screens/console/ImportSheet.tsx'
import { makeWorld } from './screen-support.tsx'
import { changes, flush, product } from './support.ts'

// D-UX4-130 (사용자 지시 "상품 미리 등록 기능 제거해"): 라이브 관리의 "상품 미리 등록" 줄을 없애 그 줄로 열 수 없다.
// 화면(ImportView)은 설정 경로(/console/<id>/tool/import)에 남아 있어 그 화면으로 연다 (옛: 라이브 관리 → 상품 미리 등록).
async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleToolScreen broadcastId="b1" tool="import" onBack={() => {}} />))
  await waitFor(() => expect(world.source()).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  expect(await screen.findByRole('main', { name: APP_IMPORT_TITLE })).toBeTruthy()
}

describe('상품 목록 가져오기 (앱)', () => {
  it('미리 보기는 줄마다 등록할 값·문제 문장을 보이고, 등록은 문제 없는 줄만 같은 요청 번호로 보내며, 끝나면 공개 전 상품으로 등록했다고 알린다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    const previews: unknown[] = []
    const registers: unknown[] = []
    world.server.on('POST', /^\/api\/broadcasts\/b1\/import\/preview$/, (call) => {
      previews.push(call.body)
      return { body: { broadcast: 'b1', unit: '원', maxNumber: 999, error: null, header: null, headerCells: null, register: 1, problems: 1, rows: [
        { line: 1, no: 16, name: '아사달금', price: 50_000, text: '16 아사달금 50000' },
        { line: 2, error: 'EXISTS', text: '15 핑크프릴 12000' },
      ] } }
    })
    world.server.on('POST', /^\/api\/broadcasts\/b1\/import$/, (call) => {
      registers.push(call.body)
      world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { products: [product(16, { name: '아사달금', price: 50_000, status: 'READY' })] }) }))
      return { body: { registered: 1, seq: 6 } }
    })
    await open(world)
    const input = await screen.findByRole('textbox', { name: '상품 목록' })
    expect(screen.getByRole('button', { name: '0개 등록하기' })).toBeTruthy()
    fireEvent.change(input, { target: { value: '16 아사달금 50000\n15 핑크프릴 12000' } })
    fireEvent.click(screen.getByRole('button', { name: '미리 보기' }))
    await waitFor(() => expect(previews).toEqual([{ text: '16 아사달금 50000\n15 핑크프릴 12000' }]))
    const list = await screen.findByRole('list', { name: '가져올 줄' })
    expect(within(list).getByText('16번 아사달금 50,000원')).toBeTruthy()
    expect(within(list).getByText(/이 라이브에 이미 있는 번호예요/)).toBeTruthy()
    expect(screen.getByText('등록할 상품 1개 · 빼는 줄 1개')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1개 등록하기' }))
    await waitFor(() => expect(registers).toHaveLength(1))
    expect(registers[0]).toMatchObject({ rows: [{ no: 16, name: '아사달금', price: 50_000 }] })
    expect(typeof (registers[0] as { requestId: string }).requestId).toBe('string')
    expect(await screen.findByText(importDoneMessage(1))).toBeTruthy()
    expect(screen.queryByRole('list', { name: '가져올 줄' })).toBeNull()
  })
})

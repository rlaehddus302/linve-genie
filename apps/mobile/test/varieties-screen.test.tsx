// 내 품종 화면 (D-V3-127): 목록을 보이고, 적어서 더하면 통째로 저장하고, 지우기·판 적 있는 품종 더하기가 된다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VARIETIES_EMPTY, VARIETIES_SUGGEST_TITLE, VarietiesScreen, splitVarietyInput } from '../src/screens/VarietiesScreen.tsx'
import { makeWorld } from './screen-support.tsx'

function setup(initial: { names: string[]; suggested: string[] }) {
  const world = makeWorld()
  let names = initial.names
  const puts: unknown[] = []
  world.server.on('GET', /^\/api\/voice\/varieties$/, () => ({ body: { names, suggested: initial.suggested } }))
  world.server.on('PUT', /^\/api\/voice\/varieties$/, (call) => {
    puts.push(call.body)
    names = (call.body?.names as string[]).map((item) => item.trim())
    return { body: { names } }
  })
  render(world.wrap(<VarietiesScreen onBack={() => {}} />))
  return { world, puts, names: () => names }
}

describe('VarietiesScreen', () => {
  it('입력 글은 쉼표·줄바꿈·가운뎃점으로 나뉜다', () => {
    expect(splitVarietyInput('아사달금, 킹나이트금\n 순수 ·황도,,')).toEqual(['아사달금', '킹나이트금', '순수', '황도'])
  })
  it('비었으면 안내가 보이고, 적어서 더하면 목록 통째로 저장되며, 같은 이름은 다시 넣지 않는다', async () => {
    const { puts } = setup({ names: [], suggested: [] })
    expect(await screen.findByText(VARIETIES_EMPTY)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '품종 이름' }), { target: { value: '아사달금, 킹나이트금' } })
    fireEvent.click(screen.getByRole('button', { name: '더하기' }))
    await waitFor(() => expect(puts).toEqual([{ names: ['아사달금', '킹나이트금'] }]))
    const list = await screen.findByRole('list', { name: '내 품종 목록' })
    expect(within(list).getByText('아사달금')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '품종 이름' }), { target: { value: '아사달 금' } })
    fireEvent.click(screen.getByRole('button', { name: '더하기' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: '품종 이름' }) as HTMLInputElement).value).toBe(''))
    expect(puts).toHaveLength(1)
  })
  it('지우기는 그 이름을 뺀 목록을 저장하고, 판 적 있는 품종을 누르면 더한다', async () => {
    const { puts } = setup({ names: ['아사달금', '순수'], suggested: ['황도', '순수'] })
    const list = await screen.findByRole('list', { name: '내 품종 목록' })
    fireEvent.click(within(list).getByRole('button', { name: '순수 지우기' }))
    await waitFor(() => expect(puts).toEqual([{ names: ['아사달금'] }]))
    await waitFor(() => expect(within(list).queryByText('순수')).toBeNull())
    const suggest = screen.getByRole('group', { name: VARIETIES_SUGGEST_TITLE })
    fireEvent.click(within(suggest).getByRole('button', { name: '황도 더하기' }))
    await waitFor(() => expect(puts).toEqual([{ names: ['아사달금'] }, { names: ['아사달금', '황도'] }]))
    await waitFor(() => expect(within(suggest).queryByRole('button', { name: '황도 더하기' })).toBeNull())
  })
})

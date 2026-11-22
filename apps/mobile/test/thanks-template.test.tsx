// 찜 감사 채팅 양식 (D-THANKS-FMT-01, 사용자 지시 2026-11-23): 예시 양식 한 줄에 하나 + 맨 아래 [직접 만들기] → 블록 편집
// (번호·품명·가격·닉네임 블록, 꾹 눌러 옮기기, 사이사이 [+]로 글자 블록). 맨 아래 [취소](왼쪽) · [저장](오른쪽) 한 줄.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THANKS_TEMPLATE, type ThanksTemplate } from '@livejjim/core'
import { clearCached } from '../src/lib/cached-get.ts'
import { THANKS_CUSTOM_TITLE, THANKS_SAMPLES, THANKS_TEMPLATE_TITLE, moveBlock, thanksPreview, thanksTemplateLabel } from '../src/lib/thanks-template.ts'
import { ThanksTemplateEditor, ThanksTemplateScreen, insertChoices } from '../src/screens/ThanksTemplateScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const PATH = /^\/api\/settings\/thanks-template$/

afterEach(() => clearCached())

function world(initial: ThanksTemplate = DEFAULT_THANKS_TEMPLATE) {
  const made = makeWorld()
  let saved: ThanksTemplate = initial
  made.server.on('GET', PATH, () => ({ body: { blocks: saved } }))
  made.server.on('PUT', PATH, (call) => {
    saved = (call.body as { blocks: ThanksTemplate }).blocks
    return { body: { blocks: saved } }
  })
  return made
}

describe('양식 고르기 화면', () => {
  it('예시 양식이 한 줄에 하나(이름 · 예시 글), 맨 아래 [직접 만들기]. 지금 양식에 표시', async () => {
    const w = world()
    render(w.wrap(<ThanksTemplateScreen onBack={() => {}} openCustom={() => {}} />))
    const list = await screen.findByRole('radiogroup', { name: THANKS_TEMPLATE_TITLE })
    const rows = within(list).getAllByRole('radio')
    expect(rows).toHaveLength(THANKS_SAMPLES.length + 1)
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([...THANKS_SAMPLES.map((sample) => sample.name), THANKS_CUSTOM_TITLE])
    expect(rows[0]?.textContent).toContain('15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true')
  })

  it('예시를 누르면 바로 저장하고 표시가 옮겨 간다. [직접 만들기]는 블록 화면을 연다', async () => {
    const w = world()
    const openCustom = vi.fn()
    render(w.wrap(<ThanksTemplateScreen onBack={() => {}} openCustom={openCustom} />))
    const list = await screen.findByRole('radiogroup', { name: THANKS_TEMPLATE_TITLE })
    const second = THANKS_SAMPLES[1]!
    await act(async () => { fireEvent.click(within(list).getByRole('radio', { name: second.name })); await flush() })
    expect(w.server.callsTo('PUT', PATH).map((call) => call.body)).toEqual([{ blocks: second.blocks }])
    await waitFor(() => expect(within(list).getByRole('radio', { name: second.name }).getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(within(list).getByRole('radio', { name: THANKS_CUSTOM_TITLE }))
    expect(openCustom).toHaveBeenCalledTimes(1)
  })

  it('예시와 다른 양식이면 [직접 만들기]에 표시하고 그 미리 보기를 보인다', async () => {
    const mine: ThanksTemplate = [{ k: 'buyer' }, { k: 'no' }, { k: 'text', t: '고마워요' }]
    const w = world(mine)
    render(w.wrap(<ThanksTemplateScreen onBack={() => {}} openCustom={() => {}} />))
    const custom = await screen.findByRole('radio', { name: THANKS_CUSTOM_TITLE })
    await waitFor(() => expect(custom.getAttribute('aria-checked')).toBe('true'))
    expect(custom.textContent).toContain('홍길동님 15번 고마워요')
    expect(thanksTemplateLabel(mine)).toBe(THANKS_CUSTOM_TITLE)
    expect(thanksTemplateLabel(DEFAULT_THANKS_TEMPLATE)).toBe('기본')
  })
})

describe('직접 만들기 (블록)', () => {
  it('지금 양식의 블록을 세로로 쌓고 위에 미리 보기. 번호·닉네임은 뺄 수 없고 품명·가격·글자는 뺄 수 있다', async () => {
    const w = world()
    render(w.wrap(<ThanksTemplateEditor onBack={() => {}} onSaved={() => {}} />))
    const list = await screen.findByRole('list', { name: '감사 채팅 블록' })
    expect(within(list).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual(['번호 블록', '품명 블록', '가격 블록', '닉네임 블록', '글자 블록 구매 감사합니다'])
    expect(screen.getByTestId('thanks-template-preview').textContent).toContain('15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')
    expect(within(list).queryByRole('button', { name: '번호 블록 빼기' })).toBeNull()
    expect(within(list).queryByRole('button', { name: '닉네임 블록 빼기' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: '가격 블록 빼기' }))
    expect(screen.getByTestId('thanks-template-preview').textContent).toContain('15번 핑크프릴 홍길동님 구매 감사합니다')
  })

  it('[+]로 그 자리에 글자 블록을 넣고 적으면 미리 보기에 바로. 저장하면 블록 그대로 보내고 돌아간다', async () => {
    const w = world()
    const onSaved = vi.fn()
    render(w.wrap(<ThanksTemplateEditor onBack={() => {}} onSaved={onSaved} />))
    await screen.findByRole('list', { name: '감사 채팅 블록' })
    fireEvent.click(screen.getByTestId('thanks-add-0'))
    const sheet = await screen.findByRole('dialog', { name: '블록 넣기' })
    fireEvent.click(within(sheet).getByRole('radio', { name: '글자' }))
    fireEvent.change(await screen.findByTestId('thanks-text-0'), { target: { value: '축하해요!' } })
    expect(screen.getByTestId('thanks-template-preview').textContent).toContain('축하해요! 15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')
    await act(async () => { fireEvent.click(screen.getByTestId('thanks-template-save')); await flush() })
    expect(w.server.callsTo('PUT', PATH).map((call) => call.body)).toEqual([{ blocks: [{ k: 'text', t: '축하해요!' }, ...DEFAULT_THANKS_TEMPLATE] }])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('빈 글자 블록은 저장할 때 뺀다. [취소] 왼쪽 · [저장] 오른쪽 한 줄 (절대 규칙 8)', async () => {
    const w = world()
    render(w.wrap(<ThanksTemplateEditor onBack={() => {}} onSaved={() => {}} />))
    await screen.findByRole('list', { name: '감사 채팅 블록' })
    fireEvent.click(screen.getByTestId('thanks-add-2'))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '블록 넣기' })).getByRole('radio', { name: '글자' }))
    const cancel = screen.getByRole('button', { name: '취소' })
    const save = screen.getByTestId('thanks-template-save')
    const row = cancel.parentElement!.parentElement!
    expect(row).toBe(save.parentElement!.parentElement!)
    expect(getComputedStyle(row).flexDirection).toBe('row')
    expect(Array.from(row.children).findIndex((child) => child.contains(cancel))).toBeLessThan(Array.from(row.children).findIndex((child) => child.contains(save)))
    await act(async () => { fireEvent.click(save); await flush() })
    expect(w.server.callsTo('PUT', PATH).map((call) => call.body)).toEqual([{ blocks: DEFAULT_THANKS_TEMPLATE }])
  })

  it('[+] 판: 글자와 빠진 값 블록만 — 품명을 빼면 품명을 다시 넣을 수 있다', () => {
    expect(insertChoices(DEFAULT_THANKS_TEMPLATE).map((choice) => choice.label)).toEqual(['글자'])
    expect(insertChoices([{ k: 'no' }, { k: 'buyer' }]).map((choice) => choice.label)).toEqual(['글자', '품명', '가격'])
  })

  it('꾹 눌러 옮기기: 블록 하나를 다른 자리로 (화면 읽기 도구는 위로·아래로 옮기기)', () => {
    expect(moveBlock(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveBlock(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveBlock(['a', 'b'], 1, 9)).toEqual(['a', 'b'])
    expect(moveBlock(['a', 'b'], 0, 9)).toEqual(['b', 'a'])
    expect(thanksPreview([{ k: 'buyer' }, { k: 'no' }])).toBe('홍길동님 15번')
  })
})

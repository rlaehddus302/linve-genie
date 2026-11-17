// 손글씨로 글자 넣기 (D-HANDWRITE-02 — 숫자 말고 품종 같은 글자 칸만): 판 상태(읽어 붙이기·후보로 고치기·띄우기·한 글자 지우기),
// 품종 이름으로 고치기, 글자 칸의 [손글씨] 단추·판 모양, 손글씨 읽기가 없는 앱에서는 단추를 숨기기.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InkNative } from '@livejjim/mobile-ink'
import { EMPTY_PAD, flattenInk, insertText, padReducer, rankReadings, SETTLE_MS, type InkStroke, type PadState } from '../src/lib/handwriting.ts'
import { prepareInk, readInk, wireInkReader } from '../src/lib/ink-reader.ts'
import { HANDWRITING_WORDS, HandwritingSheet, padHeightFor, UnderlineField } from '../src/ui/kit/index.ts'

afterEach(() => {
  wireInkReader(null)
  vi.useRealTimers()
})

const line = (from: number, to: number): InkStroke => [
  { x: from, y: 50, t: 0 },
  { x: to, y: 60, t: 16 },
]
const A = line(10, 60)
const B = line(80, 140)

/** 가짜 손글씨 읽기: 보낸 획 수마다 정해 둔 후보를 돌려준다 */
function fakeInk(answers: readonly (readonly string[])[], prepared = true): InkNative & { readonly calls: { strokes: readonly (readonly number[])[]; hints: readonly string[] }[] } {
  const calls: { strokes: readonly (readonly number[])[]; hints: readonly string[] }[] = []
  return {
    calls,
    prepare: () => Promise.resolve(prepared),
    recognize: (strokes, _width, _height, _language, hints) => {
      calls.push({ strokes, hints })
      return Promise.resolve([...(answers[calls.length - 1] ?? [])])
    },
  }
}

describe('판 상태', () => {
  const read = (state: PadState, candidates: readonly string[], hints: readonly string[] = []) => padReducer(state, { type: 'read', strokes: state.ink, candidates, hints })

  it('읽으면 가장 그럴듯한 글을 붙이고 판을 비운다 — 이어 쓰면 뒤에 붙고, 다른 후보는 "혹시"로', () => {
    let state = padReducer(EMPTY_PAD, { type: 'stroke', stroke: A })
    state = read(state, ['핑크', '평크'])
    expect(state).toMatchObject({ text: '핑크', ink: [], choices: ['평크'] })
    state = read(padReducer(state, { type: 'stroke', stroke: B }), ['프릴', '프린'])
    expect(state).toMatchObject({ text: '핑크프릴', choices: ['핑크프린'] })
  })

  it('[띄우기]는 한 칸만, 다음 읽은 글은 띄운 뒤에 붙는다', () => {
    let state = read(padReducer(EMPTY_PAD, { type: 'stroke', stroke: A }), ['SP'])
    state = padReducer(padReducer(state, { type: 'space' }), { type: 'space' })
    expect(state.text).toBe('SP ')
    state = read(padReducer(state, { type: 'stroke', stroke: B }), ['색금'])
    expect(insertText(state)).toBe('SP 색금')
  })

  it('읽는 동안 새로 쓴 획은 남기고, 지웠으면 늦게 온 읽기는 버린다', () => {
    let state = padReducer(EMPTY_PAD, { type: 'stroke', stroke: A })
    const sent = state.ink
    state = padReducer(state, { type: 'stroke', stroke: B })
    state = padReducer(state, { type: 'read', strokes: sent, candidates: ['백'], hints: [] })
    expect(state.text).toBe('백')
    expect(state.ink).toEqual([B])
    const cleared = padReducer(state, { type: 'clear' })
    expect(padReducer(cleared, { type: 'read', strokes: [B], candidates: ['금'], hints: [] })).toBe(cleared)
  })

  it('못 읽으면 판을 비우고 알린다', () => {
    const state = read(padReducer(EMPTY_PAD, { type: 'stroke', stroke: A }), [])
    expect(state).toMatchObject({ text: '', ink: [], missed: true })
  })

  it('후보를 누르면 위 글 전체가 그 글로, 한 글자 지우기는 쓰는 중이면 그 획들을 아니면 마지막 글자를', () => {
    let state = read(padReducer(EMPTY_PAD, { type: 'stroke', stroke: A }), ['칠화', '철화'])
    state = padReducer(state, { type: 'pick', option: '철화' })
    expect(state).toMatchObject({ text: '철화', choices: [] })
    state = padReducer(state, { type: 'stroke', stroke: B })
    state = padReducer(state, { type: 'back' })
    expect(state).toMatchObject({ text: '철화', ink: [] })
    state = padReducer(state, { type: 'back' })
    expect(state.text).toBe('철')
  })
})

describe('품종 이름으로 고치기', () => {
  const hints = ['핑크프릴', '포르투나 SP', '백금', '라울']

  it('띄어쓰기·대소문자만 다르면 품종 이름 표기로, 그 후보를 맨 앞으로', () => {
    expect(rankReadings('', ['포르투나sp'], hints)[0]).toBe('포르투나 SP')
    expect(rankReadings('', ['백굼', '백금', '맥금'], hints)).toEqual(['백금', '백굼', '맥금'])
  })

  it('앞 글과 이어 맞추고, 그 글로 시작하거나 한 글자만 다른 품종 이름을 뒤에 더한다', () => {
    expect(rankReadings('핑크', ['프릴'], hints)[0]).toBe('핑크프릴')
    expect(rankReadings('', ['핑크'], hints)).toEqual(['핑크', '핑크프릴'])
    expect(rankReadings('', ['핑크프랄'], hints)).toEqual(['핑크프랄', '핑크프릴'])
    // 한 글자짜리는 아무 이름이나 붙지 않게 더하지 않는다
    expect(rankReadings('', ['라'], hints)).toEqual(['라'])
  })

  it('네이티브로 넘기는 획: [x, y, 첫 점부터 잰 ms, …]', () => {
    expect(flattenInk([[{ x: 1.04, y: 2, t: 1000 }, { x: 3, y: 4, t: 1016 }], [{ x: 5, y: 6, t: 1100 }]])).toEqual([[1, 2, 0, 3, 4, 16], [5, 6, 100]])
  })
})

describe('손글씨 읽기 연결', () => {
  it('앱에 손글씨 읽기가 없으면 읽지 않는다 (빈 후보)', async () => {
    expect(await prepareInk()).toBe(false)
    expect(await readInk([A], 300, 200, [])).toEqual([])
  })

  it('준비를 못 하면 읽지 않고, 다음에 다시 준비해 본다', async () => {
    let ok = false
    const prepare = vi.fn(() => Promise.resolve(ok))
    wireInkReader({ prepare, recognize: () => Promise.resolve(['백금']) })
    expect(await readInk([A], 300, 200, [])).toEqual([])
    ok = true
    expect(await readInk([A], 300, 200, [])).toEqual(['백금'])
    expect(await readInk([A], 300, 200, [])).toEqual(['백금'])
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('읽다 실패하면 빈 후보 (앱이 멈추지 않는다)', async () => {
    wireInkReader({ prepare: () => Promise.resolve(true), recognize: () => Promise.reject(new Error('x')) })
    expect(await readInk([A], 300, 200, [])).toEqual([])
  })
})

describe('글자 칸의 [손글씨] 단추', () => {
  it('켠 글자 칸에만 붙는다 — 숫자 칸·비밀 칸·안 켠 칸·고칠 수 없는 칸에는 없다', () => {
    wireInkReader(fakeInk([]))
    render(
      <>
        <UnderlineField label="품종" value="" handwriting onChangeText={() => {}} />
        <UnderlineField label="뒷자리" value="" handwriting keyboardType="number-pad" onChangeText={() => {}} />
        <UnderlineField label="가격" value="" inputMode="numeric" onChangeText={() => {}} />
        <UnderlineField label="비밀번호" value="" handwriting secureTextEntry onChangeText={() => {}} />
        <UnderlineField label="닉네임" value="" onChangeText={() => {}} />
        <UnderlineField label="메모" value="a" handwriting editable={false} onChangeText={() => {}} />
      </>,
    )
    expect(screen.getByRole('button', { name: '품종 손글씨로 쓰기' })).toBeTruthy()
    for (const label of ['뒷자리', '가격', '비밀번호', '닉네임', '메모']) expect(screen.queryByRole('button', { name: `${label} 손글씨로 쓰기` })).toBeNull()
  })

  it('손글씨 읽기가 없는 앱(옛 빌드·웹)에서는 단추를 그리지 않는다', () => {
    render(<UnderlineField label="품종" value="" handwriting onChangeText={() => {}} />)
    expect(screen.queryByRole('button', { name: '품종 손글씨로 쓰기' })).toBeNull()
  })

  it('누르면 칸 이름이 제목인 판이 열리고, 아래 단추는 [지우기] 왼쪽 · [넣기] 오른쪽 — 처음엔 둘 다 쉼', async () => {
    wireInkReader(fakeInk([]))
    render(<UnderlineField label="품종" value="" handwriting onChangeText={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '품종 손글씨로 쓰기' }))
    await act(async () => {})
    // 제목은 "품종 손글씨 입력" (D-ADDPIECES-03 — 옛 기대는 칸 이름 "품종"만)
    const sheet = screen.getByRole('dialog', { name: '품종 손글씨 입력' })
    expect(sheet.textContent).toContain(HANDWRITING_WORDS.description)
    expect(screen.getByRole('img', { name: HANDWRITING_WORDS.padLabel })).toBeTruthy()
    const clear = screen.getByRole('button', { name: HANDWRITING_WORDS.clear })
    const insert = screen.getByRole('button', { name: HANDWRITING_WORDS.insert })
    expect(clear.compareDocumentPosition(insert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(insert.getAttribute('aria-disabled')).toBe('true')
    expect(clear.getAttribute('aria-disabled')).toBe('true')
    // 숫자 때의 [멈추면 바로 넣기]는 없다 — 글자는 이어 쓰므로 판매자가 [넣기]로 정한다
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('판 높이는 남는 만큼 (170 ~ 320) — 작은 아이폰 SE(667)에서도 판이 넘치지 않고, 큰 휴대폰은 크게', () => {
    expect(padHeightFor(667)).toBe(170)
    expect(padHeightFor(740)).toBe(240)
    expect(padHeightFor(844)).toBe(320)
    expect(padHeightFor(1200)).toBe(320)
  })
})

/** 판에 손가락으로 긋기 (웹 시험: 마우스로). 움직임마다 16ms — 시각이 같은 움직임은 PanResponder가 한 번으로 친다(가짜 시계) */
function draw(pad: HTMLElement, points: readonly { x: number; y: number }[]) {
  const [first, ...rest] = points
  if (first === undefined) return
  const at = (p: { x: number; y: number }) => ({ clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, buttons: 1 })
  fireEvent.mouseDown(pad, at(first))
  for (const p of rest) {
    act(() => vi.advanceTimersByTime(16))
    fireEvent.mouseMove(pad, at(p))
  }
  fireEvent.mouseUp(pad, at(rest[rest.length - 1] ?? first))
}

/** 멈춤 시계를 넘기고 읽기(약속)가 끝나기를 기다린다 */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(SETTLE_MS + 10)
    await Promise.resolve()
  })
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
  })
}

describe('손으로 써서 넣기', () => {
  function Host({ onInsert, maxLength }: { readonly onInsert: (text: string) => void; readonly maxLength?: number }) {
    const [open, setOpen] = useState(true)
    return <HandwritingSheet visible={open} onClose={() => setOpen(false)} label="품종" onInsert={onInsert} hints={['핑크프릴', '백금']} {...(maxLength === undefined ? {} : { maxLength })} />
  }

  it('"핑크"·"프릴"을 나눠 쓰면 위에 "핑크프릴"이 보이고 [넣기]로 칸에 넣은 뒤 닫힌다 — 품종 이름도 읽기에 넘긴다', async () => {
    vi.useFakeTimers()
    const ink = fakeInk([['핑크'], ['프릴']])
    wireInkReader(ink)
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} />)
    await act(async () => {})
    const pad = screen.getByTestId('handwriting-pad')
    draw(pad, [{ x: 10, y: 10 }, { x: 60, y: 80 }])
    await settle()
    draw(pad, [{ x: 100, y: 10 }, { x: 160, y: 80 }])
    await settle()
    expect(screen.getByRole('status', { name: '핑크프릴' })).toBeTruthy()
    expect(ink.calls[0]?.hints).toEqual(['핑크프릴', '백금'])
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }))
    expect(onInsert).toHaveBeenCalledWith('핑크프릴')
    expect(screen.queryByRole('dialog', { name: '품종 손글씨 입력' })).toBeNull()
  })

  it('"혹시" 후보를 누르면 그 글로 바뀐다', async () => {
    vi.useFakeTimers()
    wireInkReader(fakeInk([['백굼', '맥금']]))
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} />)
    await act(async () => {})
    draw(screen.getByTestId('handwriting-pad'), [{ x: 10, y: 10 }, { x: 60, y: 80 }])
    await settle()
    expect(screen.getByText(HANDWRITING_WORDS.maybe)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '백금 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }))
    expect(onInsert).toHaveBeenCalledWith('백금')
  })

  it('글자 수를 넘으면 넣지 않고 알린다 (잘라 넣지 않는다)', async () => {
    vi.useFakeTimers()
    wireInkReader(fakeInk([['핑크프릴']]))
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} maxLength={3} />)
    await act(async () => {})
    draw(screen.getByTestId('handwriting-pad'), [{ x: 10, y: 10 }, { x: 60, y: 80 }])
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('3자까지만 넣을 수 있어요. 한 글자씩 지워 주세요.')
    expect(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.back }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('준비를 못 하면(인터넷 없이 처음) 알린다', async () => {
    wireInkReader(fakeInk([], false))
    render(<Host onInsert={() => {}} />)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toBe(HANDWRITING_WORDS.failed)
  })

  it('글자 칸에서 열어 넣으면 칸 값이 바뀐다', async () => {
    vi.useFakeTimers()
    wireInkReader(fakeInk([['라울']]))
    function Field() {
      const [value, setValue] = useState('백금')
      return <UnderlineField label="품종" value={value} handwriting maxLength={40} onChangeText={setValue} />
    }
    render(<Field />)
    fireEvent.click(screen.getByRole('button', { name: '품종 손글씨로 쓰기' }))
    await act(async () => {})
    draw(screen.getByTestId('handwriting-pad'), [{ x: 10, y: 10 }, { x: 60, y: 80 }])
    await settle()
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }))
    expect((screen.getByLabelText('품종') as HTMLInputElement).value).toBe('라울')
  })
})

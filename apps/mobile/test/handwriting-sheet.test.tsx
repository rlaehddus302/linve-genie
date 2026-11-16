// 손글씨 판 (D-HANDWRITE-01): 판 상태(굳히기·후보로 고치기·한 글자 지우기)와 숫자 칸의 [손글씨] 단추·판 모양.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDigits } from '../src/lib/handwriting.ts'
import { EMPTY_PAD, padChoices, padReducer, SETTLE_MS, type PadState } from '../src/lib/handwriting-pad.ts'
import { getHandwriting, HANDWRITING_KEY, learnDigits, resetHandwriting, setAutoInsert, wireHandwriting } from '../src/lib/handwriting-store.ts'
import { arc, baseTemplates, join, line } from '../src/lib/handwriting-templates.ts'
import { HANDWRITING_WORDS, HandwritingSheet, isDigitField, padHeightFor, UnderlineField } from '../src/ui/kit/index.ts'

afterEach(() => {
  resetHandwriting()
  vi.useRealTimers()
})

const templates = baseTemplates()
const ONE = line([50, 10], [50, 190])
const SEVEN = line([20, 10], [120, 10], [60, 190])
const stroke = (points: readonly { x: number; y: number }[], shift = 0) => points.map((p) => ({ x: p.x + shift, y: p.y }))

describe('판 상태', () => {
  it('쓰는 동안은 흐리게 읽고(live), 멈추면 글에 붙이고 판을 비운다 — 이어 쓰면 뒤에 붙는다', () => {
    let state: PadState = padReducer(EMPTY_PAD, { type: 'stroke', stroke: ONE, templates, padHeight: 300 })
    expect(state.live?.text).toBe('1')
    expect(state.text).toBe('')
    state = padReducer(state, { type: 'settle' })
    expect(state).toMatchObject({ text: '1', ink: [], live: null })
    state = padReducer(state, { type: 'stroke', stroke: SEVEN, templates, padHeight: 300 })
    state = padReducer(state, { type: 'settle' })
    expect(state.text).toBe('17')
    expect(state.last?.from).toBe(1)
  })

  it('살짝 닿은 점은 획으로 남기지 않는다', () => {
    const state = padReducer(EMPTY_PAD, { type: 'stroke', stroke: [{ x: 5, y: 5 }], templates, padHeight: 300 })
    expect(state).toBe(EMPTY_PAD)
  })

  it('후보를 누르면 마지막 조각만 그 숫자로 바뀐다 (앞 글은 그대로)', () => {
    let state = padReducer(padReducer(EMPTY_PAD, { type: 'stroke', stroke: ONE, templates, padHeight: 300 }), { type: 'settle' })
    state = padReducer(padReducer(state, { type: 'stroke', stroke: SEVEN, templates, padHeight: 300 }), { type: 'settle' })
    const choices = padChoices(state)
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.every((choice) => choice.shown.startsWith('1') && choice.shown !== '17')).toBe(true)
    const first = choices[0]
    if (first === undefined) throw new Error('후보 없음')
    state = padReducer(state, { type: 'pick', option: first.option })
    expect(state.text).toBe(first.shown)
  })

  it('쓰는 중에 후보를 누르면 그 숫자로 바로 굳힌다', () => {
    let state = padReducer(EMPTY_PAD, { type: 'stroke', stroke: ONE, templates, padHeight: 300 })
    state = padReducer(state, { type: 'pick', option: '7' })
    expect(state).toMatchObject({ text: '7', ink: [], live: null })
  })

  it('한 글자 지우기: 쓰는 중이면 그 획들을, 아니면 마지막 숫자를 지운다. 지우기는 모두', () => {
    let state = padReducer(padReducer(EMPTY_PAD, { type: 'stroke', stroke: ONE, templates, padHeight: 300 }), { type: 'settle' })
    state = padReducer(state, { type: 'stroke', stroke: SEVEN, templates, padHeight: 300 })
    state = padReducer(state, { type: 'back' })
    expect(state).toMatchObject({ text: '1', ink: [], live: null })
    state = padReducer(state, { type: 'back' })
    expect(state.text).toBe('')
    expect(padReducer(state, { type: 'clear' })).toBe(EMPTY_PAD)
  })
})

describe('설정·배운 모양 저장 (이 휴대폰에만)', () => {
  it('멈추면 바로 넣기는 기본 꺼짐, 켜면 저장하고 다시 켜도 되살린다', async () => {
    const saved = new Map<string, string>()
    const store = { getItem: async (key: string) => saved.get(key) ?? null, setItem: async (key: string, value: string) => void saved.set(key, value) }
    await wireHandwriting(store)
    expect(getHandwriting().autoInsert).toBe(false)
    setAutoInsert(true)
    const nine = [join(arc(48, 30, 25, 25, 0, -360), line([73, 30], [70, 95]))]
    learnDigits([{ digit: '9', strokes: nine }])
    await Promise.resolve()
    const raw = saved.get(HANDWRITING_KEY) ?? ''
    // 저장에는 정규화한 점만 — 숫자·좌표 말고 다른 것이 없다
    expect(raw).toContain('"autoInsert":true')
    resetHandwriting()
    await wireHandwriting(store)
    expect(getHandwriting().autoInsert).toBe(true)
    expect(getHandwriting().learned).toHaveLength(1)
    expect(getHandwriting().templates.length).toBe(templates.length + 1)
  })

  it('저장소가 깨졌거나 실패해도 기본으로 간다', async () => {
    await wireHandwriting({ getItem: async () => '{깨짐', setItem: async () => undefined })
    expect(getHandwriting().autoInsert).toBe(false)
    await wireHandwriting({ getItem: () => Promise.reject(new Error('x')), setItem: async () => undefined })
    expect(getHandwriting().learned).toEqual([])
  })
})

describe('숫자 칸의 [손글씨] 단추', () => {
  it('숫자 칸에만 기본으로 붙고, 글 칸·비밀 칸·끈 칸·고칠 수 없는 칸에는 없다', () => {
    expect(isDigitField({ keyboardType: 'number-pad' })).toBe(true)
    expect(isDigitField({ inputMode: 'numeric' })).toBe(true)
    expect(isDigitField({ keyboardType: 'default' })).toBe(false)
    expect(isDigitField({ keyboardType: 'number-pad', secureTextEntry: true })).toBe(false)
    render(
      <>
        <UnderlineField label="뒷자리" value="" keyboardType="number-pad" onChangeText={() => {}} />
        <UnderlineField label="닉네임" value="" onChangeText={() => {}} />
        <UnderlineField label="수량" value="" keyboardType="number-pad" handwriting={false} onChangeText={() => {}} />
        <UnderlineField label="번호" value="3" keyboardType="number-pad" editable={false} onChangeText={() => {}} />
      </>,
    )
    expect(screen.getByRole('button', { name: '뒷자리 손글씨로 쓰기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '닉네임 손글씨로 쓰기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '수량 손글씨로 쓰기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '번호 손글씨로 쓰기' })).toBeNull()
  })

  it('누르면 칸 이름이 제목인 판이 열리고, 아래 단추는 [지우기] 왼쪽 · [넣기] 오른쪽 — 처음엔 둘 다 쉼', () => {
    render(<UnderlineField label="뒷자리" value="" keyboardType="number-pad" maxLength={4} onChangeText={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '뒷자리 손글씨로 쓰기' }))
    const sheet = screen.getByRole('dialog', { name: '뒷자리' })
    expect(sheet.textContent).toContain(HANDWRITING_WORDS.description)
    expect(screen.getByRole('img', { name: HANDWRITING_WORDS.padLabel })).toBeTruthy()
    const clear = screen.getByRole('button', { name: HANDWRITING_WORDS.clear })
    const insert = screen.getByRole('button', { name: HANDWRITING_WORDS.insert })
    expect(clear.compareDocumentPosition(insert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(insert.getAttribute('aria-disabled')).toBe('true')
    expect(clear.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('switch', { name: `${HANDWRITING_WORDS.auto} — 꺼짐` }).getAttribute('aria-checked')).toBe('false')
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

describe('손으로 써서 넣기', () => {
  function Host({ onInsert }: { readonly onInsert: (text: string) => void }) {
    const [open, setOpen] = useState(true)
    return <HandwritingSheet visible={open} onClose={() => setOpen(false)} label="가격" unit="원" onInsert={onInsert} maxLength={3} />
  }

  it('1·7을 쓰고 멈추면 위에 "17"이 보이고 [넣기]로 칸에 넣은 뒤 닫힌다', () => {
    vi.useFakeTimers()
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} />)
    const pad = screen.getByTestId('handwriting-pad')
    draw(pad, stroke(ONE))
    act(() => vi.advanceTimersByTime(SETTLE_MS + 10))
    draw(pad, stroke(SEVEN, 200))
    act(() => vi.advanceTimersByTime(SETTLE_MS + 10))
    expect(screen.getByRole('status', { name: '17원' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }))
    expect(onInsert).toHaveBeenCalledWith('17')
    expect(screen.queryByRole('dialog', { name: '가격' })).toBeNull()
  })

  it('자리 수를 넘으면 넣지 않고 알린다 (잘라 넣지 않는다)', () => {
    vi.useFakeTimers()
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} />)
    const pad = screen.getByTestId('handwriting-pad')
    for (let i = 0; i < 4; i += 1) {
      draw(pad, stroke(ONE, i * 150))
      act(() => vi.advanceTimersByTime(SETTLE_MS + 10))
    }
    expect(screen.getByRole('alert').textContent).toBe('3자리까지만 넣을 수 있어요. 한 글자씩 지워 주세요.')
    expect(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.back }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('멈추면 바로 넣기를 켜 두면 [넣기]를 누르지 않아도 들어간다', () => {
    vi.useFakeTimers()
    setAutoInsert(true)
    const onInsert = vi.fn()
    render(<Host onInsert={onInsert} />)
    draw(screen.getByTestId('handwriting-pad'), stroke(SEVEN))
    act(() => vi.advanceTimersByTime(SETTLE_MS + 10))
    expect(onInsert).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(2000))
    expect(onInsert).toHaveBeenCalledWith(readDigits([SEVEN], templates).text)
  })

  it('숫자 칸에서 열어 넣으면 칸 값이 바뀐다', () => {
    vi.useFakeTimers()
    function Field() {
      const [value, setValue] = useState('99')
      return <UnderlineField label="뒷자리" value={value} keyboardType="number-pad" maxLength={4} onChangeText={setValue} />
    }
    render(<Field />)
    fireEvent.click(screen.getByRole('button', { name: '뒷자리 손글씨로 쓰기' }))
    draw(screen.getByTestId('handwriting-pad'), stroke(ONE))
    act(() => vi.advanceTimersByTime(SETTLE_MS + 10))
    fireEvent.click(screen.getByRole('button', { name: HANDWRITING_WORDS.insert }))
    expect((screen.getByLabelText('뒷자리') as HTMLInputElement).value).toBe('1')
  })
})

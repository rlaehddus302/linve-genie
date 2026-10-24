// MOB1 U-MOB1-01 — 글자 150% 휴대폰에서 빠른 입력칸·되돌리기 띠가 아래 막대 뒤에 깔리지 않게: 올릴 거리 계산과 화면 올리기,
// 콘솔 위 버튼 줄이 큰 글씨에서 두 칸씩(스타일 검사는 mob1-styles.node.test.ts).
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BAR_GAP, fixedBarTop, keepAboveBar, liftBy, useKeepAboveBar } from '../src/lib/above-bar.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('올릴 거리 liftBy (U-MOB1-01)', () => {
  it('묶음 아래 끝이 막대 위 끝 - 틈보다 위면 0', () => {
    expect(liftBy(700, 600, 733)).toBe(0)
    expect(liftBy(733 - BAR_GAP, 600, 733)).toBe(0)
  })

  it('점검 화면 값: 입력칸 741~807, 막대 위 733 → 807+8-733 = 82만큼 올린다', () => {
    expect(liftBy(807, 741, 733)).toBe(82)
  })

  it('되돌리기 띠까지 덮으면 그만큼 더 — 단 입력칸 위 끝이 화면 위(틈 8px)를 넘지 않게', () => {
    expect(liftBy(1000, 300, 733)).toBe(275)
    expect(liftBy(1500, 200, 733)).toBe(192)
  })

  it('고정 영역이 위에 닿기까지 남은 거리보다 더 올리지 않는다 — 이미 닿았으면 0', () => {
    expect(liftBy(900, 600, 733, 120)).toBe(120)
    expect(liftBy(900, 100, 733, 0)).toBe(0)
    expect(liftBy(900, 100, 733, -40)).toBe(0)
  })
})

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 375, width: 375, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** 막대(nav.menu)·고정 영역·빠른 입력 묶음·입력칸을 그리고 위치를 정해 둔다 */
function setup(options: { readonly barFixed: boolean; readonly stickyTop: number; readonly inputTop: number; readonly regionBottom: number }) {
  const sticky = document.createElement('div')
  sticky.className = 'console-sticky'
  sticky.style.position = 'sticky'
  sticky.style.top = '0px'
  const region = document.createElement('div')
  region.className = 'console-sticky-quick'
  const input = document.createElement('input')
  region.append(input)
  sticky.append(region)
  const bar = document.createElement('nav')
  bar.className = 'menu'
  bar.style.position = options.barFixed ? 'fixed' : 'static'
  document.body.replaceChildren(sticky, bar)
  vi.spyOn(sticky, 'getBoundingClientRect').mockReturnValue(rect(options.stickyTop, options.regionBottom))
  vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(rect(options.inputTop - 40, options.regionBottom))
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(options.inputTop, options.inputTop + 66))
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(733, 812))
  const scrollBy = vi.fn()
  window.scrollBy = scrollBy as unknown as typeof window.scrollBy
  return { region, input, scrollBy }
}

describe('화면 올리기 keepAboveBar (U-MOB1-01)', () => {
  it('막대가 화면 아래에 붙은 휴대폰: 입력칸이 막대 뒤면 그만큼 올린다', () => {
    const { region, input, scrollBy } = setup({ barFixed: true, stickyTop: 600, inputTop: 741, regionBottom: 807 })
    expect(fixedBarTop()).toBe(733)
    keepAboveBar(region, input)
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy.mock.calls[0]![0]).toMatchObject({ top: 82 })
  })

  it('막대 위에 다 보이면 움직이지 않는다', () => {
    const { region, input, scrollBy } = setup({ barFixed: true, stickyTop: 300, inputTop: 400, regionBottom: 600 })
    keepAboveBar(region, input)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('PC(막대가 붙어 있지 않음)에서는 움직이지 않는다', () => {
    const { region, input, scrollBy } = setup({ barFixed: false, stickyTop: 600, inputTop: 741, regionBottom: 807 })
    expect(fixedBarTop()).toBeNull()
    keepAboveBar(region, input)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('고정 영역이 이미 위에 닿아 있으면 뒤 내용만 밀리므로 움직이지 않는다', () => {
    const { region, input, scrollBy } = setup({ barFixed: true, stickyTop: 0, inputTop: 60, regionBottom: 760 })
    keepAboveBar(region, input)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})

function Harness() {
  const region = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const head = useRef<HTMLDivElement>(null)
  useKeepAboveBar(region, input, head)
  return (
    <>
      <div ref={head} />
      <div className="console-sticky">
        <div ref={region} className="console-sticky-quick">
          <input ref={input} aria-label="빠른 입력" />
        </div>
      </div>
      <nav className="menu" aria-label="메뉴" style={{ position: 'fixed' }} />
    </>
  )
}

describe('useKeepAboveBar (U-MOB1-01)', () => {
  it('묶음 안으로 포커스가 들어오면 다음 그리기에서 재고 올린다 — 포커스가 밖이면 움직이지 않는다', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => frames.push(cb))
    const flushFrames = () => {
      for (const cb of frames.splice(0)) cb(0)
    }
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    const view = render(<Harness />)
    flushFrames()
    expect(scrollBy).not.toHaveBeenCalled()
    const region = view.container.querySelector<HTMLElement>('.console-sticky-quick')!
    const sticky = view.container.querySelector<HTMLElement>('.console-sticky')!
    const input = view.getByRole('textbox', { name: '빠른 입력' })
    const bar = document.querySelector<HTMLElement>('nav.menu')!
    vi.spyOn(sticky, 'getBoundingClientRect').mockReturnValue(rect(600, 807))
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue(rect(700, 807))
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(741, 807))
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(733, 812))
    input.focus()
    expect(scrollBy).not.toHaveBeenCalled()
    flushFrames()
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy.mock.calls[0]![0]).toMatchObject({ top: 82 })
    input.blur()
    window.dispatchEvent(new Event('resize'))
    flushFrames()
    expect(scrollBy).toHaveBeenCalledTimes(1)
  })
})

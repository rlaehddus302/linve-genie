// 화면이 다 넘어온 뒤에 키보드 (D-FOCUS-01, 사용자 지시 2026-11-17 "이 화면에 넘어오고 나서 키보드를 띄워. 그리고 이건 앞으로 모든 상황에서도 동일하게 전역으로 처리해."):
// 스스로 초점을 받는 칸은 넘어오는 동안 초점을 받지 않고, 다 넘어온 뒤에 받는다. 이미 넘어온 화면에서 새로 생긴 칸은 바로.
// 앱 안 어떤 칸도 autoFocus를 react-native TextInput에 바로 주지 않는다 — 공통 칸(FocusInput·TextField·UnderlineField·SearchField)으로만.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { Platform } from 'react-native'
import { afterEach, describe, expect, it } from 'vitest'
import { ArrivalProvider, FocusInput } from '../src/ui/kit/arrival.tsx'

const root = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

const realOS = Platform.OS
afterEach(() => {
  ;(Platform as { OS: string }).OS = realOS
  cleanup()
})

describe('화면이 다 넘어온 뒤에 키보드 (D-FOCUS-01)', () => {
  it('휴대폰: 넘어오는 중에 생긴 칸은 다 넘어온 뒤에 초점을 받는다', () => {
    ;(Platform as { OS: string }).OS = 'ios'
    const page = (arrived: boolean) => <ArrivalProvider arrived={arrived}><FocusInput aria-label="찾기" autoFocus /></ArrivalProvider>
    const view = render(page(false))
    const input = view.getByLabelText('찾기')
    expect(document.activeElement).not.toBe(input)
    view.rerender(page(true))
    expect(document.activeElement).toBe(input)
  })

  it('휴대폰: 이미 넘어온 화면에서 새로 생긴 칸은 바로 초점 (단계 바꿈에 키보드가 내려갔다 오르지 않게)', () => {
    ;(Platform as { OS: string }).OS = 'ios'
    const view = render(<ArrivalProvider arrived><FocusInput aria-label="이름" autoFocus /></ArrivalProvider>)
    expect(document.activeElement).toBe(view.getByLabelText('이름'))
  })

  it('autoFocus가 없는 칸은 다 넘어와도 초점을 받지 않는다', () => {
    ;(Platform as { OS: string }).OS = 'ios'
    const page = (arrived: boolean) => <ArrivalProvider arrived={arrived}><FocusInput aria-label="메모" /></ArrivalProvider>
    const view = render(page(false))
    view.rerender(page(true))
    expect(document.activeElement).not.toBe(view.getByLabelText('메모'))
  })

  it('앱 어디서도 react-native TextInput에 autoFocus를 바로 주지 않는다', () => {
    const bad: string[] = []
    for (const file of [...sources('src'), ...sources('app')]) {
      const text = read(file)
      for (const match of text.matchAll(/<TextInput\b/g)) {
        const element = text.slice(match.index, text.indexOf('/>', match.index))
        if (/\bautoFocus\b/.test(element) && !element.includes('autoFocus={focusNow}')) bad.push(relative(root, join(root, file)))
      }
    }
    expect(bad).toEqual([])
  })

  it('쌓인 화면·겹친 화면·판이 다 넘어왔다고 알린다', () => {
    expect(read('app/_layout.tsx')).toContain('<ScreenArrivalProvider navigation={navigation}>{children}</ScreenArrivalProvider>')
    expect(read('src/screens/console/parts.tsx')).toContain('<ArrivalProvider arrived={arrived}>')
    const sheets = read('src/ui/kit/sheets.tsx')
    expect(sheets).toContain('<ArrivalProvider arrived={arrived}>{children}</ArrivalProvider>')
    expect(sheets).toContain('onShow={() => setArrived(true)}')
  })
})

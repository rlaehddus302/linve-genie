// D-UX4-112 (사용자 지시 2026-11-10):
// - "잇기라는 표현 대신 연결이라는 표현으로 바꿔 (이거도 전역으로 다 적용해)": 화면 글에 '잇기'·'이은 ' 같은 '잇다' 꼴이 남지 않는다 (주석은 뺀다)
// - "서버에서 불러오느라 늦게 뜨는 것은 늦게 뜰 때 부드럽게 페이드인 되면서 위로 올라오는 애니메이션 (다른 항목에도 전역으로 똑같이 적용)":
//   늦게 오는 묶음은 Appear(·Late)로 감싼다 — 웹(시험)에서는 바로 보이고, 처음부터 있던 것은 움직이지 않는다
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, render, renderHook, screen } from '@testing-library/react'
import { Text } from 'react-native'
import { describe, expect, it } from 'vitest'
import { Appear } from '../src/ui/kit/index.ts'
import { Late, useCameLate } from '../src/ui/late.tsx'

const ROOT = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('Appear · Late (D-UX4-112)', () => {
  it('Appear는 안의 것을 그리고, 웹(시험)에서는 처음부터 다 보인다', () => {
    render(
      <Appear testID="appear-box">
        <Text>늦게 온 묶음</Text>
      </Appear>,
    )
    expect(screen.getByText('늦게 온 묶음')).toBeTruthy()
    const box = screen.getByTestId('appear-box')
    expect(getComputedStyle(box).opacity).toBe('1')
  })

  it('Late: 비어 있으면 아무것도 그리지 않고, 나중에 생기면 testID 그대로 보인다', () => {
    const view = render(<Late testID="late-box">{null}</Late>)
    expect(screen.queryByTestId('late-box')).toBeNull()
    view.rerender(<Late testID="late-box">{[]}</Late>)
    expect(screen.queryByTestId('late-box')).toBeNull()
    view.rerender(
      <Late testID="late-box">
        <Text>받은 목록</Text>
      </Late>,
    )
    expect(screen.getByTestId('late-box').textContent).toBe('받은 목록')
    expect(getComputedStyle(screen.getByTestId('late-box')).opacity).toBe('1')
  })

  it('useCameLate: 처음부터 있던 자료는 늦지 않았고, 처음에 없었거나 한 번 비었으면 늦게 온 것', () => {
    const cached = renderHook(({ ready }) => useCameLate(ready), { initialProps: { ready: true } })
    expect(cached.result.current).toBe(false)
    act(() => cached.rerender({ ready: false }))
    expect(cached.result.current).toBe(true)
    act(() => cached.rerender({ ready: true }))
    expect(cached.result.current).toBe(true)

    const fetched = renderHook(({ ready }) => useCameLate(ready), { initialProps: { ready: false } })
    expect(fetched.result.current).toBe(true)
    act(() => fetched.rerender({ ready: true }))
    expect(fetched.result.current).toBe(true)
  })
})

/** 주석(줄 주석·막음 주석·JSX 주석)을 지운 소스 — 'https://' 같은 글 안의 // 는 남긴다 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n')
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

// 사용자가 같은 때 직접 고치는 파일 (D-UX4-112 — 그쪽에서 '연결'로 바꾼다)
const OWNED_ELSEWHERE = new Set([
  'src/screens/console/YoutubeSection.tsx',
  'src/screens/BroadcastLinkScreen.tsx',
  'src/screens/NewBroadcastScreen.tsx',
  'src/screens/console/LinkInfo.tsx',
  'src/native/paste.tsx',
  'src/native/production.tsx',
  'src/ui/kit/inputs.tsx',
  'src/ui/kit/sheets.tsx',
  'src/ui/kit/appear.tsx',
  'src/ui/ChannelPhoto.tsx',
])

// 이어서(계속)·이어폰 같은 뜻은 그대로 — '잇다(연결)' 꼴만 본다
const LINK_WORDS = ['잇기', '이은 ', '이을 ', '잇는 ', '잇고 ', '잇지 ']

describe("화면 글은 '연결' (D-UX4-112)", () => {
  it("앱 소스(src·app)의 화면 글에 '잇기'·'이은 ' 같은 꼴이 없다 (주석 빼고)", () => {
    const found: string[] = []
    for (const file of [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'app'))]) {
      const path = relative(ROOT, file).split('\\').join('/')
      if (OWNED_ELSEWHERE.has(path)) continue
      const code = withoutComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, index) => {
        for (const word of LINK_WORDS) if (line.includes(word)) found.push(`${path}:${String(index + 1)} ${word.trim()}`)
      })
    }
    expect(found).toEqual([])
  })

  it('주석 지우기는 글 안의 주소는 남긴다', () => {
    expect(withoutComments("const a = 'https://x.y/잇기' // 잇기\n{/* 이은 라이브 */}")).toBe("const a = 'https://x.y/잇기' \n{}")
  })
})

describe('늦게 오는 묶음은 부드럽게 (D-UX4-112)', () => {
  it('홈: 시작 안내·내 라이브·오늘 할 일·머리의 라이브 줄을 Late로, 늦게 생긴 할 일 줄은 Appear로', () => {
    const home = read('src/screens/HomeScreen.tsx')
    expect(home).toMatch(/<Late>\s*\{nav\.openStart !== undefined && items !== null/)
    expect(home).toMatch(/<Late>\s*\{past\.length > 0 \? \(/)
    expect(home).toMatch(/<Late>\s*\{todoRows\.length > 0 \? \(/)
    expect(home).toMatch(/left=\{<Late>\{liveNow\.resolved/)
    expect(home).toMatch(/<Appear key=\{row\.key\} instant=\{firstTodo\?\.has\(row\.key\) !== false\}>/)
  })

  it('목록 화면: 불러온 뒤에야 생기는 목록을 Late·Appear로 감싼다', () => {
    const lists: readonly (readonly [string, RegExp])[] = [
      ['src/screens/BroadcastList.tsx', /<Late>\s*\{past\.length > 0 \? \(/],
      ['src/screens/DepositsScreen.tsx', /<Appear instant=\{!late\} style=\{\{ gap: CARD_GAP \}\}>\s*\{list\.map/],
      ['src/screens/ReceiptsScreen.tsx', /<Appear instant=\{!late\} style=\{\{ gap: CARD_GAP \}\}>/],
      // D-UX4-125 (사용자 지시 2026-11-11 '주문 탭 수정 사항')로 바뀐 기대: 옛 카드 묶음 사이 간격(CARD_GAP)이 없는 흰 목록 — 주문 목록을 Appear로 감싼다
      ['src/screens/SettleScreen.tsx', /<Appear instant=\{!late\}>\s*<View role="list" aria-label="주문 목록">/],
      ['src/screens/PackingScreen.tsx', /<Appear instant=\{!late\} style=\{\{ gap: SPACE\.md \}\}>/],
      ['src/screens/ParcelsScreen.tsx', /<Appear instant=\{!late\} style=\{\{ gap: SPACE\.lg \}\}>/],
      ['src/screens/BuyersScreen.tsx', /<Appear instant=\{!late\} style=\{\{ gap: SPACE\.md \}\}>/],
      ['src/screens/CustomersScreen.tsx', /<Late>\s*\{view !== null \? \(\s*<View style=\{\{ gap: SPACE\.xs \}\}>/],
      ['src/screens/ReviewsScreen.tsx', /<Late>\s*\{view !== null && queue !== null \? <ReviewList/],
      ['src/screens/ScheduleScreen.tsx', /<Late style=\{\{ gap: SPACE\.md \}\}>\s*\{view !== null \? \(/],
      ['src/screens/ConsoleScreen.tsx', /<Appear instant=\{!listLate\}[^>]*>\s*\{shownTab === 'products' \? <ProductList/],
      // D-UX4-126: 주문 상세 아래 배송지 칸(ParcelAddress AddressCard)은 사용자 지시로 없앴다 — 그 칸의 늦게 오는 내용도 없다
    ]
    for (const [path, shape] of lists) expect(read(path), path).toMatch(shape)
  })

  it('늦음 판단은 처음 그릴 때 자료가 있었는지로 (useCameLate) — 기억해 둔 자료로 그린 화면은 움직이지 않는다', () => {
    for (const path of ['src/screens/DepositsScreen.tsx', 'src/screens/SettleScreen.tsx', 'src/screens/PackingScreen.tsx', 'src/screens/ReceiptsScreen.tsx', 'src/screens/ParcelsScreen.tsx', 'src/screens/ConsoleScreen.tsx']) {
      expect(read(path), path).toMatch(/useCameLate\(/)
    }
    const late = read('src/ui/late.tsx')
    expect(late).toContain('<Appear instant={!late}')
    expect(late).toContain('useState(!ready)')
  })
})

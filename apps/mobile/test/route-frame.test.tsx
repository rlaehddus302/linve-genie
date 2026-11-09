// 상태 막대 자리 색은 안의 화면이 정한다 (D-UX4-97, 사용자 지시 2026-11-10 "위에 배경이 또 다름. 원인 제대로 파악하고 다신 안 이러게"):
// 원인 — 경로마다 위 띠를 회색으로 못 박아, 흰 화면(라이브 관리 등) 위에 회색 띠가 남았다. 모든 경로는 RouteFrame 하나를 쓰고, 흰 화면이 알리면 흰색.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'
import { StackPage } from '../src/ui/kit/stack-page.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'

const APP = join(import.meta.dirname, '..', 'app')
const routes = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? routes(path) : path.endsWith('.tsx') ? [path] : []
})
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
// 안전 영역 모듈은 네이티브 코드라 시험에서는 같은 모양의 가벼운 것으로 (위 59 · 아래 34)
vi.mock('react-native-safe-area-context', async () => {
  const { View } = await import('react-native')
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 59, left: 0, right: 0, bottom: 34 }) }
})
const SafeAreaProvider = ({ children }: { readonly children: React.ReactNode }) => <>{children}</>

describe('경로 틀 (D-UX4-97)', () => {
  it('경로 파일은 상태 막대 자리 색을 못 박지 않는다 — SafeAreaView·PALETTE 바탕을 직접 쓰지 않고 RouteFrame', () => {
    const skip = new Set(['index.tsx', '_layout.tsx', '+native-intent.tsx', 'design.tsx'])
    const offenders = routes(APP).filter((path) => !skip.has(path.split('/').at(-1) ?? '')).filter((path) => {
      const source = readFileSync(path, 'utf8')
      if (!source.includes('export default') || !/return \(?\s*</.test(source.replace(/return <Redirect[^\n]*/g, ''))) return false
      return source.includes('SafeAreaView') || /backgroundColor: PALETTE/.test(source) || !source.includes('<RouteFrame')
    })
    expect(offenders.map((path) => path.slice(APP.length + 1))).toEqual([])
  })

  it('흰 화면이 떠 있으면 위 띠도 흰색, 회색 화면이면 회색', () => {
    const frameColor = () => getComputedStyle(screen.getByTestId('route-frame')).backgroundColor
    const view = render(
      <SafeAreaProvider>
        <RouteFrame>
          <StackPage name="흰 화면" onBack={() => {}}>{null}</StackPage>
        </RouteFrame>
      </SafeAreaProvider>,
    )
    expect(frameColor()).toBe(rgb(PALETTE.light.surface))
    view.unmount()
    render(
      <SafeAreaProvider>
        <RouteFrame>
          <StackPage name="회색 화면" gray onBack={() => {}}>{null}</StackPage>
        </RouteFrame>
      </SafeAreaProvider>,
    )
    expect(frameColor()).toBe(rgb(PALETTE.light.background))
  })
})

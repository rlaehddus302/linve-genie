// QL2 (AC-S06-51): key가 바뀐 바로 그 그림에 옛 key의 저장소를 돌려주지 않는다.
// 문자찜 화면에서 방송을 바꾼 순간 옛 방송 자료로 입력 칸이 잠깐 열려, 그새 친 메모가 새 저장소가 열리며 사라졌다(E2E pwa 새 버전 안내 시험).
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsoleStore } from '../src/lib/console-store.ts'
import { useScopeStore } from '../src/lib/use-store.ts'
import { FakeEventSource } from './support.ts'

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  // 조회는 끝나지 않는다 — 저장소가 어느 key 것인지만 본다
  vi.stubGlobal('fetch', () => new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useScopeStore (QL2)', () => {
  it('방송을 바꾼 첫 그림부터 옛 방송 저장소가 아니다 — 새 저장소가 열릴 때까지 "불러오는 중"', () => {
    const seen: { key: string | null; store: ConsoleStore | null; phase: string }[] = []
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => {
      const out = useScopeStore(id, () => ({ broadcastId: id ?? '', messages: false }))
      seen.push({ key: id, store: out.store, phase: out.snapshot.phase })
      return out
    }, { initialProps: { id: 'b1' as string | null } })
    const first = result.current.store
    expect(first).not.toBeNull()
    rerender({ id: 'b2' })
    const second = result.current.store
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    const afterSwitch = seen.filter((render) => render.key === 'b2')
    expect(afterSwitch.length).toBeGreaterThan(0)
    for (const render of afterSwitch) {
      expect(render.store).not.toBe(first)
      if (render.store === null) expect(render.phase).toBe('loading')
    }
    rerender({ id: null })
    expect(result.current.store).toBeNull()
    expect(seen.filter((render) => render.key === null).every((render) => render.store === null && render.phase === 'loading')).toBe(true)
  })
})

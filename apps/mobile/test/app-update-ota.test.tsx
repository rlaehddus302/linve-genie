// D-OTA-01 앱 화면 새 버전 (사용자 지시 2026-11-12 "ui 수정하면 실제 휴대폰에 업데이트 되는데에 얼마나 걸려? 그리고 최대한 빨리하는 방법 없어?" → "네, 만들어").
// 받아 둔 새 버전이 있을 때만 홈에 [나중에](왼쪽)·[지금 바꾸기](오른쪽). 앱은 사장님이 누를 때만 다시 켜진다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAppUpdate, resetAppUpdate, setUpdatesApi, UPDATE_CHECK_GAP_MS } from '../src/lib/app-update.ts'
import { UPDATE_READY_TITLE, UpdateReady } from '../src/screens/UpdateReady.tsx'

afterEach(() => resetAppUpdate())

function fakeApi(found: boolean | Error) {
  const api = {
    fetchNew: vi.fn(async () => {
      if (found instanceof Error) throw found
      return found
    }),
    reload: vi.fn(async () => {}),
  }
  setUpdatesApi(api)
  return api
}

describe('새 버전 받기 (D-OTA-01)', () => {
  it('받아 둔 새 버전이 없으면 아무것도 안 보인다', async () => {
    fakeApi(false)
    render(<UpdateReady />)
    await act(() => checkAppUpdate(1_000_000))
    expect(screen.queryByRole('group', { name: UPDATE_READY_TITLE })).toBeNull()
  })

  it('받아 두면 [나중에]·[지금 바꾸기]가 한 줄에(부정 왼쪽), [지금 바꾸기]를 눌러야만 다시 켠다', async () => {
    const api = fakeApi(true)
    render(<UpdateReady />)
    await act(() => checkAppUpdate(1_000_000))
    expect(api.reload).not.toHaveBeenCalled()
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['나중에', '지금 바꾸기'])
    fireEvent.click(screen.getByRole('button', { name: '지금 바꾸기' }))
    expect(api.reload).toHaveBeenCalledTimes(1)
  })

  it('[나중에]면 사라지고, 다시 묻지도 않는다(다음에 앱을 켤 때 바뀐다)', async () => {
    const api = fakeApi(true)
    render(<UpdateReady />)
    await act(() => checkAppUpdate(1_000_000))
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    expect(screen.queryByRole('group', { name: UPDATE_READY_TITLE })).toBeNull()
    await act(() => checkAppUpdate(1_000_000 + UPDATE_CHECK_GAP_MS * 10))
    expect(api.fetchNew).toHaveBeenCalledTimes(1)
  })

  it('1분 안에 다시 묻지 않고, 인터넷이 없어도 조용히 넘긴다', async () => {
    const api = fakeApi(new Error('network'))
    render(<UpdateReady />)
    await act(() => checkAppUpdate(1_000_000))
    await act(() => checkAppUpdate(1_000_000 + 1000))
    expect(api.fetchNew).toHaveBeenCalledTimes(1)
    await act(() => checkAppUpdate(1_000_000 + UPDATE_CHECK_GAP_MS))
    expect(api.fetchNew).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('group', { name: UPDATE_READY_TITLE })).toBeNull()
  })

  it('받는 곳 설정: 아이폰·안드로이드 모두 운영 서버, 앱 버전 지문으로 맞춘다', () => {
    const mobile = join(import.meta.dirname, '..')
    const plist = readFileSync(join(mobile, 'ios/app/Supporting/Expo.plist'), 'utf8')
    const manifest = readFileSync(join(mobile, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
    const appJson = JSON.parse(readFileSync(join(mobile, 'app.json'), 'utf8')) as { expo: { runtimeVersion: unknown } }
    expect(plist).toMatch(/<key>EXUpdatesEnabled<\/key>\s*<true\/>/)
    expect(plist).toMatch(/<key>EXUpdatesURL<\/key>\s*<string>https:\/\/livegenie\.kr\/app-updates\/manifest<\/string>/)
    expect(plist).toMatch(/<key>EXUpdatesRuntimeVersion<\/key>\s*<string>file:fingerprint<\/string>/)
    expect(manifest).toContain('android:name="expo.modules.updates.ENABLED" android:value="true"')
    expect(manifest).toContain('android:name="expo.modules.updates.EXPO_UPDATE_URL" android:value="https://livegenie.kr/app-updates/manifest"')
    expect(manifest).toContain('android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="file:fingerprint"')
    expect(appJson.expo.runtimeVersion).toEqual({ policy: 'fingerprint' })
  })
})

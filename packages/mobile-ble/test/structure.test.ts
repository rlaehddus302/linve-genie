// 선언·문장·비밀 없음 (APP-01 권한 설명 D-APP-11, APP-01 AC2): ble-plx 플러그인 설정 값, 안드로이드 실행 중 권한, 소스에 비밀·로그 없음.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANDROID_BLE_RUNTIME_PERMISSIONS, BLE_PLX_PLUGIN_CONFIG, BLE_RADIO_MESSAGES, BLUETOOTH_PERMISSION_MESSAGE } from '../src/index.ts'

const ROOT = join(import.meta.dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('앱 설정 값', () => {
  it('블루투스 권한 문장 그대로, ble-plx 플러그인은 아이폰 백그라운드 central·위치에 쓰지 않음', () => {
    expect(BLUETOOTH_PERMISSION_MESSAGE).toBe('라벨 프린터에 연결해 라벨을 찍으려고 블루투스를 써요.')
    expect(BLE_PLX_PLUGIN_CONFIG[0]).toBe('react-native-ble-plx')
    expect(BLE_PLX_PLUGIN_CONFIG[1]).toEqual({ isBackgroundEnabled: true, neverForLocation: true, modes: ['central'], bluetoothAlwaysPermission: BLUETOOTH_PERMISSION_MESSAGE })
    expect([...ANDROID_BLE_RUNTIME_PERMISSIONS]).toEqual(['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'])
    for (const message of Object.values(BLE_RADIO_MESSAGES)) expect(message).not.toMatch(/[A-Za-z]{3,}/)
  })

  it('설정 플러그인 파일을 두지 않는다 (ble-plx 것을 쓴다) — package.json의 내보내기도 없다', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { exports: Record<string, string>; peerDependencies: Record<string, string> }
    expect(Object.keys(pkg.exports)).toEqual(['.', './plx'])
    expect(pkg.peerDependencies['react-native-ble-plx']).toBe('*')
  })
})

describe('비밀·로그 없음', () => {
  const sources = walk(join(ROOT, 'src'))

  it('소스에 서버 주소·토큰·console이 없고, ble-plx는 plx.ts만 부른다(그것도 타입만)', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/console\.|LIVEJJIM_|Bearer\s|wss?:\/\//)
      if (!file.endsWith('plx.ts')) expect(text, file).not.toMatch(/from 'react-native-ble-plx'/)
    }
    const plx = readFileSync(join(ROOT, 'src', 'plx.ts'), 'utf8')
    expect(plx).toMatch(/import type \{[^}]*\} from 'react-native-ble-plx'/)
    expect(plx).not.toMatch(/^import \{[^}]*\} from 'react-native-ble-plx'/m)
  })

  it('프린터 바이트는 @livejjim/printer·niimbluelib이 만든다 — 이 패키지에 래스터·패킷 만들기가 없다', () => {
    const adapter = readFileSync(join(ROOT, 'src', 'adapter.ts'), 'utf8')
    const client = readFileSync(join(ROOT, 'src', 'client.ts'), 'utf8')
    expect(adapter).toContain('createNiimbotAdapter(')
    expect(client).toContain('extends NiimbotAbstractClient')
    for (const text of [adapter, client]) expect(text).not.toMatch(/ImageEncoder|PacketGenerator|printBitmapRow|0x55/)
  })
})

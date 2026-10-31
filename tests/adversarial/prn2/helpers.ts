// PRN2 적대 시험 도우미 (test-domain). 골든 읽기, 브라우저 고르기 창 흉내, 꾸러미 A에서 ff03만 빼기, 앱 가짜 BleManager의 끝 알림 바꾸기.
// 제품의 판정 함수를 쓰지 않고 스펙 문장(L-7 고르기 목록·L-12 3~5)만으로 기대를 만든다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BluetoothDeviceLike, BluetoothEnvironment, BluetoothRequestOptions, GattServerLike } from '@livejjim/printer'

export const GOLDEN_DIR = join(import.meta.dirname, '..', '..', 'golden', 'printer')
export const NIIMBOT_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
export const FF03 = '0000ff03-0000-1000-8000-00805f9b34fb'

export interface GoldenCase {
  readonly id: string
  readonly title: string
  readonly profile?: string
  readonly name?: string | null
  readonly services?: readonly string[]
  readonly value?: string
  readonly ua?: string
  readonly maxTouchPoints?: number
  readonly image?: { readonly width: number; readonly height: number; readonly rows?: readonly string[]; readonly fill?: 'white' | 'black' | 'border' }
  readonly options?: { readonly density: number }
  readonly out: Record<string, unknown>
}

export function golden(kind: 'list' | 'end' | 'name' | 'job' | 'profile' | 'browser'): readonly GoldenCase[] {
  const file = JSON.parse(readFileSync(join(GOLDEN_DIR, `${kind}.json`), 'utf8')) as { kind: string; cases: GoldenCase[] }
  if (file.kind !== kind) throw new Error(`골든 ${kind} 종류가 다르다`)
  return file.cases
}

/** 16진 글 → 바이트 */
export const hexBytes = (text: string): number[] => (text.replace(/\s+/g, '').match(/../g) ?? []).map((b) => parseInt(b, 16))
export const hexOf = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/**
 * 브라우저 고르기 창의 거르기 판단 (Web Bluetooth: filters 중 하나라도 맞으면 보인다 — services는 모두 광고해야, namePrefix는 글자 그대로).
 * UUID 비교는 소문자로 (브라우저가 정규화한다)
 */
export function shownByFilters(request: BluetoothRequestOptions | Record<string, unknown>, name: string | null | undefined, services: readonly string[]): boolean {
  const filters = ((request as { filters?: unknown }).filters ?? []) as readonly Record<string, unknown>[]
  const advertised = services.map((s) => s.toLowerCase())
  return filters.some((f) => {
    if (Array.isArray(f.services)) return (f.services as string[]).every((s) => advertised.includes(s.toLowerCase()))
    if (typeof f.namePrefix === 'string') return typeof name === 'string' && name.startsWith(f.namePrefix)
    return false
  })
}

/** 꾸러미 A에서 흐름 제어 특성(ff03)만 없는 기기로 바꾼 환경 (D-PRN2-03) */
export function withoutFlow(env: BluetoothEnvironment): BluetoothEnvironment {
  const bluetooth = env.bluetooth as { requestDevice: (r: BluetoothRequestOptions) => Promise<BluetoothDeviceLike>; getAvailability?: () => Promise<boolean> }
  const wrapServer = (server: GattServerLike): GattServerLike =>
    new Proxy(server, {
      get(target, key, receiver) {
        if (key === 'getPrimaryService')
          return async (uuid: string) => {
            const service = await target.getPrimaryService(uuid)
            return {
              getCharacteristic: (id: string) =>
                id.toLowerCase() === FF03 ? Promise.reject(Object.assign(new Error('No Characteristics matching UUID'), { name: 'NotFoundError' })) : service.getCharacteristic(id),
            }
          }
        if (key === 'connect') return async () => wrapServer(await target.connect())
        const value = Reflect.get(target, key, receiver) as unknown
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    })
  return {
    ...env,
    bluetooth: {
      ...(bluetooth.getAvailability ? { getAvailability: () => (bluetooth.getAvailability as () => Promise<boolean>)() } : {}),
      requestDevice: async (r: BluetoothRequestOptions) => {
        const device = await bluetooth.requestDevice(r)
        return { ...device, gatt: wrapServer(device.gatt as GattServerLike), addEventListener: device.addEventListener.bind(device), removeEventListener: device.removeEventListener.bind(device) }
      },
    },
  } as BluetoothEnvironment
}

// 계열 표 (APP-03, L-7·L-12 3): 한 목록 고르기가 계열 표(데이터)로 기종을 가르고, 고르기 창의 줄은 이름 없는 기기를 빼고 신호 센 차례·기종 이름으로 보인다.
// 앱 기본(실험 계열 숨김)은 B1 계열 하나 — Marklife 이름 꼴은 B1 목록에 섞이지 않고, 앱을 다시 켠 뒤 기억한 기기로는 찾지 않고 바로 잇는다.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createFakeBleTransport,
  createPrinterPicker,
  enabledFamilies,
  familyOf,
  familyScanFilter,
  marklifeFamily,
  niimbotFamily,
  pickEntries,
  signalWord,
  type BleDeviceInfo,
  type DevicePicker,
  type PrinterFamily,
  type PrinterPicker,
} from '../src/index.ts'
import { sampleImage } from './fakes.ts'

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

const made: PrinterPicker[] = []
afterEach(async () => {
  for (const picker of made.splice(0)) await picker.disconnect()
})

/** 목록이 오면 그 목록을 남기고 조건에 맞는 첫 기기를 고르는 창 (없으면 기다린다) */
function pickWhere(match: (device: BleDeviceInfo) => boolean, seen: (readonly BleDeviceInfo[])[] = []): DevicePicker & { calls: number } {
  const picker = Object.assign(
    (scan: Parameters<DevicePicker>[0]) =>
      new Promise<BleDeviceInfo | null>((resolve) => {
        picker.calls++
        const stop = scan.onDevices((devices) => {
          seen.push(devices)
          const hit = devices.find(match)
          if (hit !== undefined) {
            stop()
            resolve(hit)
          }
        })
      }),
    { calls: 0 },
  )
  return picker
}

describe('계열 표', () => {
  it('표 순서대로 묻는다: Marklife 이름은 Marklife, 대소문자만 다른 Marklife 꼴은 받지 않음, 그 밖은 NIIMBOT', () => {
    const both = [marklifeFamily(), niimbotFamily()]
    expect(familyOf('P50_1234', both)).toBe('MARKLIFE')
    expect(familyOf('p50_1234', both)).toBeNull()
    expect(familyOf('B1-1234', both)).toBe('NIIMBOT')
    expect(familyOf(null, both)).toBe('NIIMBOT')
    // B1만 켜도 Marklife 이름 꼴은 B1로 가지 않는다
    const b1Only = [niimbotFamily()]
    expect(familyOf('P50_1234', b1Only)).toBeNull()
    expect(familyOf('B1-1234', b1Only)).toBe('NIIMBOT')
  })

  it('기종 이름: Marklife는 이름 앞자리의 프로필 이름, NIIMBOT은 계열 이름 (B1 확인은 이은 뒤)', () => {
    expect(marklifeFamily().modelName('X2_ABCD')).toBe('Marklife X2')
    expect(marklifeFamily().modelName('P50_ABCD')).toBe('Marklife P50')
    expect(niimbotFamily().modelName('B1-1234')).toBe('NIIMBOT')
  })

  it('앱 기본은 실험이 아닌 계열만 — Marklife는 숨김 스위치를 켜야 들어간다', () => {
    const table = [marklifeFamily(), niimbotFamily()]
    expect(enabledFamilies(table, false).map((f) => f.id)).toEqual(['NIIMBOT'])
    expect(enabledFamilies(table, true).map((f) => f.id)).toEqual(['MARKLIFE', 'NIIMBOT'])
  })

  it('찾기 거르기는 켠 계열의 거르기를 합친다 (같은 값은 한 번)', () => {
    const filter = familyScanFilter([marklifeFamily(), niimbotFamily()])
    expect(filter.namePrefixes).toContain('P50_')
    expect(filter.namePrefixes).toContain('B')
    expect(new Set(filter.namePrefixes).size).toBe(filter.namePrefixes.length)
    expect(filter.serviceUuids).toEqual(['e7810a71-73ae-499d-8c15-faa9aef0c3f2'])
  })

  it('B1 계열 하나로 만든 고르기: Marklife 이름은 목록에 없고, 고른 B1로 잇는다', async () => {
    const fake = createFakeBleTransport({
      device: { id: 'FA:KE:B1:00:00:01', name: 'B1-FAKE01', rssi: -70 },
      others: [
        { id: 'ML:P50', name: 'P50_77', rssi: -40 },
        { id: 'NO:NAME', name: null, rssi: -30 },
      ],
    })
    const seen: (readonly BleDeviceInfo[])[] = []
    const pickDevice = pickWhere((d) => d.name === 'B1-FAKE01', seen)
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice, families: [niimbotFamily({ client: { packetIntervalMs: 0 } })] })
    made.push(picker)
    expect(picker.families.map((f) => f.id)).toEqual(['NIIMBOT'])
    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('NIIMBOT')
    const names = seen.flat().map((d) => d.name)
    expect(names).not.toContain('P50_77')
    // 고르기 창의 줄: 이름 없는 기기는 숨김
    const entries = picker.entries(seen.at(-1) ?? [])
    expect(entries.map((e) => e.title)).toEqual(['B1-FAKE01'])
    expect(entries[0]?.detail).toBe('NIIMBOT · 신호 보통')
    expect(await picker.print(sampleImage(1))).toEqual({ ok: true })
    expect(fake.printer.printed).toHaveLength(1)
  })

  it('계열을 데이터로 더한다 — 고르기 코드를 고치지 않고 새 계열로 이름을 갈라 보낸다', async () => {
    const base = niimbotFamily({ client: { packetIntervalMs: 0 } })
    const other: PrinterFamily = {
      ...base,
      id: 'OTHER',
      label: '다른 프린터',
      experimental: true,
      claim: (name) => (name?.startsWith('ZZ') === true ? 'mine' : 'pass'),
      modelName: () => '다른 프린터',
    }
    const fake = createFakeBleTransport({ device: { id: 'FA:KE:B1:00:00:01', name: 'ZZ-1' } })
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: pickWhere((d) => d.name === 'ZZ-1'), families: [other, base] })
    made.push(picker)
    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('OTHER')
    expect(picker.entries([{ id: 'x', name: 'ZZ-1' }])[0]?.model).toBe('다른 프린터')
  })

  it('계열 ID가 겹치거나 표가 비면 만들지 않는다', () => {
    const fake = createFakeBleTransport()
    const pickDevice = pickWhere(() => true)
    expect(() => createPrinterPicker({ transport: fake.transport, pickDevice, families: [] })).toThrow(TypeError)
    expect(() => createPrinterPicker({ transport: fake.transport, pickDevice, families: [niimbotFamily(), niimbotFamily()] })).toThrow(TypeError)
  })

  it('켠 계열이 하나면 앱을 다시 켠 뒤 기억한 기기로 찾지 않고 바로 잇는다 (고르기 창 없음)', async () => {
    const fake = createFakeBleTransport()
    const pickDevice = pickWhere(() => false)
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice, families: [niimbotFamily({ client: { packetIntervalMs: 0 } })] })
    made.push(picker)
    picker.restoreRemembered({ method: 'bluetooth', deviceId: 'FA:KE:B1:00:00:01' })
    expect(picker.hasRemembered).toBe(true)
    expect(await picker.reconnect('bluetooth')).toEqual({ ok: true })
    expect(pickDevice.calls).toBe(0)
    expect(fake.scanning).toBe(0)
    expect(picker.kind).toBe('NIIMBOT')
  })
})

describe('고르기 창의 줄 (이름 없는 기기 숨김·신호 센 차례·기종 이름)', () => {
  const model = (device: BleDeviceInfo): string => (device.name?.startsWith('P50_') === true ? 'Marklife P50' : 'NIIMBOT')

  it('이름 없는(빈 이름 포함) 기기는 빼고, 신호가 센 차례, 신호를 모르면 뒤 (같으면 찾은 차례)', () => {
    const entries = pickEntries(
      [
        { id: '1', name: 'B1-AAAA', rssi: -85 },
        { id: '2', name: null, rssi: -20 },
        { id: '3', name: '  ', rssi: -25 },
        { id: '4', name: 'P50_1', rssi: -50 },
        { id: '5', name: 'B1-CCCC' },
        { id: '6', name: 'B1-BBBB', rssi: -70 },
        { id: '7', name: 'B1-DDDD' },
      ],
      model,
    )
    expect(entries.map((e) => e.device.id)).toEqual(['4', '6', '1', '5', '7'])
    expect(entries.map((e) => e.detail)).toEqual(['Marklife P50 · 신호 강함', 'NIIMBOT · 신호 보통', 'NIIMBOT · 신호 약함', 'NIIMBOT', 'NIIMBOT'])
  })

  it('같은 이름이 둘이면 기기 ID 끝 네 글자로 가린다', () => {
    const entries = pickEntries(
      [
        { id: 'AA:BB:CC:DD:12:34', name: 'B1-SAME', rssi: -60 },
        { id: 'AA:BB:CC:DD:56:78', name: 'B1-SAME', rssi: -61 },
        { id: 'AA:BB:CC:DD:9A:BC', name: 'B1-ONE', rssi: -62 },
      ],
      model,
    )
    expect(entries.map((e) => e.title)).toEqual(['B1-SAME (끝자리 1234)', 'B1-SAME (끝자리 5678)', 'B1-ONE'])
  })

  it('신호 낱말 경계', () => {
    expect(signalWord(-65)).toBe('신호 강함')
    expect(signalWord(-66)).toBe('신호 보통')
    expect(signalWord(-80)).toBe('신호 보통')
    expect(signalWord(-81)).toBe('신호 약함')
    expect(signalWord(undefined)).toBeNull()
  })
})

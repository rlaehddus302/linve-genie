// PRN2 앱 고르기 목록 (AC-PRN2-04·07, LABEL_RULES L-7 고르기 목록·지원 단계, D-PRN2-01·04·08).
// 앱의 계열 표·고르기는 웹과 같은 판정 함수(@livejjim/printer pickListTarget)와 같은 표를 쓴다 — 프린터 골든 list를 앱 경로로도 돌린다.
// 실험 기종도 숨김 없이 목록에 보이고 L-12 줄에는 "실험"이 붙는다. 바우아토는 Luck Jingle 바이트로 찍힌다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAUATO_PPA2L, PRINTER_PROFILES, buildPrintJob, pickListTarget, printerProfile } from '@livejjim/printer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createFakeBleTransport,
  createPlxTransport,
  createPrinterPicker,
  defaultPrinterFamilies,
  familyOf,
  familyScanFilter,
  type BleDeviceInfo,
  type DevicePicker,
  type PrinterPicker,
} from '../src/index.ts'
import { combineTransports, createFakeMarklifeManager } from './marklife-fakes.ts'
import { sampleImage } from './fakes.ts'

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

const made: PrinterPicker[] = []
afterEach(async () => {
  for (const picker of made.splice(0)) await picker.disconnect()
})

const NIIMBOT_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'

interface ListCase {
  readonly id: string
  readonly name: string | null
  readonly services?: readonly string[]
  readonly out: { readonly list: string | null }
}

const LIST = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'golden', 'printer', 'list.json'), 'utf8')) as { kind: string; cases: ListCase[] }

describe('골든 list를 앱 계열 표로 (AC-PRN2-04 — 앱·웹 같은 함수/표)', () => {
  it('사례 24개를 읽는다', () => {
    expect(LIST.kind).toBe('list')
    expect(LIST.cases).toHaveLength(24)
  })

  for (const c of LIST.cases) {
    it(`${c.id} ${String(c.name)}`, () => {
      const families = defaultPrinterFamilies()
      const kind = familyOf(c.name, families, c.services ?? [])
      const want = c.out.list
      if (want === null) expect(kind).toBeNull()
      else if (want === 'NIIMBOT') expect(kind).toBe('NIIMBOT')
      else {
        expect(kind).toBe('MARKLIFE')
        // 목록 줄의 기종 이름은 그 프로필
        expect(families[0]?.modelName(c.name)).toBe(printerProfile(want)?.displayName)
      }
      // 웹이 쓰는 함수와 같은 답
      expect(pickListTarget(c.name, c.services ?? [])).toBe(want)
    })
  }

  it('앱 기본 계열이 덮는 프로필 = 켠 프로필 표 전부', () => {
    const ids = defaultPrinterFamilies().flatMap((f) => f.profiles.map((p) => p.id))
    expect([...ids].sort()).toEqual(PRINTER_PROFILES.map((p) => p.id).sort())
  })

  it('찾기 거르기: 서비스 + 모델 이름 꼴 + L-12 앞자리, 글자 그대로 (첫 글자 거르기 없음)', () => {
    const filter = familyScanFilter(defaultPrinterFamilies())
    expect(filter.serviceUuids).toEqual([NIIMBOT_SERVICE])
    expect(filter.namePrefixes).toEqual(['P50_', 'S2_', 'X2_', 'P11_', 'P12_', 'P15_', 'L13_', 'LP90_', 'LP15_', 'PPA2', 'B1-', 'B1_', 'B1_SE-', 'B1_SE_', 'B21-', 'B21_', 'D110-', 'D110_'])
    expect(filter.matchCase).toBe(true)
  })
})

/** 목록이 오면 남기고 조건에 맞는 첫 기기를 고르는 창 */
function pickWhere(match: (d: BleDeviceInfo) => boolean, seen: (readonly BleDeviceInfo[])[] = []): DevicePicker {
  return (scan) =>
    new Promise((resolve) => {
      const stop = scan.onDevices((devices) => {
        seen.push(devices)
        const hit = devices.find(match)
        if (hit !== undefined) {
          stop()
          resolve(hit)
        }
      })
    })
}

describe('앱 한 목록 고르기 — 실험 표시·숨김 없음·바우아토 (AC-PRN2-07, D-PRN2-01·08)', () => {
  it('목록 줄: L-12 실험 기종은 "실험", NIIMBOT 줄은 표시 없음, 이름 없는 NIIMBOT 광고 기기도 보인다, 목록 밖 기기는 없다', () => {
    const fake = createFakeBleTransport()
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: pickWhere(() => false) })
    made.push(picker)
    const entries = picker.entries([
      { id: 'A1', name: 'P50_77', rssi: -50 },
      { id: 'A2', name: 'PPA2L_1234', rssi: -60 },
      { id: 'A3', name: 'B1-G325', rssi: -55 },
      { id: 'A4:00:00:BE:EF', name: null, rssi: -70, serviceUuids: [NIIMBOT_SERVICE.toUpperCase()] },
      { id: 'A5', name: 'AirPods Pro', rssi: -30 },
      { id: 'A6', name: 'M110', rssi: -30, serviceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'] },
    ])
    expect(entries.map((e) => [e.title, e.detail, e.experimental])).toEqual([
      ['P50_77', 'Marklife P50 · 실험 · 신호 강함', true],
      ['B1-G325', 'NIIMBOT · 신호 강함', false],
      ['PPA2L_1234', '바우아토 스티코팝 · 실험 · 신호 강함', true],
      ['이름 없는 프린터 (끝자리 BEEF)', 'NIIMBOT · 신호 보통', false],
    ])
  })

  it('바우아토를 고르면 Luck Jingle 바이트로 찍고 프로필 ID를 알린다 (숨김 스위치 없이 기본 고르기에서)', async () => {
    const manager = createFakeMarklifeManager([{ id: 'BA:01', localName: 'PPA2L_9F3C', printer: { protocol: 'LUCKJINGLE', bundle: 'A' } }])
    const b1 = createFakeBleTransport()
    const transport = combineTransports(b1.transport, createPlxTransport(manager))
    const picker = createPrinterPicker({ transport, pickDevice: pickWhere((d) => d.name === 'PPA2L_9F3C'), marklife: { packetIntervalMs: 0 } })
    made.push(picker)
    expect(picker.profileId).toBeNull()
    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('MARKLIFE')
    expect(picker.profileId).toBe('BAUATO_PPA2L')
    const image = sampleImage(4, 384, 240)
    expect(await picker.print(image, { density: 3 })).toEqual({ ok: true })
    const job = buildPrintJob(BAUATO_PPA2L, image)
    if (!job.ok) throw new Error('바이트 없음')
    expect(Array.from(manager.printed('BA:01')[0] ?? [])).toEqual(Array.from(job.bytes))
  })

  it('NIIMBOT 기기를 고르면 모델로 프로필을 정하고 그 ID를 알린다', async () => {
    const fake = createFakeBleTransport()
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: pickWhere((d) => d.name === 'B1-FAKE01'), client: { packetIntervalMs: 0 } })
    made.push(picker)
    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('NIIMBOT')
    expect(picker.profileId).toBe('NIIMBOT_B1')
    await picker.disconnect()
    expect(picker.profileId).toBeNull()
  })
})

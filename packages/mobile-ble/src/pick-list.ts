// 고르기 목록 정리 (APP-03 프린터 고르기 화면) — 찾은 기기를 판매자가 고르기 쉽게 보인다.
// - 이름 없는 기기는 숨긴다(무엇인지 알 수 없어 고를 수 없다 — 프린터는 이름을 알린다).
// - 신호가 센 기기(가까운 기기)부터. 신호를 모르는 기기는 뒤에, 같은 세기면 찾은 차례.
// - 한 줄 = 기기 이름 + 기종 이름(계열 표) + 신호 낱말. 같은 이름이 둘 이상이면 기기 ID 끝 네 글자로 가린다.
// 어느 기기를 목록에 넣을지(계열 거르기)는 고르기(createPrinterPicker)가 정한다 — 이 파일은 보이는 차례와 낱말만.
import type { BleDeviceInfo } from './transport.ts'

/** 신호 낱말 (가까울수록 셈) */
export type SignalWord = '신호 강함' | '신호 보통' | '신호 약함'

/** 이보다 세면 강함 · 보통 (dBm) */
export const SIGNAL_STRONG_DBM = -65
export const SIGNAL_FAIR_DBM = -80

export interface PickEntry {
  readonly device: BleDeviceInfo
  /** 보일 기기 이름 (같은 이름이 있으면 끝 네 글자가 붙는다) */
  readonly title: string
  /** 기종 이름 (`Marklife P50` · `NIIMBOT`) */
  readonly model: string
  /** 신호를 모르면 null */
  readonly signal: SignalWord | null
  /** 한 줄 설명 (`NIIMBOT · 신호 강함`) */
  readonly detail: string
}

export function signalWord(rssi: number | undefined): SignalWord | null {
  if (rssi === undefined || !Number.isFinite(rssi)) return null
  if (rssi >= SIGNAL_STRONG_DBM) return '신호 강함'
  if (rssi >= SIGNAL_FAIR_DBM) return '신호 보통'
  return '신호 약함'
}

const visibleName = (device: BleDeviceInfo): string | null => {
  const name = device.name?.trim() ?? ''
  return name === '' ? null : name
}

/** 기기 ID 끝 네 글자 (구분 기호 뺌) */
const idTail = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '').slice(-4).toUpperCase()

/** 찾은 기기 → 보일 줄들 (이름 없는 기기 뺌, 신호 센 차례) */
export function pickEntries(devices: readonly BleDeviceInfo[], modelName: (device: BleDeviceInfo) => string): PickEntry[] {
  const named = devices.flatMap((device, order) => {
    const name = visibleName(device)
    return name === null ? [] : [{ device, name, order }]
  })
  const counts = new Map<string, number>()
  for (const item of named) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  const strength = (rssi: number | undefined): number => (rssi === undefined || !Number.isFinite(rssi) ? Number.NEGATIVE_INFINITY : rssi)
  return named
    .sort((a, b) => strength(b.device.rssi) - strength(a.device.rssi) || a.order - b.order)
    .map(({ device, name }) => {
      const model = modelName(device)
      const signal = signalWord(device.rssi)
      const title = (counts.get(name) ?? 0) > 1 ? `${name} (끝자리 ${idTail(device.id)})` : name
      return { device, title, model, signal, detail: signal === null ? model : `${model} · ${signal}` }
    })
}

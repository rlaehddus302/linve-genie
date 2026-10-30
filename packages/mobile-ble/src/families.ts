// 프린터 계열 표 (APP-03, LABEL_RULES L-7 고르기 목록·지원 단계, L-12 3, D-PRN2-01·04·08) — 한 목록 고르기(createPrinterPicker)가 다루는 계열을 데이터로 둔다.
// 계열 하나 = 그 계열의 켠 프로필 + 찾기 거르기 + 이 기기가 내 것인지 + 목록에 보일 기종 이름·실험 표시 + 그 계열의 어댑터 만들기.
// 어느 기기를 목록에 넣고 어느 계열로 보낼지는 @livejjim/printer의 pickListTarget 하나로 정한다 — 웹 고르기 창과 같은 함수·같은 표다(AC-PRN2-04).
//   1. 이름이 L-12 앞자리(글자 그대로)면 그 프로필(Marklife 계열) — NIIMBOT 서비스를 광고해도 그렇다.
//   2. 아니면 NIIMBOT 서비스 광고 또는 켠 NIIMBOT 모델 이름 + `-`·`_` → NIIMBOT 계열(모델은 이은 뒤 모델 정보로).
//   3. 그 밖은 목록에 없다. 이름 첫 글자 거르기(niimbluelib 기본)는 쓰지 않는다.
// 지원 단계(실험)는 프로필마다다 — 앱이 실험 계열을 숨기는 스위치는 없다(D-PRN2-08). 계열을 더하는 일은 이 표에 한 줄을 더하는 것이다.
import {
  LABEL_PROFILES,
  NIIMBOT_PROFILES,
  NIIMBOT_TARGET,
  labelProfilesOf,
  pickListFilter,
  pickListTarget,
  profileForDeviceName,
  type ModelProfile,
  type NiimbotProfile,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { createNativeB1Adapter } from './adapter.ts'
import type { NiimbotBleClientOptions } from './client.ts'
import { createNativeMarklifeAdapter } from './marklife.ts'
import type { DevicePicker } from './pick.ts'
import type { BleDeviceInfo, BleTransport } from './transport.ts'

/** 계열이 기기에 하는 답: 내 것 · 받지 않음(어느 계열로도 보내지 않는다) · 모름(다음 계열에게) */
export type FamilyClaim = 'mine' | 'refuse' | 'pass'

/** 계열 어댑터를 만들 때 고르기가 넘기는 것 */
export interface FamilyContext {
  readonly transport: BleTransport
  readonly pickDevice: DevicePicker
  /** 한 목록에서 이미 고른 기기 (안쪽 어댑터는 고르기 창을 띄우지 않는다) */
  readonly selectDevice: () => Promise<BleDeviceInfo | null>
  readonly timer?: PrinterTimer
  readonly printTimeoutMs?: number
}

export interface PrinterFamily {
  /** 계열 ID (`NIIMBOT` · `MARKLIFE`) — 고르기의 kind */
  readonly id: string
  /** 기종을 모를 때 목록에 보일 이름 */
  readonly label: string
  /** 이 계열의 켠 프로필 (표 순서) */
  readonly profiles: readonly ModelProfile[]
  /** 찾기 거르기 (서비스 UUID 또는 이름 앞자리 — 글자 그대로). 걸린 기기도 claim으로 한 번 더 본다 */
  readonly scan: { readonly serviceUuids: readonly string[]; readonly namePrefixes: readonly string[] }
  /** 이 기기(이름 + 광고 서비스)가 이 계열인지 */
  claim(name: string | null, services?: readonly string[]): FamilyClaim
  /** 목록에 보일 기종 이름 (이름으로 알 수 없으면 계열 이름) */
  modelName(name: string | null): string
  /** 목록 줄에 "실험"을 보일지 — 이름으로 프로필이 정해지는 줄(L-12)만. NIIMBOT 줄은 모델을 이은 뒤에 알아 표시하지 않는다(L-7) */
  isExperimental(name: string | null): boolean
  createAdapter(context: FamilyContext): RememberingPrinterAdapter
}

export interface NiimbotFamilyOptions {
  /** 켤 NIIMBOT 프로필 (기본 NIIMBOT_PROFILES — B1·B1 SE·B21·D110) */
  readonly profiles?: readonly NiimbotProfile[]
  readonly client?: NiimbotBleClientOptions
  /** B1 첫 확인 다시 잇기 전 쉬는 시간 */
  readonly reconnectDelayMs?: number
}

/** NIIMBOT 계열 — NIIMBOT 서비스·모델 이름 꼴로 목록에 넣고, 모델은 이은 뒤 모델 정보로(L-7) */
export function niimbotFamily(options: NiimbotFamilyOptions = {}): PrinterFamily {
  const profiles: readonly NiimbotProfile[] = Object.freeze([...(options.profiles ?? NIIMBOT_PROFILES)])
  // L-12 앞자리가 먼저다(1) — Marklife 계열을 켜지 않아도 Marklife 이름은 NIIMBOT으로 보내지 않는다
  const table: readonly ModelProfile[] = [...profiles, ...LABEL_PROFILES]
  const filter = pickListFilter(profiles)
  return Object.freeze({
    id: 'NIIMBOT',
    label: 'NIIMBOT',
    profiles,
    scan: Object.freeze({ serviceUuids: filter.serviceUuids, namePrefixes: filter.niimbotNamePrefixes }),
    claim: (name: string | null, services: readonly string[] = []): FamilyClaim => (pickListTarget(name, services, table) === NIIMBOT_TARGET ? 'mine' : 'refuse'),
    modelName: () => 'NIIMBOT',
    isExperimental: () => false,
    createAdapter: (context: FamilyContext) =>
      createNativeB1Adapter({
        transport: context.transport,
        pickDevice: context.pickDevice,
        selectDevice: context.selectDevice,
        profiles,
        ...(context.timer === undefined ? {} : { timer: context.timer }),
        ...(context.printTimeoutMs === undefined ? {} : { printTimeoutMs: context.printTimeoutMs }),
        ...(options.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.reconnectDelayMs }),
        ...(options.client === undefined ? {} : { client: options.client }),
      }),
  })
}

export interface MarklifeFamilyOptions {
  /** 켤 L-12 프로필 (기본 LABEL_PROFILES — Marklife 9종 + 바우아토. 실험도 켠 프로필이다, D-PRN2-01) */
  readonly profiles?: readonly ModelProfile[]
  readonly packetIntervalMs?: number
  readonly maxPacketBytes?: number
  readonly creditWaitMs?: number
}

/** Marklife·바우아토 계열 — L-12 3 이름 앞자리(글자 그대로)로 기종을 정한다 */
export function marklifeFamily(options: MarklifeFamilyOptions = {}): PrinterFamily {
  const profiles: readonly ModelProfile[] = Object.freeze([...labelProfilesOf(options.profiles ?? LABEL_PROFILES)])
  const filter = pickListFilter(profiles)
  const ids = new Set(profiles.map((p) => p.id))
  return Object.freeze({
    id: 'MARKLIFE',
    label: 'Marklife',
    profiles,
    scan: Object.freeze({ serviceUuids: Object.freeze([] as string[]), namePrefixes: filter.labelNamePrefixes }),
    claim: (name: string | null, services: readonly string[] = []): FamilyClaim => {
      const target = pickListTarget(name, services, profiles)
      return target !== null && ids.has(target) ? 'mine' : 'pass'
    },
    modelName: (name: string | null) => profileForDeviceName(name, profiles)?.displayName ?? 'Marklife',
    isExperimental: (name: string | null) => profileForDeviceName(name, profiles)?.experimental ?? false,
    createAdapter: (context: FamilyContext) =>
      createNativeMarklifeAdapter({
        transport: context.transport,
        pickDevice: context.pickDevice,
        selectDevice: context.selectDevice,
        profiles,
        ...(context.timer === undefined ? {} : { timer: context.timer }),
        ...(context.printTimeoutMs === undefined ? {} : { printTimeoutMs: context.printTimeoutMs }),
        ...(options.packetIntervalMs === undefined ? {} : { packetIntervalMs: options.packetIntervalMs }),
        ...(options.maxPacketBytes === undefined ? {} : { maxPacketBytes: options.maxPacketBytes }),
        ...(options.creditWaitMs === undefined ? {} : { creditWaitMs: options.creditWaitMs }),
      }),
  })
}

/** 앱 기본 계열 표 — Marklife·바우아토(L-12 앞자리가 먼저) → NIIMBOT. 켠 프로필 표 전부(PRINTER_PROFILES)를 덮는다 */
export function defaultPrinterFamilies(): PrinterFamily[] {
  return [marklifeFamily(), niimbotFamily()]
}

/** 표 순서대로 물어 이 기기의 계열 ID (받지 않거나 아무도 모르면 null — 목록에 없다) */
export function familyOf(name: string | null, families: readonly PrinterFamily[], services: readonly string[] = []): string | null {
  for (const family of families) {
    const answer = family.claim(name, services)
    if (answer === 'mine') return family.id
    if (answer === 'refuse') return null
  }
  return null
}

/** 계열들의 찾기 거르기를 합친다 (같은 값은 한 번, 이름 앞자리는 글자 그대로 — L-7) */
export function familyScanFilter(families: readonly PrinterFamily[]): { serviceUuids: string[]; namePrefixes: string[]; matchCase: true } {
  return {
    serviceUuids: [...new Set(families.flatMap((f) => f.scan.serviceUuids))],
    namePrefixes: [...new Set(families.flatMap((f) => f.scan.namePrefixes))],
    matchCase: true,
  }
}

/**
 * @deprecated PRN2(D-PRN2-08)로 앱의 실험 숨김 스위치가 없어졌다 — 켠 계열을 모두 돌려준다(두 번째 인자는 보지 않는다).
 * 앱은 defaultPrinterFamilies()를 쓴다. 실험 표시는 목록 줄(PickEntry.experimental)과 연결 뒤 프로필의 experimental로 한다
 */
export function enabledFamilies(families: readonly PrinterFamily[], _showExperimental?: boolean): PrinterFamily[] {
  return [...families]
}

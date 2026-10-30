// 프린터 계열 표 (APP-03, LABEL_RULES L-7·L-12 3) — 한 목록 고르기(createPrinterPicker)가 다루는 계열을 데이터로 둔다.
// 계열 하나 = 찾기 거르기(서비스·이름 앞자리) + 이름으로 내 기기인지 + 목록에 보일 기종 이름 + 그 계열의 어댑터 만들기.
// 계열을 더하는 일은 이 표에 한 줄을 더하는 것이다(고르기 코드에 기종 이름으로 갈라지는 곳이 없다).
// 목록에서 고른 기기는 표 순서대로 물어 처음 "내 것"이라 한 계열로 간다. "받지 않음"이면 어느 계열로도 가지 않는다.
// - Marklife(L-12 3 이름 앞자리, 대소문자 가림)를 NIIMBOT보다 먼저 둔다 — Marklife도 NIIMBOT 서비스 UUID를 알리고 이름 첫 글자도 NIIMBOT 거르기에 걸린다.
// - NIIMBOT은 Marklife·바우아토 이름 꼴(대소문자 무시)을 받지 않는다 — 켠 계열에 Marklife가 없어도 B1 목록에 섞이지 않게(이어진 뒤 "다른 프린터"가 없게).
// 계열의 지원 단계(앱에서 보일지)는 `experimental`이다. 앱은 실험 계열을 숨김 스위치를 켰을 때만 넣는다(L-7 "검증 없이 지원 표시하지 않는다").
import {
  MARKLIFE_PROFILES,
  niimbotRequestOptions,
  profileForDeviceName,
  type ModelProfile,
  type PrinterProfile,
  type PrinterTimer,
  type RememberingPrinterAdapter,
} from '@livejjim/printer'
import { createNativeB1Adapter, looksLikeMarklifeName } from './adapter.ts'
import type { NiimbotBleClientOptions } from './client.ts'
import { createNativeMarklifeAdapter, matchesMarklifeName } from './marklife.ts'
import type { DevicePicker } from './pick.ts'
import type { BleDeviceInfo, BleTransport } from './transport.ts'

/** 계열이 기기 이름에 하는 답: 내 것 · 받지 않음(어느 계열로도 보내지 않는다) · 모름(다음 계열에게) */
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
  /** 실기기 확인 전 — 앱은 숨김 스위치를 켰을 때만 넣는다 */
  readonly experimental: boolean
  /** 찾기 거르기 (서비스 UUID 또는 이름 앞자리 — 대소문자 무시로 넓게 찾고 claim이 가린다) */
  readonly scan: { readonly serviceUuids: readonly string[]; readonly namePrefixes: readonly string[] }
  /** 이 이름의 기기가 이 계열인지 */
  claim(name: string | null): FamilyClaim
  /** 목록에 보일 기종 이름 (이름으로 알 수 없으면 계열 이름) */
  modelName(name: string | null): string
  createAdapter(context: FamilyContext): RememberingPrinterAdapter
}

export interface NiimbotFamilyOptions {
  /** 켤 NIIMBOT 프로필 (기본 B1 하나) */
  readonly profiles?: readonly PrinterProfile[]
  readonly client?: NiimbotBleClientOptions
  /** B1 첫 확인 다시 잇기 전 쉬는 시간 */
  readonly reconnectDelayMs?: number
}

/** NIIMBOT 계열 — 이름 첫 글자·NIIMBOT 서비스로 찾고, B1 확인은 이은 뒤 모델 정보로(L-7) */
export function niimbotFamily(options: NiimbotFamilyOptions = {}): PrinterFamily {
  const request = niimbotRequestOptions()
  const scan = {
    serviceUuids: Object.freeze(request.filters.flatMap((f) => ('services' in f ? f.services : []))),
    namePrefixes: Object.freeze(request.filters.flatMap((f) => ('namePrefix' in f ? [f.namePrefix] : []))),
  }
  return Object.freeze({
    id: 'NIIMBOT',
    label: 'NIIMBOT',
    experimental: false,
    scan: Object.freeze(scan),
    claim: (name: string | null): FamilyClaim => (looksLikeMarklifeName(name) ? 'refuse' : 'mine'),
    modelName: () => 'NIIMBOT',
    createAdapter: (context: FamilyContext) =>
      createNativeB1Adapter({
        transport: context.transport,
        pickDevice: context.pickDevice,
        selectDevice: context.selectDevice,
        ...(context.timer === undefined ? {} : { timer: context.timer }),
        ...(context.printTimeoutMs === undefined ? {} : { printTimeoutMs: context.printTimeoutMs }),
        ...(options.reconnectDelayMs === undefined ? {} : { reconnectDelayMs: options.reconnectDelayMs }),
        ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
        ...(options.client === undefined ? {} : { client: options.client }),
      }),
  })
}

export interface MarklifeFamilyOptions {
  /** 켤 Marklife 프로필 (기본 9종 — 바우아토는 일부러 넘길 때만) */
  readonly profiles?: readonly ModelProfile[]
  readonly packetIntervalMs?: number
  readonly maxPacketBytes?: number
  readonly creditWaitMs?: number
}

/** Marklife 계열 — L-12 3 이름 앞자리(대소문자 가림)로 기종을 정한다. 앱에서는 실기기 확인 전이라 실험 계열이다 */
export function marklifeFamily(options: MarklifeFamilyOptions = {}): PrinterFamily {
  const profiles: readonly ModelProfile[] = Object.freeze([...(options.profiles ?? MARKLIFE_PROFILES)])
  return Object.freeze({
    id: 'MARKLIFE',
    label: 'Marklife',
    experimental: true,
    scan: Object.freeze({ serviceUuids: Object.freeze([] as string[]), namePrefixes: Object.freeze(profiles.flatMap((p) => (p.namePrefix ? [p.namePrefix] : []))) }),
    claim: (name: string | null): FamilyClaim => (matchesMarklifeName(name, profiles) ? 'mine' : 'pass'),
    modelName: (name: string | null) => profileForDeviceName(name, profiles)?.displayName ?? 'Marklife',
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

/** 표 순서대로 물어 이 이름의 계열 ID (받지 않거나 아무도 모르면 null) */
export function familyOf(name: string | null, families: readonly PrinterFamily[]): string | null {
  for (const family of families) {
    const answer = family.claim(name)
    if (answer === 'mine') return family.id
    if (answer === 'refuse') return null
  }
  return null
}

/** 계열들의 찾기 거르기를 합친다 (같은 값은 한 번) */
export function familyScanFilter(families: readonly PrinterFamily[]): { serviceUuids: string[]; namePrefixes: string[] } {
  return {
    serviceUuids: [...new Set(families.flatMap((f) => f.scan.serviceUuids))],
    namePrefixes: [...new Set(families.flatMap((f) => f.scan.namePrefixes))],
  }
}

/** 앱이 켤 계열 — 기본은 실험이 아닌 계열만(B1). 숨김 스위치를 켜면 실험 계열도 (표 순서 그대로) */
export function enabledFamilies(families: readonly PrinterFamily[], showExperimental: boolean): PrinterFamily[] {
  return families.filter((f) => showExperimental || !f.experimental)
}

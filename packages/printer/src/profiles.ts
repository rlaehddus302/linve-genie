// 프린터 프로필 표 (LABEL_RULES L-7 켠 프로필·지원 단계·고르기 목록, L-12 1, 프린터 골든 profile·name·list, D-N1-02·03·04·07, D-PRN2-01·04·05·08).
// 켠 프로필 표는 하나다(PRINTER_PROFILES — NIIMBOT 4 + Marklife 9 + 바우아토). 따로 된 "실험 목록"은 없다(D-PRN2-01): 실험 기종도 켠 프로필이고
// 단계는 프로필의 `experimental` 칸이다. 모델 하나를 더하는 일은 이 표에 한 줄을 더하는 것이다 — 바이트(방식)·돌림·농도·이름 앞자리·
// 고르기 목록·크기 목록은 모두 칸(데이터)으로 정하고 모델 이름으로 갈라지는 코드가 없다(AC-PRN2-11).
// 프로토콜 사실의 출처: niimbluelib 0.47.1 모델 표·인쇄 방식 표, MIT 참고 구현 thermal-label/marklife의 공개 문서(코드를 옮기지 않았다 — dev-notes),
// Luck Jingle 검증 문서(DP-L1S 라벨 순서 — D-PRN2-02).
import { TAPE_LABEL_SIZES, isLabelSize, labelSizeName, type LabelSizeId } from '@livejjim/label'
import { B1_PROFILE, isNiimbotProtocol, type DensityRange, type ModelProfile, type NiimbotProfile, type PrinterAdapter } from './adapter.ts'

const deepFreeze = <T extends ModelProfile>(profile: T): T =>
  Object.freeze({ ...profile, sizes: Object.freeze([...profile.sizes]), density: profile.density === null ? null : Object.freeze({ ...profile.density }) })

/** NIIMBOT 50mm 라벨 (B1·B1 SE·B21 — 48mm 헤드) */
const NIIMBOT_50_SIZES: readonly LabelSizeId[] = ['50x30', '50x20', '50x40']
/** YXQ 50mm 라벨 (P50·S2·X2) */
const YXQ_SIZES: readonly LabelSizeId[] = ['50x30', '50x20', '50x40', '50x50']
/** YXQ 농도 1~3 (1 흐리게 · 2 보통 · 3 진하게), 기본 2 */
const YXQ_DENSITY: DensityRange = { min: 1, max: 3, default: 2 }
/** 바우아토 스티코팝 전용 롤 */
const BAUATO_SIZES: readonly LabelSizeId[] = ['50x30', '50x15', '50x50']

const MARKLIFE_APP = 'Marklife 앱'
const NIIMBOT_APP = 'NIIMBOT 앱'

/** NIIMBOT 실험 프로필 한 줄 (niimbluelib 0.47.1 모델 표 그대로 — D-PRN2-05). 이름 앞자리 없음(모델은 연결한 뒤 모델 정보로) */
const niimbot = (row: Omit<NiimbotProfile, 'maker' | 'dpi' | 'labelType' | 'fallbackApp' | 'namePrefix'>): NiimbotProfile =>
  deepFreeze({ ...row, maker: 'NIIMBOT', dpi: 203, labelType: 'WITH_GAPS', fallbackApp: NIIMBOT_APP, namePrefix: null })

/** NIIMBOT B1 SE — 실험. 0.47.1 인쇄 방식 표에 B1_SE가 없어 B1 방식으로 둔다(같은 헤드·dpi — HG-5에서 확인) */
export const NIIMBOT_B1_SE: NiimbotProfile = niimbot({
  id: 'NIIMBOT_B1_SE',
  model: 'B1_SE',
  displayName: 'NIIMBOT B1 SE',
  protocol: 'NIIMBOT_B1',
  printTask: 'B1',
  headDots: 384,
  rotate: 'NONE',
  printDirection: 'top',
  sizes: NIIMBOT_50_SIZES,
  defaultSize: '50x30',
  density: { min: 1, max: 5, default: 3 },
  extraBlankRows: 1,
  experimental: true,
})

/** NIIMBOT B21 — 실험. 인쇄 방식 B21_V1 */
export const NIIMBOT_B21: NiimbotProfile = niimbot({
  id: 'NIIMBOT_B21',
  model: 'B21',
  displayName: 'NIIMBOT B21',
  protocol: 'NIIMBOT_B21_V1',
  printTask: 'B21_V1',
  headDots: 384,
  rotate: 'NONE',
  printDirection: 'top',
  sizes: NIIMBOT_50_SIZES,
  defaultSize: '50x30',
  density: { min: 1, max: 5, default: 3 },
  extraBlankRows: 1,
  experimental: true,
})

/** NIIMBOT D110 — 실험. 96점 헤드, left(시계 방향 90도), 테이프 크기, 농도 1~3(기본 2), 마지막 흰 줄 없음(돌리면 폭이 된다) */
export const NIIMBOT_D110: NiimbotProfile = niimbot({
  id: 'NIIMBOT_D110',
  model: 'D110',
  displayName: 'NIIMBOT D110',
  protocol: 'NIIMBOT_D110',
  printTask: 'D110',
  headDots: 96,
  rotate: 'CW90',
  printDirection: 'left',
  sizes: TAPE_LABEL_SIZES,
  defaultSize: 'tape12x40',
  density: { min: 1, max: 3, default: 2 },
  extraBlankRows: 0,
  experimental: true,
})

/** NIIMBOT 어댑터의 켠 프로필 (L-7 표 순서 — B1 확인됨 + B1 SE·B21·D110 실험) */
export const NIIMBOT_PROFILES: readonly NiimbotProfile[] = Object.freeze([B1_PROFILE, NIIMBOT_B1_SE, NIIMBOT_B21, NIIMBOT_D110])

/** NIIMBOT 어댑터의 기본 켠 프로필 — NIIMBOT_PROFILES와 같다 (PRN2 — 전에는 B1 하나였다, D-PRN2-05) */
export const ENABLED_PROFILES: readonly NiimbotProfile[] = NIIMBOT_PROFILES

const yxq = (model: string, protocol: 'MARKLIFE_YXQ2' | 'MARKLIFE_YXQ3' | 'MARKLIFE_YXQ8'): ModelProfile =>
  deepFreeze({
    id: `MARKLIFE_${model}`,
    maker: 'Marklife',
    displayName: `Marklife ${model}`,
    protocol,
    dpi: 203,
    headDots: 384,
    rotate: 'NONE',
    sizes: YXQ_SIZES,
    defaultSize: '50x30',
    density: YXQ_DENSITY,
    // PRN2 D-PRN2-01·08: 우리 실기기 확인(HG-5) 전이라 실험
    experimental: true,
    fallbackApp: MARKLIFE_APP,
    namePrefix: `${model}_`,
  })

/** L11 테이프 프린터: 96점 헤드, 시계 방향 90도로 돌려 보낸다, 농도 명령 없음 */
const tape = (model: string): ModelProfile =>
  deepFreeze({
    id: `MARKLIFE_${model}`,
    maker: 'Marklife',
    displayName: `Marklife ${model}`,
    protocol: 'MARKLIFE_L11',
    dpi: 203,
    headDots: 96,
    rotate: 'CW90',
    sizes: TAPE_LABEL_SIZES,
    defaultSize: 'tape12x40',
    density: null,
    experimental: true,
    fallbackApp: MARKLIFE_APP,
    namePrefix: `${model}_`,
  })

export const MARKLIFE_P50 = yxq('P50', 'MARKLIFE_YXQ3')
export const MARKLIFE_S2 = yxq('S2', 'MARKLIFE_YXQ2')
export const MARKLIFE_X2 = yxq('X2', 'MARKLIFE_YXQ8')
export const MARKLIFE_P11 = tape('P11')
export const MARKLIFE_P12 = tape('P12')
export const MARKLIFE_P15 = tape('P15')
export const MARKLIFE_L13 = tape('L13')
export const MARKLIFE_LP90 = tape('LP90')
export const MARKLIFE_LP15 = tape('LP15')

/** 바우아토 스티코팝 (실험 — Luck Jingle 방식, D-PRN2-02. 잘 찍히지 않으면 그림 파일을 Luck Jingle 앱으로) */
export const BAUATO_PPA2L: ModelProfile = deepFreeze({
  id: 'BAUATO_PPA2L',
  maker: 'BAUATO',
  displayName: '바우아토 스티코팝',
  protocol: 'LUCKJINGLE',
  dpi: 203,
  headDots: 384,
  rotate: 'NONE',
  sizes: BAUATO_SIZES,
  defaultSize: '50x30',
  density: null,
  experimental: true,
  fallbackApp: 'Luck Jingle 앱',
  namePrefix: 'PPA2',
})

/** Marklife 9종 (L-12 1 표 순서) — 제조사 묶음. 어댑터의 기본 목록은 LABEL_PROFILES(바우아토 포함)다 */
export const MARKLIFE_PROFILES: readonly ModelProfile[] = Object.freeze([
  MARKLIFE_P50,
  MARKLIFE_S2,
  MARKLIFE_X2,
  MARKLIFE_P11,
  MARKLIFE_P12,
  MARKLIFE_P15,
  MARKLIFE_L13,
  MARKLIFE_LP90,
  MARKLIFE_LP15,
])

/** L-12 어댑터(Marklife·바우아토)의 기본 목록 — Marklife 9종(표 순서) + 바우아토 (L-12 1 PRN2 개정, D-PRN2-01) */
export const LABEL_PROFILES: readonly ModelProfile[] = Object.freeze([...MARKLIFE_PROFILES, BAUATO_PPA2L])

/** 켠 프로필 표 전체 — 하나뿐이다 (NIIMBOT 4 + Marklife 9 + 바우아토). 여기에 없는 프린터는 "그림 파일로만"이다 */
export const PRINTER_PROFILES: readonly ModelProfile[] = Object.freeze([...NIIMBOT_PROFILES, ...LABEL_PROFILES])

/** ID로 프로필 찾기 (없으면 undefined) */
export function printerProfile(id: string): ModelProfile | undefined {
  return PRINTER_PROFILES.find((p) => p.id === id)
}

/**
 * 이름으로 고르기 (L-12 3, G-PRT-N1-41~64·76~78, D-N1-11): 기기 이름이 프로필의 이름 앞자리로 시작하면 그 프로필, 아니면 undefined.
 * 보는 것은 앞자리뿐이다 — 대소문자를 가리고 이름을 다듬지 않는다. 앞자리 앞에 무엇이 붙거나(앞 공백) 앞자리 안에 다른 글자가 끼면
 * (전각 글자·폭 없는 공백) 고르지 않고, 앞자리 뒤의 글(끝 공백·길이)은 보지 않는다(`P12_ZA15B ` → P12, 아주 긴 `LP15_…` → LP15).
 * 기기 고르기 창의 namePrefix 거르기와 같은 판단이라 창에 보인 기기가 이름 때문에 거절되지 않는다. 앞자리가 없는 프로필(NIIMBOT)은 고르지 않는다.
 * 앞자리끼리 겹치지 않으므로 맞는 프로필은 많아야 하나다 — 그래도 둘 이상이면 고르지 않는다(지어내지 않는다).
 */
export function profileForDeviceName(name: unknown, profiles: readonly ModelProfile[] = LABEL_PROFILES): ModelProfile | undefined {
  if (typeof name !== 'string' || name === '') return undefined
  const matched = profiles.filter((p) => p.namePrefix !== null && p.namePrefix !== '' && name.startsWith(p.namePrefix))
  return matched.length === 1 ? matched[0] : undefined
}

/** 프로필이 쓰는 라벨 크기 (첫째가 기본) */
export function labelSizesFor(profile: ModelProfile): readonly LabelSizeId[] {
  return profile.sizes
}

// ─── 고르기 목록 (L-7 "고르기 목록", 골든 list G-PRT-PRN2-21~44, D-PRN2-04) — 앱·웹이 같은 함수를 쓴다 ───

/** NIIMBOT 서비스 UUID (niimbluelib 블루투스 클라이언트가 찾는 서비스 — 0.47.1은 내보내지 않는다). 비교는 대소문자를 가리지 않는다 */
export const NIIMBOT_SERVICE_UUID = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'

/** 고르기 목록의 판정: L-12 프로필 ID(그 어댑터로 잇는다) · `NIIMBOT`(NIIMBOT 어댑터 — 모델은 연결한 뒤) · null(목록에 없다) */
export type PickListTarget = string | null

/** NIIMBOT 어댑터로 잇는 판정값 */
export const NIIMBOT_TARGET = 'NIIMBOT'

const isNiimbotRow = (p: ModelProfile): p is NiimbotProfile => isNiimbotProtocol(p.protocol) && typeof (p as Partial<NiimbotProfile>).model === 'string'

/** 이름 앞자리로 고르는 L-12 프로필만 (켠 표에서) */
export const labelProfilesOf = (profiles: readonly ModelProfile[]): readonly ModelProfile[] => profiles.filter((p) => !isNiimbotProtocol(p.protocol) && p.namePrefix !== null && p.namePrefix !== '')

/** 켠 NIIMBOT 프로필만 (켠 표에서) */
export const niimbotProfilesOf = (profiles: readonly ModelProfile[]): readonly NiimbotProfile[] => profiles.filter(isNiimbotRow)

/** 켠 NIIMBOT 프로필의 이름 꼴 — 모델 이름 바로 뒤에 `-` 또는 `_` (글자 그대로 — `B1-`·`B1_`·`D110_`) */
export function niimbotNamePrefixes(profiles: readonly ModelProfile[] = PRINTER_PROFILES): readonly string[] {
  return [...new Set(niimbotProfilesOf(profiles).flatMap((p) => [`${p.model}-`, `${p.model}_`]))]
}

const hasNiimbotService = (services: readonly unknown[]): boolean => services.some((s) => typeof s === 'string' && s.toLowerCase() === NIIMBOT_SERVICE_UUID)

/**
 * 찾은 기기 하나(이름 + 광고 서비스 UUID) → 목록에 넣을지와 어느 어댑터로 잇는지 (L-7 고르기 목록 1~3, 순수 함수).
 * 1. 이름이 L-12 프로필의 이름 앞자리로 시작하면(글자 그대로) 그 프로필 ID — NIIMBOT 서비스를 광고해도 그렇다.
 * 2. 아니면 NIIMBOT 서비스를 광고하거나(대소문자 무시) 이름이 켠 NIIMBOT 모델 이름 + `-`/`_`로 시작하면(글자 그대로) `NIIMBOT`.
 * 3. 그 밖은 null. 이름 첫 글자 거르기(niimbluelib 기본)는 쓰지 않는다.
 * profiles = 켠 프로필 표(기본 전부). 표에 한 줄을 더하면 판정도 따라간다(코드 분기 없음).
 */
export function pickListTarget(name: unknown, services: readonly unknown[] = [], profiles: readonly ModelProfile[] = PRINTER_PROFILES): PickListTarget {
  const label = profileForDeviceName(name, labelProfilesOf(profiles))
  if (label) return label.id
  const niimbots = niimbotProfilesOf(profiles)
  if (niimbots.length === 0) return null
  if (hasNiimbotService(Array.isArray(services) ? services : [])) return NIIMBOT_TARGET
  if (typeof name === 'string' && niimbotNamePrefixes(niimbots).some((prefix) => name.startsWith(prefix))) return NIIMBOT_TARGET
  return null
}

/** 고르기 목록 찾기 거르기 (앱 찾기·웹 고르기 창 공용) — 서비스 · NIIMBOT 이름 꼴 · L-12 앞자리. 걸린 기기도 pickListTarget으로 한 번 더 본다 */
export interface PickListFilter {
  readonly serviceUuids: readonly string[]
  readonly niimbotNamePrefixes: readonly string[]
  readonly labelNamePrefixes: readonly string[]
}

export function pickListFilter(profiles: readonly ModelProfile[] = PRINTER_PROFILES): PickListFilter {
  const niimbots = niimbotProfilesOf(profiles)
  return Object.freeze({
    serviceUuids: Object.freeze(niimbots.length === 0 ? [] : [NIIMBOT_SERVICE_UUID]),
    niimbotNamePrefixes: Object.freeze([...niimbotNamePrefixes(niimbots)]),
    labelNamePrefixes: Object.freeze(labelProfilesOf(profiles).map((p) => p.namePrefix as string)),
  })
}

// ─── server·web이 쓰는 것 (PRN2 — L-1·L-11 10·13, D-PRN2-01·07) ───

/** 지원 단계: 확인됨 · 실험 · 그림 파일로만(프로필 표에 없음) */
export type PrinterSupportStage = 'CONFIRMED' | 'EXPERIMENTAL' | 'IMAGE_ONLY'

/** 프로필 ID의 지원 단계 (표에 없거나 모르면 그림 파일로만) */
export function printerSupportStage(profileId: unknown): PrinterSupportStage {
  const profile = typeof profileId === 'string' ? printerProfile(profileId) : undefined
  if (!profile) return 'IMAGE_ONLY'
  return profile.experimental ? 'EXPERIMENTAL' : 'CONFIRMED'
}

/** 라벨 설정의 크기 목록 — 그 프로필의 크기(첫째가 기본). 프로필을 모르면(없음·표에 없음) B1 목록 (L-1, L-11 13, D-PRN2-07) */
export function labelSizesForProfileId(profileId: unknown): readonly LabelSizeId[] {
  const profile = typeof profileId === 'string' ? printerProfile(profileId) : undefined
  return (profile ?? B1_PROFILE).sizes
}

/** 그 프로필이 이 크기를 찍을 수 있는지 (프로필을 모르면 B1 목록으로 본다) */
export function profileSupportsSize(profileId: unknown, size: string): boolean {
  return (labelSizesForProfileId(profileId) as readonly string[]).includes(size)
}

/**
 * 출력 기기 프로필의 크기 목록에 없는 템플릿 크기로 그릴 때의 멈춤 문장 (L-11 13 — 글자 그대로, LABEL_ERROR).
 * {크기}는 화면 이름(`50×30`·`테이프 12×40`). L-1 목록 밖의 크기면 받은 글 그대로 넣는다
 */
export function sizeNotSupportedMessage(size: string): string {
  const shown = isLabelSize(size) ? labelSizeName(size) : size
  return `이 프린터는 ${shown} 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.`
}

/** 실험 기종 안내 한 줄 (L-7 지원 단계 — 글자 그대로). {앱} = 프로필의 대체 경로 앱 */
export function experimentalNotice(profile: Pick<ModelProfile, 'fallbackApp'>): string {
  return `실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 ${profile.fallbackApp}에서 인쇄해 주세요.`
}

/**
 * 출력 기기가 서버에 알릴 프로필 ID (L-11 10, D-PRN2-07) — 어댑터가 연결돼 있고(연결됨·출력 중) 그 프로필이 켠 표의 한 줄일 때만.
 * 끊겼거나 모르면 null(알리지 않음). 이름·기기 ID는 담지 않는다.
 */
export function connectedProfileId(adapter: Pick<PrinterAdapter, 'state' | 'profile'>): string | null {
  if (adapter.state !== 'CONNECTED' && adapter.state !== 'PRINTING') return null
  const id = (adapter.profile as { readonly id?: unknown }).id
  return typeof id === 'string' && printerProfile(id) !== undefined ? id : null
}

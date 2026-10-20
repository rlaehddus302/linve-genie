// 프린터 프로필 표 (LABEL_RULES L-12 1, 프린터 골든 G-PRT-N1-65~75, D-N1-02·03·04·07).
// 모델 하나를 더하는 일은 이 표에 한 줄을 더하는 것이다. 바이트(방식)·돌림·농도·이름 앞자리는 모두 이 칸으로 정한다.
// 프로토콜 사실의 출처: MIT 참고 구현 thermal-label/marklife의 공개 문서(코드를 옮기지 않았다 — dev-notes).
import { TAPE_LABEL_SIZES, type LabelSizeId } from '@livejjim/label'
import { B1_PROFILE, type DensityRange, type ModelProfile } from './adapter.ts'

const deepFreeze = (profile: ModelProfile): ModelProfile =>
  Object.freeze({ ...profile, sizes: Object.freeze([...profile.sizes]), density: profile.density === null ? null : Object.freeze({ ...profile.density }) })

/** YXQ 50mm 라벨 (P50·S2·X2) */
const YXQ_SIZES: readonly LabelSizeId[] = ['50x30', '50x20', '50x40', '50x50']
/** YXQ 농도 1~3 (1 흐리게 · 2 보통 · 3 진하게), 기본 2 */
const YXQ_DENSITY: DensityRange = { min: 1, max: 3, default: 2 }
/** 바우아토 스티코팝 전용 롤 */
const BAUATO_SIZES: readonly LabelSizeId[] = ['50x30', '50x15', '50x50']

const MARKLIFE_APP = 'Marklife 앱'

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
    experimental: false,
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
    experimental: false,
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

/** 바우아토 스티코팝 (실험적 — L11 계열 추정, HG-5 전까지. 기본 경로는 그림 파일을 Luck Jingle 앱으로) */
export const BAUATO_PPA2L: ModelProfile = deepFreeze({
  id: 'BAUATO_PPA2L',
  maker: 'BAUATO',
  displayName: '바우아토 스티코팝',
  protocol: 'MARKLIFE_L11',
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

/** Marklife 어댑터의 기본 목록 (L-12 1 표 순서) — 바우아토는 없다 */
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

/** 실험 목록 — 부르는 쪽이 일부러 넘길 때만 쓴다 (기본 목록에 없다) */
export const EXPERIMENTAL_PROFILES: readonly ModelProfile[] = Object.freeze([BAUATO_PPA2L])

/** 프로필 표 전체 (B1 + Marklife 9종 + 바우아토) */
export const PRINTER_PROFILES: readonly ModelProfile[] = Object.freeze([B1_PROFILE, ...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES])

/** ID로 프로필 찾기 (없으면 undefined) */
export function printerProfile(id: string): ModelProfile | undefined {
  return PRINTER_PROFILES.find((p) => p.id === id)
}

/**
 * 이름으로 고르기 (L-12 3, G-PRT-N1-41~64·76~78, D-N1-11): 기기 이름이 프로필의 이름 앞자리로 시작하면 그 프로필, 아니면 undefined.
 * 보는 것은 앞자리뿐이다 — 대소문자를 가리고 이름을 다듬지 않는다. 앞자리 앞에 무엇이 붙거나(앞 공백) 앞자리 안에 다른 글자가 끼면
 * (전각 글자·폭 없는 공백) 고르지 않고, 앞자리 뒤의 글(끝 공백·길이)은 보지 않는다(`P12_ZA15B ` → P12, 아주 긴 `LP15_…` → LP15).
 * 기기 고르기 창의 namePrefix 거르기와 같은 판단이라 창에 보인 기기가 이름 때문에 거절되지 않는다. 앞자리가 없는 프로필(B1)은 고르지 않는다.
 * 앞자리끼리 겹치지 않으므로 맞는 프로필은 많아야 하나다 — 그래도 둘 이상이면 고르지 않는다(지어내지 않는다).
 */
export function profileForDeviceName(name: unknown, profiles: readonly ModelProfile[]): ModelProfile | undefined {
  if (typeof name !== 'string' || name === '') return undefined
  const matched = profiles.filter((p) => p.namePrefix !== null && p.namePrefix !== '' && name.startsWith(p.namePrefix))
  return matched.length === 1 ? matched[0] : undefined
}

/** 프로필이 쓰는 라벨 크기 (첫째가 기본) */
export function labelSizesFor(profile: ModelProfile): readonly LabelSizeId[] {
  return profile.sizes
}

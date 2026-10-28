// 기본 품종 사전 (VOC-03, DOMAIN_RULES R-17 5, D-203, V2 D-V2-02). 데이터는 `data/varieties.ko.json` 한 곳에만 있다.
// 판매 이력 사전 다음에 붙는다 — 판매자가 쓰던 표기가 앞선다(buildDictionary·prepareVoiceDictionary).
//
// 출처:
// - 라이브지니 스펙·골든에 나온 이름(SPEC VOC-03·PRD-01 예시, 골든 사전, D-V2-02의 꼭 넣을 이름).
// - 국내 다육식물 유통 이름. dev-device가 일반 지식으로 정리했다(특정 목록을 옮겨 오지 않았다) — 사용자 확인 필요(이름 목록 검토).
//   방송 말과 겹치기 쉬운 짧은 낱말(예: 당인 — '당연'과 자모 하나 차이, 수정·동화 같은 흔한 낱말)은 넣지 않았다.
// - 판매자 제공 판매 영수증 거래명 (D-V3-115, AC-V3-100): 데이터 끝에 이어 붙인 이름들(`황소` 다음부터). 두 번 이상 나온 거래명 후보
//   (이름·횟수만 — 닉네임·사람 이름·시트 이름은 쓰지 않았다)에서 막는 낱말과 같거나 R-17 0.8로 맞는 것, 지금 이름·별칭과 공백 뺀 모양
//   (로마자는 대소문자 무시)이 같은 것, 잎 모양·빛깔·크기 같은 흔한 말 하나뿐인 것(D-V3-95), 화분·크기·도구 같은 일반 낱말, 사람 이름·
//   닉네임일 수 있는 것, 글자가 깨진 것은 뺐다. 별칭 없이 이름으로만, 공백 뺀 2글자 이름은 exactOnly(D-V3-86).
//
// 규칙(단위 시험이 지킨다): 300개 이상, 이름·별칭의 공백 뺀 모양이 서로 겹치지 않음, 공백 뺀 1글자 없음, 별칭 0~5개,
// 막는 낱말(stopWords)과 같거나 R-17 0.8로 맞는 이름·별칭 없음.
import data from '../data/varieties.ko.json' with { type: 'json' }

/** 기본 사전의 이름 하나와 별칭들 (데이터 파일 모양) */
export interface VarietySource {
  readonly name: string
  readonly aliases?: readonly string[]
}

const freezeSource = (item: { name: string; aliases?: string[] }): VarietySource => Object.freeze({ name: item.name, aliases: Object.freeze([...(item.aliases ?? [])]) })

/** 기본 품종(이름·별칭) — 데이터 파일 순서 그대로 */
export const DEFAULT_VARIETIES: readonly VarietySource[] = Object.freeze(data.varieties.map(freezeSource))

/** 기본 사전 이름만 (지금까지의 모양 — 별칭 없음) */
export const DEFAULT_DICTIONARY: readonly string[] = Object.freeze(DEFAULT_VARIETIES.map((item) => item.name))

/**
 * 흔한 말 별칭 (D-V3-54 — `녹음` → 녹금): 흔한 낱말과 같아 사전 별칭으로 늘 맞추면 잡담이 품종이 된다.
 * 'N번' 조각 안에서만 품종으로 맞춘다(segments.ts). 사전(별칭·겹침 검사)에는 넣지 않는다. 들은 말 → 이름
 */
export const DEFAULT_COMMON_ALIASES: ReadonlyMap<string, string> = new Map(
  (data.varieties as { name: string; commonAliases?: string[] }[]).flatMap((item) => (item.commonAliases ?? []).map((heard) => [heard, item.name] as const)),
)

/**
 * 적은 모양으로만 맞추는 이름 (실방송 영수증의 짧은 이름 — 콜리·퍼플·창금·황소): 한 자모 다른 흔한 낱말(콜라·퍼즐·창극·황수)이
 * 비슷함으로 이 이름이 되지 않게 한다. 이름·별칭과 공백만 다른 모양은 그대로 맞는다.
 */
export const DEFAULT_EXACT_ONLY: ReadonlySet<string> = new Set(
  (data.varieties as { name: string; exactOnly?: boolean }[]).filter((item) => item.exactOnly === true).map((item) => item.name),
)

/** 방송 말 막는 낱말 (D-V2-02) — 품종 이름·별칭·배운 별칭이 될 수 없다 */
export const STOP_WORDS: readonly string[] = Object.freeze([...data.stopWords])

// 기본 품종 사전 (VOC-03, DOMAIN_RULES R-17 5, D-203, V2 D-V2-02). 데이터는 `data/varieties.ko.json` 한 곳에만 있다.
// 판매 이력 사전 다음에 붙는다 — 판매자가 쓰던 표기가 앞선다(buildDictionary·prepareVoiceDictionary).
//
// 출처:
// - 라이브지니 스펙·골든에 나온 이름(SPEC VOC-03·PRD-01 예시, 골든 사전, D-V2-02의 꼭 넣을 이름).
// - 국내 다육식물 유통 이름. dev-device가 일반 지식으로 정리했다(특정 목록을 옮겨 오지 않았다) — 사용자 확인 필요(이름 목록 검토).
//   방송 말과 겹치기 쉬운 짧은 낱말(예: 당인 — '당연'과 자모 하나 차이, 수정·동화 같은 흔한 낱말)은 넣지 않았다.
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

/** 방송 말 막는 낱말 (D-V2-02) — 품종 이름·별칭·배운 별칭이 될 수 없다 */
export const STOP_WORDS: readonly string[] = Object.freeze([...data.stopWords])

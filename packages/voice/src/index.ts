// @livejjim/voice — 음성 등록 패키지 (VOC-01~05, DOMAIN_RULES R-17, D-202~D-205).
// 화면·서버와 연결하지 않는다(P2 — 카드 화면·마이크 켜기·서버 중계는 I4). 판매 기능은 이 패키지 없이 돈다(VOC-05).
// src는 브라우저와 Node 둘 다에서 돈다: Node 전용 모듈을 쓰지 않고, 시계·연결은 부르는 쪽이 넘긴다.
export {
  extractVoice,
  tokenize,
  readingForms,
  ENDINGS,
  SENTENCE_MAX_CODE_POINTS,
  type Confidence,
  type ExtractOptions,
  type VoiceExtraction,
} from './extract.ts'
export { buildDictionary, normalizeDictionary, prepareDictionary, VarietyDictionary, type DictionaryEntry } from './dictionary.ts'
export { DEFAULT_DICTIONARY } from './default-dictionary.ts'
export { BIT_PATTERN_MAX, JamoPattern, bitParallelDistance, compact, editDistance, jamoOf, isCandidate, compareSimilarity, type Similarity } from './jamo.ts'

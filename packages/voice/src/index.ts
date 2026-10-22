// @livejjim/voice — 음성 등록 패키지 (VOC-01~05, DOMAIN_RULES R-17, D-202~D-205).
// 화면·서버와 연결하지 않는다(P2 — 카드 화면·마이크 켜기·서버 중계는 I4). 판매 기능은 이 패키지 없이 돈다(VOC-05).
// src는 브라우저와 Node 둘 다에서 돈다: Node 전용 모듈을 쓰지 않고, 시계·연결은 부르는 쪽이 넘긴다.
// I4: 콘솔은 "음성 켜기"를 누를 때 이 입구를 한 곳에서 동적으로 불러온다(D-I4-09, AC-I4-04).
// 정확도 측정(AC-I4-03, D-I4-08)의 순수 함수는 화면 번들에 들어가지 않게 하위 경로 `@livejjim/voice/accuracy`로만 내보낸다.
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
export {
  SMS_MAX_ORDERS,
  SMS_PROBLEMS,
  findSmsMarker,
  readSmsSentence,
  type SmsOrder,
  type SmsProblem,
  type SmsReadOptions,
  type SmsReading,
} from './sms.ts'
export { buildDictionary, normalizeDictionary, prepareDictionary, VarietyDictionary, type DictionaryEntry } from './dictionary.ts'
export { DEFAULT_DICTIONARY } from './default-dictionary.ts'
export { BIT_PATTERN_MAX, JamoPattern, bitParallelDistance, compact, editDistance, jamoOf, isCandidate, compareSimilarity, type Similarity } from './jamo.ts'
export {
  AUTO_CONFIRM_SEC_MAX,
  AUTO_CONFIRM_SEC_MIN,
  DEFAULT_VOICE_SETTINGS,
  checkVoiceSettings,
  resolveVoiceSettings,
  type VoiceSettingKey,
  type VoiceSettings,
  type VoiceSettingsOverride,
  type VoiceSettingsProblem,
} from './settings.ts'
export {
  CARD_STATUS_LABELS,
  MAX_OPEN_CARDS,
  MIN_PRICE,
  addCard,
  checkAutoConfirm,
  closeCard,
  confirmCard,
  createCard,
  describeCard,
  editCard,
  isCardWorthy,
  openCardCount,
  replaceCard,
  touchCard,
  type AutoConfirmContext,
  type CardChanges,
  type CardRegistration,
  type CardStatus,
  type ConfirmContext,
  type ConfirmProblem,
  type ConfirmResult,
  type CreateCardInput,
  type EditProblem,
  type EditResult,
  type SuggestionCard,
} from './card.ts'
export {
  MAX_AUTO_ENDS,
  RESTART_WINDOW_MS,
  SPEECH_ERROR_MESSAGES,
  SPEECH_STATE_LABELS,
  RestartLimiter,
  type SpeechEngine,
  type SpeechEngineKind,
  type SpeechError,
  type SpeechErrorKind,
  type SpeechResult,
  type SpeechState,
} from './speech.ts'
export {
  WebSpeechEngine,
  createWebSpeechEngine,
  type RecognitionConstructor,
  type RecognitionErrorEventLike,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type RecognitionResultLike,
  type WebSpeechOptions,
} from './web-speech.ts'
export {
  CloudSpeechEngine,
  createDeepgramEngine,
  createReturnZeroEngine,
  parseDeepgramMessage,
  parseReturnZeroMessage,
  type CloudSpeechOptions,
  type ProviderParser,
  type RelayConnect,
  type RelayConnection,
  type RelayHandlers,
} from './cloud.ts'

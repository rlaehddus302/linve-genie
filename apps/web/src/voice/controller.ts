// 콘솔의 음성 등록 (VOC-01·04·05, D-I4-03~06·09, AC-I4-10~40).
// - "음성 켜기"를 누를 때 음성 모듈을 불러오고(그 전엔 음성 코드·인식 객체·마이크·이력 조회 없음), 그 기기에서 처음이면 안내 창을 거쳐 Web Speech를 시작한다.
// - 중간 결과는 자막 한 줄, 최종 결과는 "들린 말 기록"(최근 20개)과 카드. 인식 문장은 이 객체(탭 메모리)에만 있다 — 서버·저장소·콘솔 로그로 보내지 않는다.
// - 카드 등록은 콘솔이 넘긴 등록 경로(빠른 입력과 같은 product.register)로만 한다. 한 카드는 등록 경로에 한 번만 넘긴다(목록에서 먼저 뺀다).
// - 자동 확정은 켜진 동안·창이 닫힌 동안만, 기다림이 지난 카드를 모두(하나씩 차례로) 등록한다. 끄면 모든 카드의 자동 확정이 멈춘다.
// 시각은 host.now()(콘솔은 Date.now), 기다림은 브라우저 타이머 — 시험이 시계를 당길 수 있다.
// V2 (VOC-01~04, PRD-06, D-V2-03~10): 최종 결과는 곧바로 카드가 되지 않고 모은다(packages/voice feed/tick) — 조용한 시간(기본 1.8초, 그 기기 설정)이
// 지나면 한 덩어리를 readChunk로 읽고 chooseAction이 고른 일(새 카드·이어 채우기·카드 고침·닫기·고칠까요 카드·버림)을 한다. 판단은 모두 음성 패키지 함수다.
// 말이 들리는 동안 열린 카드의 자동 확정 기다림을 멈추고 끝나면 남은 초부터 다시 센다. 음성 기록은 이 객체(탭 메모리)에만 — 저장·전송·콘솔 출력 없음(D-V2-08).
// 배운 품종 이름(D-V2-10)만 그 기기에 저장한다(host.writeLearned).
// V1 음성 문자찜 (ORD-08 AC9, VOC-01·04, D-V1-03~09, AC-V1-20~28): 문자찜 문장(R-21)은 상품 카드 대신 문자찜 카드가 된다. 손대지 않은 카드는
// 기다림(그 기기 설정, 기본 3초) 뒤 콘솔이 넘긴 쓰기(host.writeSms — 손 입력과 같은 `sms` 이벤트)로 넣는다. 넣은·닫은 카드도 10초 동안은
// 같은 말 막기(D-V1-06)를 위해 들고 있다. 열린 카드 수 규칙은 상품 카드와 함께 센다(addVoiceCard).
import { formatWon, parseAmount, type PriceUnit } from '@livejjim/core'
import { ARCHIVE_KEY, archiveBroadcasts, archiveGaps, readArchive, type ArchiveGap } from './archive-store.ts'
import { isHomeScreenApp } from './standalone.ts'
import type {
  ChunkFields,
  ChunkReading,
  LearnedAlias,
  PhraseChunk,
  PhraseOutput,
  PhraseState,
  RecentRegistration,
  VarietyCandidate,
  VoiceAction,
  VoiceLogAction,
  VoiceLogEntry,
  CardRegistration,
  ExistingHeard,
  ReadyRegistration,
  RegistrationReading,
  SegmentPick,
  SegmentReading,
  StableState,
  HeardPrice,
  WaitingNumber,
  VoiceArchiveChunk,
  InterimCandidate,
  InterimSeen,
  SmsBuyerCandidate,
  SmsCard,
  SmsProductView,
  SmsReadOptions,
  SmsReading,
  SmsVoiceSettings,
  SmsWrite,
  OnDeviceStatus,
  SpeechDiagnostic,
  SpeechEngine,
  SpeechError,
  SpeechGap,
  SpeechResult,
  SpeechState,
  SuggestionCard,
  VarietyDictionary,
  VoiceCard,
  VoiceSettings,
} from '@livejjim/voice'
import { editQuestion } from '../lib/quick.ts'
import {
  decideAutoConfirm,
  decideVoiceEnter,
  enterReady,
  historyNames,
  nextFront,
  nextWake,
  parseSecondsText,
  pushHeard,
  type AutoConfirmDecision,
  type FrontMark,
  type HeardLine,
} from '../lib/voice.ts'
import { REGISTER_UNDO_MS } from '../lib/undo-queue.ts'
import {
  AUTO_FIX_FAILED,
  INSTANT_KEY,
  LOG_ALREADY,
  LOG_ASK,
  LOG_AUTO_FIX,
  LOG_INSTANT,
  LOG_INSTANT_DONE,
  LOG_MERGED,
  LOG_PENDING,
  LOG_TOUCHED,
  LOG_UNDONE,
  droppedZeroNote,
  REASON_NOT_OPEN,
  claimsKeptNote,
  LOG_TAKEN,
  MISSED_PRICE_PROBLEM,
  LOG_INTERIM,
  TAKEN_MARK,
  missedPriceNote,
  RENUMBER_FAILED,
  renumberClaims,
  renumberRevertClaims,
  RENUMBER_CLAIMED,
  renumberDone,
  renumberNotOpen,
  renumberTaken,
  maybeOtherMessage,
  notRecentReadout,
  REASON_BARE_NUMBER,
  REASON_PRICE_ONCE,
  LOG_FIX_CANDIDATE,
  LOG_BARE_OFF_RUN,
  alreadyReadout,
  askMessage,
  fixedMessage,
  fixingMessage,
  otherNumberMessage,
  pickChanges,
  readInstant,
  registeredReadout,
  undoneReadout,
  type InstantChanges,
} from './instant.ts'
import type { VoiceModule } from './load.ts'

export type VoicePhase = 'off' | 'loading' | 'consent' | 'on'
export type FormField = 'no' | 'name' | 'price'
/** instant = V3 바로 등록 (번호·가격이 들린 순간, 카드 없이) */
export type RegisterSource = 'enter' | 'click' | 'auto' | 'instant'

/** 음성 코드를 받지 못했을 때 */
export const VOICE_LOAD_FAILED = '음성 기능을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 켜 주세요.'
/** 판매 이력을 받지 못했을 때 (D-I4-06) */
export const HISTORY_FAILED = '지난 판매 품종을 불러오지 못했어요. 기본 품종 사전으로 알아들어요.'
/** 맨 앞이 된 지 1초 안의 Enter (D-I4-03) */
export const TOO_SOON = '새 카드가 방금 나왔어요. 확인하고 다시 Enter를 눌러 주세요.'
/** 켜진 동안 늘 보이는 안내 (D-I4-04, D-I5-06 — 기기를 가리지 않고 어느 기기에서도 맞는 한 문장) */
export const SENT_NOTICE = '음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.'
/** 폭 768px 미만에서 켜진 동안 늘 보이는 짧은 안내 (D-I5-16 — 전송처·목적은 그대로, 접지 않는다) */
export const SENT_NOTICE_SHORT = '음성은 인식을 위해 구글·애플로 보내져요.'
/** 오류 문장을 줄 목록으로 (D-I5-12 — 문장 표의 \n에서 나눈다. 줄이 하나면 한 줄) */
export function errorLines(message: string): readonly string[] {
  return message.split('\n').filter((line) => line !== '')
}
/** 홈 화면 앱(navigator.standalone === true)에서 켜진 동안·오류로 멈춘 뒤 보이는 한 줄 (D-I5-05 — 막지 않는다) */
export const STANDALONE_NOTICE = '홈 화면 앱에서는 음성이 자주 끊길 수 있어요. 안 되면 사파리에서 열어 주세요.'
/** 끝에서 넘긴 문장 카드의 까닭 줄 (D-I5-02, U-I5-01 — 자동 등록되지 않는 까닭과 할 일) */
export const FLUSHED_CARD_NOTE = '끝까지 못 들었어요. 맞는지 확인하고 "등록"을 눌러 주세요.'
/** 끝에서 넘긴 카드가 새 카드 3장 규칙(D-204)으로 닫혔을 때 (U-I5-01 — 말한 상품이 조용히 사라지지 않게). short = "15번 핑크프릴 15,000원" */
export function flushedClosedNotice(short: string): string {
  return `새 카드에 밀려 끝까지 못 들은 카드(${short})를 닫았어요. 맞는 상품이면 빠른 입력으로 등록해 주세요.`
}

/** 문자찜 쓰기 하나의 결과 (콘솔이 서버 응답을 바꿔 준다) */
export type SmsWriteOutcome =
  /** 기록됨 — 응답 seq와 그 문자찜이 정한 구매자 자신 (D-099, 정하지 못했으면 null) */
  | { readonly kind: 'ok'; readonly seq: number; readonly buyer: string | null }
  /** 409 BUYER_AMBIGUOUS — 기록되지 않았다, 후보 중에서 고른다 (message = 서버 문장: 여러 명·이름이 달라요, D-V1-14) */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly SmsBuyerChoice[]; readonly message?: string }
  /** 409 VOICE_REPEATED — 다른 기기가 방금 같은 말을 넣었다(D-V1-13). 기록되지 않았고 다시 넣지 않는다 — 이유 카드("닫기"만) */
  | { readonly kind: 'repeated'; readonly message: string }
  /** 기록되지 않았다 (연결·거절 등) — 쉬운 한국어 문장 */
  | { readonly kind: 'failed'; readonly message: string }

/** 409 후보 하나 + 그 손님의 활성 찜 번호 (D-V1-14 — 서버 `claims`, 처음 찜한 순서) */
export interface SmsBuyerChoice extends SmsBuyerCandidate {
  readonly claims: readonly number[]
}

/** 고르기 카드 후보의 찜 번호 (카드에는 SmsBuyerCandidate로 들어가 펼쳐 복사된다 — 칸이 없거나 깨졌으면 빈 목록) */
export function candidateClaims(candidate: SmsBuyerCandidate): readonly number[] {
  const claims = (candidate as Partial<SmsBuyerChoice>).claims
  return Array.isArray(claims) ? claims.filter((no): no is number => Number.isSafeInteger(no)) : []
}

/**
 * 후보 버튼 글 (AC-V1-25·D-V1-14): "문자찜(김씨) · 끝자리 1234 · 15번·22번" — 3개 넘으면 앞 3개 + " 외 N개", 없으면 "찜 없음".
 * 이름에 끝자리가 이미 있으면 끝자리를 다시 쓰지 않는다
 */
export function smsCandidateLabel(name: string, phoneLast4: string | null, claims: readonly number[]): string {
  const base = phoneLast4 === null || name.includes(phoneLast4) ? name : `${name} · 끝자리 ${phoneLast4}`
  const shown = claims.slice(0, 3).map((no) => `${String(no)}번`).join('·')
  const more = claims.length > 3 ? ` 외 ${String(claims.length - 3)}개` : ''
  return `${base} · ${claims.length === 0 ? '찜 없음' : shown + more}`
}

/** 늦게 보낸 쪽 카드의 이유 (AC-V1-31, D-V1-13 — 서버 문장이 없을 때) */
export const SMS_VOICE_REPEATED = '같은 말을 다른 기기에서 방금 넣었어요.'
/** 이유 카드 제목 (D-V1-21 — 번호·손님 글을 쓰지 않는다) */
export const SMS_REASON_TITLE = '문자찜 · 넣지 않았어요'
/** "확인 필요" 구매자로 넣은 결과 카드의 안내 한 줄 (D-V1-21) */
export const SMS_UNKNOWN_BUYER_NOTE = '방송 뒤 정산 화면에서 누구인지 확인해 주세요.'
/** 되돌릴 것이 없을 때 음성 문자찜 결과 카드가 열려 있으면 Ctrl+Z가 보이는 알림 (D-V1-22, AC-V1-33) */
export const SMS_UNDO_NOTE = "문자찜은 카드의 '찜 취소하기'로 취소해요."

/** "새 손님으로 넣기" 버튼 (D-V1-14) */
export const SMS_NEW_BUYER = '새 손님으로 넣기'

/** 음성 문자찜 쓰기 하나 — 카드의 쓰기 + "새 손님으로 넣기"면 newBuyer (last4와 함께만, D-V1-14) */
export type VoiceSmsWrite = SmsWrite & { readonly newBuyer?: true }

/** 넣기를 누른 방법: 그대로 · 고른 후보 · 새 손님 */
type SmsChoice = { readonly kind: 'auto' } | { readonly kind: 'buyer'; readonly buyer: string } | { readonly kind: 'new' }

const choiceKey = (choice: SmsChoice): string => (choice.kind === 'buyer' ? `buyer:${choice.buyer}` : choice.kind)

/** 넣은 주문 하나의 결과 줄 */
export interface SmsResultLine {
  readonly no: number
  readonly seq: number
  readonly buyer: string | null
}

/** 문자찜 카드와 화면 상태 */
export interface SmsEntry {
  readonly card: SmsCard
  /** 넣을 수 없는 이유 (R-21 문제·상품 상태·시각) — "닫기"만 */
  readonly reason: string | null
  /** 말한 받은 시각이 지금보다 늦어 묻는다 ("받은 시각이 지금보다 늦어요. 그래도 넣을까요?") */
  readonly timeCheck: boolean
  /** 보내는 중 */
  readonly sending: boolean
  /** 보내지 못한 이유 (다시 "넣기"를 누를 수 있다) */
  readonly error: string | null
  /** 넣은 주문마다의 결과 (주문 차례) */
  readonly results: readonly SmsResultLine[]
  /** 고르기 카드의 문장 (409 서버 문장 — "여러 명이에요"·"이름이 달라요"). 없으면 화면이 기본 문장 */
  readonly choose?: string | null
  /** 결과 카드를 닫았다 (같은 말 검사에는 10초 동안 남는다) */
  readonly hidden: boolean
}

/**
 * 넣지 않은 채 저절로 닫힌 문자찜 카드의 안내 (U-V1-01): 열린 카드 수 규칙(D-204·D-I4-02)이 손대지 않은 문자찜 카드를 닫으면
 * 넣지 않은 주문이 말없이 사라지지 않게 판매자가 "확인"을 누를 때까지 남긴다. 이유 카드("닫기"만)가 닫힐 때는 남기지 않는다.
 */
export interface SmsDropped {
  /** 닫힌 카드 ID */
  readonly id: string
  /** 카드를 가리키는 짧은 글 ("15번 · 28번 · 끝자리 1234 · 문자찜") */
  readonly short: string
  readonly text: string
}

/** 카드를 가리키는 짧은 글: "15번 · 28번 · 끝자리 1234 · 문자찜" (describeSmsCard에서 물음을 뗀 것) */
export function smsShortText(described: string): string {
  return described.replace(/\s*—\s*넣을까요\?$/, '')
}

/** "넣지 않은 문자찜 카드를 닫았어요: 15번 · 28번 · 끝자리 1234 · 문자찜. 넣으려면 …" */
export function smsDroppedText(short: string): string {
  return `넣지 않은 문자찜 카드를 닫았어요: ${short}. 넣으려면 다시 말하거나 문자찜 입력에 넣어 주세요.`
}

/** 문자찜 화면 문장 */
export interface SmsWords {
  readonly labels: VoiceModule['SMS_LABELS']
  readonly listening: string
  readonly repeat: string
  readonly timeCheck: string
  readonly choose: (last4: string | null) => string
}

/** 기다리는 시간 칸의 문제 (V2 화면) */
export const SECONDS_PROBLEM = '자동 확정 기다림은 3초부터 30초까지의 정수로 적어 주세요'

/** 카드의 고치기 칸 */
export interface CardForm {
  readonly no: string
  readonly name: string
  readonly price: string
  readonly focus: FormField
  readonly message: string | null
  /** 칸을 열거나 다시 오류가 날 때마다 바뀐다 (커서를 다시 보낸다) */
  readonly version: number
}

// ── V2: 이어 붙이기·정정·후보·음성 기록 (VOC-01~04, PRD-06, D-V2-03~10) ──

/** 덩어리를 읽은 결과 한 줄을 보이는 시간 (D-V2-07) */
export const READOUT_MS = 4000
/** 번호 없이 들린 가격이 다음 'N번'을 기다리는 시간 (밀리초, 실방송 10:14) */
export const PENDING_PRICE_MS = 15_000
/** 맨 위 큰 칸의 접근 이름 — 화면에 제목은 없다 (D-V2-07·D-V2-21) */
export const HEARD_TITLE = '지금 들리는 말'
/** 큰 칸이 비었을 때 (D-V2-21) */
export const HEARD_EMPTY = '말하면 여기에 보여요'
/** 음성 기록 단추·창 제목 (D-V2-21 — 이름은 이것 하나) */
export const LOG_TITLE = '음성 기록'
/** 음성 칸 아래 접는 칸 (D-V2-21) */
export const EXTRAS_TITLE = '음성 설정과 기록'
/** 모으는 동안 "들은 말" 칸 옆 (D-V2-07) */
export const HEARING_LABEL = '듣는 중…'
/** 말하는 동안 자동 등록을 멈췄을 때 카드에 (D-V2-06) */
export const AUTO_PAUSED_NOTE = '말하는 동안은 기다려요'
/** 품종이 빈 카드 (D-V2-01, 사례 S9·S10) */
export const NAME_CHECK = '품종 확인 필요'
/** 켬에서 번호만 들린 조각 (D-V3-61) */
export const PRICE_MISSING_READOUT = '가격을 못 들었어요'
/** 켬에서 '원' 가격만 들린 조각 (D-V3-61) */
export const NUMBER_MISSING_READOUT = '번호를 못 들었어요'
/** 덩어리 안 취소로 버렸을 때 큰 글자 칸 (D-V2-06 1) */
export const CANCELLED_READOUT = '취소했어요'
/** 조용한 시간 칸 이름 (D-V2-09, AC-V2-16) */
export const QUIET_LABEL = '말이 끝났다고 볼 때까지(초)'
export const QUIET_HELP = '말을 멈춘 뒤 이 시간이 지나면 들은 말을 한 번에 읽어요. 천천히 말하면 늘려 주세요(1.0~4.0초).'
/** 고칠까요 카드로 고친 뒤 (D-V2-06 3) */
export const OFFER_FIXED = '고쳤어요. 10초 안에는 되돌릴 수 있어요.'
/** 되돌리기를 하지 못했을 때 */
export const OFFER_UNDO_FAILED = '되돌릴 시간이 지났어요. 상품 목록에서 고쳐 주세요.'
/** 고치기를 보내지 못했을 때 */
export const OFFER_FIX_FAILED = '고치지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'

/** 카드에 붙인 V2 정보: 품종 창 글(배운 별칭)·후보·안내 */
export interface CardInfo {
  /** 품종 후보 (품종이 빈 카드에서만 보인다) */
  readonly candidates: readonly VarietyCandidate[]
  /** "품종·가격을 말해 주세요" 등, 없으면 null */
  readonly ask: string | null
  /** "15번 가격을 못 들었어요" 카드 — 가격 칸 하나·[등록]·[닫기] (D-V3-67) */
  readonly missed?: true
}

/** "들은 말" 칸 (모으는 글 + 지금 중간 결과) */
export interface HearingView {
  readonly collected: string
  readonly interim: string
}

/** 덩어리를 읽은 결과 한 줄 (4초) */
export interface Readout {
  readonly text: string
  /** 버린 결과 (색을 다르게) */
  readonly discarded: boolean
  readonly until: number
}

/** 고칠까요·되돌릴까요·번호 안내 카드 (D-V2-06 3) */
export interface VoiceOffer {
  readonly id: string
  /**
   * offer = 품종·가격 고칠까요, number = 번호는 상품 목록에서, undo = 등록 되돌릴까요, late = 되돌릴 시간 지남,
   * card = 열린 카드 위 "12,000원을 18,000원으로 고칠까요?" (D-V2-19 — registrationId는 그 카드 ID)
   */
  readonly kind: 'offer' | 'number' | 'undo' | 'late' | 'card'
  readonly registrationId: string
  /** V3: 그 상품 번호 (거절한 번호 D-V3-10에 쓴다) */
  readonly no?: number
  /** V3: 묻기 카드의 까닭 줄 (D-V3-06)·바로 고침의 찜 안내 (D-V3-57), 없으면 없음 */
  readonly note?: string
  /** V3: 다른 화분일 수 있는 같은 번호 (D-V3-59) — [새 가격으로 바꾸기] [아까 것을 다른 번호로] */
  readonly maybeOther?: boolean
  /** V3: 음성 번호 옮기기 (R-24, D-V3-58) — 되돌리기는 to → from */
  readonly renumber?: { readonly from: number; readonly to: number }
  /** V3: 이 고침·옮기기를 일으킨 쓰기의 요청 번호와 들은 말 (되돌리기 기록, R-25) */
  readonly voiceRequestId?: string
  readonly voiceHeard?: string
  /** card: 고칠 칸 (번호 포함) */
  readonly cardChanges?: ChunkFields
  /** card: 고친 뒤 카드에 보일 "고쳤어요: …" */
  readonly cardNote?: string
  readonly cardNameCheck?: boolean
  readonly message: string
  readonly changes: { readonly name?: string; readonly price?: number }
  /** ask = 묻는 중, busy = 보내는 중, fixed = 고침(되돌리기 보임) */
  readonly stage: 'ask' | 'busy' | 'fixed'
  /** 고친 앞 값 (되돌리기) */
  readonly before: { readonly name?: string; readonly price?: number } | null
  /** 되돌리기가 보이는 마지막 시각 */
  readonly undoUntil: number | null
  readonly error: string | null
}

/** 음성 기록 창의 한 줄 (글은 화면이 글자로만 그린다) */
export interface VoiceLogLine {
  readonly key: string
  readonly time: string
  readonly pieces: readonly string[]
  /** 읽은 것 ("15번 · 엘레강스 · 20,000원"), 읽지 않았으면 null */
  readonly read: string | null
  /** 후보 ("선버스트 77점"), 없으면 "" */
  readonly candidates: string
  readonly action: string
  readonly reason: string | null
}

/** 음성으로 한 쓰기에 싣는 기록 한 줄 (R-25, D-V3-65): 가린 들은 말 한 줄, 되돌리기면 되돌린 쓰기의 요청 번호 */
export interface VoiceLogInput {
  readonly heard: string
  readonly source?: 'voice'
  readonly undo?: string
  readonly device?: string
}

/** 음성 고치기·옮기기 쓰기의 덧붙임 */
export interface VoiceWriteOptions {
  readonly newOnly?: boolean
  /** 가격 적용 범위를 정해 창 없이 보낸다 (되돌리기 — 입금 전 찜도 원래 가격, RA-V3-003) */
  readonly applyTo?: 'NEW_ONLY' | 'UNPAID_CLAIMS'
  readonly voiceLog?: VoiceLogInput
  /** 이 쓰기의 요청 번호 (되돌리기에 쓴다) */
  readonly requestId?: string
}

/** 고칠까요 카드의 [고치기] 결과 (콘솔이 상품 고치기를 한다) */
export type RecentFixOutcome =
  | { readonly kind: 'fixed'; readonly before: { readonly name?: string; readonly price?: number } }
  /** 찜이 있어 손 고치기 창(PRD-01 안내)을 열었다 — 고칠까요 카드는 닫는다 */
  | { readonly kind: 'dialog' }
  | { readonly kind: 'failed'; readonly message: string }

export interface VoiceSnapshot {
  readonly phase: VoicePhase
  /** 켜진 동안의 상태 글자 ("음성: 듣는 중"·"음성: 다시 시작 중"), 꺼져 있으면 null */
  readonly stateLabel: string | null
  /** 음성 칸의 오류 문장 (D-205), 없으면 null. 여러 줄이면 \n으로 나뉜다(D-I5-12) */
  readonly error: string | null
  /** error가 "이 기기에서는 음성이 어려워요" 안내다 — 안내 색·"닫기", 빠른 입력 등록이 성공하면 내린다 (D-I5-15) */
  readonly unsupported: boolean
  /** 중간 결과 (자막 한 줄), 없으면 null */
  readonly interim: string | null
  /** 최근 최종 문장 (새 것이 앞, 20개) */
  readonly heard: readonly HeardLine[]
  /** 열린 카드 (새 것이 앞) */
  readonly cards: readonly SuggestionCard[]
  readonly front: FrontMark | null
  /** 고치기 칸이 열린 카드 */
  readonly forms: ReadonlyMap<string, CardForm>
  /** 카드에 붙인 문장 (자동 확정 때 번호가 이미 있음) */
  readonly notes: ReadonlyMap<string, string>
  /** 그 기기의 음성 설정 (음성 모듈을 받기 전엔 null) */
  readonly settings: VoiceSettings | null
  /** "기다리는 시간(초)" 칸 글자 */
  readonly secondsText: string
  /** 기다리는 시간 칸의 문제 (checkVoiceSettings 문장), 없으면 null */
  readonly settingsProblem: string | null
  /** 판매 이력을 받지 못했다 */
  readonly historyFailed: boolean
  /** 1초 안의 Enter를 막았다 ("새 카드가 방금 나왔어요…") */
  readonly tooSoon: boolean
  /** 화면 시각 (남은 초·"Enter 등록" 표시) */
  readonly now: number
  /** 새 카드에 밀려 닫힌 끝에서 넘긴 카드들의 글 (describeCard, 닫힌 차례), 없으면 빈 목록 — 판매자가 안내를 닫을 때까지 쌓여 남는다 (U-I5-01) */
  readonly flushedClosed: readonly string[]
  /** 문자찜 카드 (새 것이 앞) — 닫은 카드·닫은 결과 카드는 같은 말 검사를 위해 10초 동안 남고(hidden·CLOSED) 화면엔 보이지 않는다 */
  readonly sms: readonly SmsEntry[]
  /** 그 기기의 문자찜 설정 (음성 모듈을 받기 전엔 null) */
  readonly smsSettings: SmsVoiceSettings | null
  /** "문자찜 자동으로 넣기까지(초)" 칸 글자 */
  readonly smsSecondsText: string
  /** 그 칸의 문제 (checkSmsSettings 문장), 없으면 null */
  readonly smsSettingsProblem: string | null
  /** 넣지 않은 채 저절로 닫힌 문자찜 카드 안내 (새 것이 앞, "확인"을 누를 때까지 남는다 — U-V1-01) */
  readonly smsDropped: readonly SmsDropped[]
  // ── V2 ──
  /** "들은 말" 칸 (켜진 동안 모으는 글·중간 결과가 있을 때), 없으면 null */
  readonly hearing: HearingView | null
  /** 덩어리를 읽은 결과 한 줄 (4초), 없으면 null */
  readonly readout: Readout | null
  /** 카드 ID → 후보·안내 */
  readonly info: ReadonlyMap<string, CardInfo>
  /** 말하는 동안 멈춘 자동 등록: 카드 ID → 남은 ms */
  readonly paused: ReadonlyMap<string, number>
  /** 고칠까요 카드 (새 것이 앞) */
  readonly offers: readonly VoiceOffer[]
  /** 음성 기록 (새것부터, 탭 메모리에만 — D-V2-08) */
  readonly log: readonly VoiceLogEntry[]
  /** 음성을 한 번이라도 켰다 ([음성 기록 보기]가 보인다) */
  readonly everOn: boolean
  /** 조용한 시간 (ms) */
  readonly quietMs: number
  /** "말이 끝났다고 볼 때까지(초)" 칸 글자 */
  readonly quietText: string
  readonly quietProblem: string | null
  /** 배운 품종 이름 수 */
  readonly learnedCount: number
  // ── V3 ──
  /** 번호와 가격이 들리면 바로 등록 (그 기기 설정, 기본 켬) */
  readonly instant: boolean
  /** 음성 인식 기록 모아 두기 (그 기기 설정, D-V3-56) */
  readonly archive: boolean
  /** 접힌 "가격 못 들은 번호" 수 (R80) */
  readonly missedFolded: number
}

/** 그 방송에 이미 있는 상품 (V3 — 콘솔의 상품 보드에서) */
export interface ExistingView {
  /** 상품 키 (고치기·되돌리기에 쓴다) */
  readonly key: string
  readonly name: string
  readonly price: number
  /** 1등 + 대기 수 */
  readonly claimCount: number
  /** 판매 종료 */
  readonly closed: boolean
  /** 상품 상태 (READY·OPEN·SOLD·HOLD·CLOSED) */
  readonly status?: 'READY' | 'OPEN' | 'SOLD' | 'HOLD' | 'CLOSED'
}

/** 바로 등록을 보낸 뒤 상품 목록에 보이기 전까지 들고 있는 것 (같은 번호를 두 번 보내지 않게) */
interface PendingInstant {
  readonly cardId: string
  readonly name: string
  readonly price: number
  readonly key: string | null
  readonly at: number
  /** 등록이 끝나면 적용할 같은 번호 판단 (D-V3-19) */
  readonly after?: { readonly heard: ExistingHeard; readonly auto: boolean }
  /** 등록이 끝나면 되돌린다 (덩어리 안 취소, D-V3-21) */
  readonly cancel?: boolean
  /** 등록이 끝나면 이 번호로 옮긴다 (등록 직후 "아니 61번", R-24) */
  readonly renumberTo?: number
}

/** 바로 등록 쪽이 한 일 (기록·결과 한 줄) */
interface InstantDone {
  readonly action: VoiceLogAction
  readonly reason: string
  readonly readout: string | null
}

/** 품종 후보에 추측 낱말을 맨 뒤 단추로 더한다 (사전 후보와 겹치면 더하지 않는다, D-V3-37) */
function withGuess(candidates: readonly VarietyCandidate[], v3: RegistrationReading | null): readonly VarietyCandidate[] {
  const guess = v3?.guess ?? null
  if (guess === null || candidates.some((item) => item.name === guess)) return candidates
  return [...candidates, { name: guess, score: 0, heard: guess }]
}

/** 보낸 바로 등록을 들고 있는 시간 */
const PENDING_KEEP_MS = 60_000

/** 지난 실제 범위 하나의 상품 이름 */
export interface PastDay {
  readonly date: string
  readonly names: readonly string[]
}

/** 콘솔이 넘기는 것 */
export interface VoiceHost {
  /** 음성 모듈 (동적 import 한 곳) */
  load(): Promise<VoiceModule>
  now(): number
  /** 그 방송 스냅샷의 claim.maxNumber */
  maxNumber(): number
  /** 지금 범위의 상품 이름 — 자료가 같으면 같은 배열 (사전을 다시 만들지 않게) */
  currentNames(): readonly string[]
  /** 그 방송 판매 규칙의 price.unit ("N번 품종 수" 꼴, D-V3-48) */
  priceUnit?(): PriceUnit
  /** 그 방송에 지금 있는 상품: 번호 → 판매 종료인가 */
  products(): ReadonlyMap<number, boolean>
  /** 지난 실제 범위의 상품 이름 (음성을 켤 때 한 번) */
  fetchHistory(): Promise<readonly PastDay[]>
  /** 창이 열려 있다 */
  dialogOpen(): boolean
  readConsent(): boolean
  writeConsent(): void
  readSettings(): unknown
  writeSettings(settings: VoiceSettings): void
  /** 카드 등록 — 빠른 입력과 같은 등록 경로 */
  register(card: SuggestionCard, registration: CardRegistration, source: RegisterSource): void
  focusQuick(): void
  // ── 음성 문자찜 (V1) — writeSms가 없으면 문자찜 문장은 카드를 만들지 않는다 ──
  /** R-21 읽기 설정: 그 방송의 판매 방식·번호 범위·수량 상한, 옵션 방식이면 상품 목록·지금 상품 */
  smsReadOptions?(): SmsReadOptions
  /** 번호 → 지금 상품 모습 (없는 번호는 null) */
  smsProduct?(no: number): SmsProductView | null
  /** 카드에 보일 상품 이름 (옵션 방식만 — 번호 방식은 null) */
  smsProductName?(no: number): string | null
  /** 말한 받은 시각 `H:MM[:SS]` → 손 입력 문자찜과 같은 읽기(ORD-08 AC6·D-089)로 보낼 값과 지금보다 늦은지. 읽지 못하면 null */
  readSmsTime?(time: string, now: number): { readonly value: string; readonly late: boolean } | null
  /** 문자찜 쓰기 하나 (손 입력과 같은 `sms` 이벤트). received = 보낼 받은 시각(null이면 비움) */
  writeSms?(write: VoiceSmsWrite, received: string | null, requestId: string): Promise<SmsWriteOutcome>
  newRequestId?(): string
  readSmsSettings?(): unknown
  writeSmsSettings?(settings: SmsVoiceSettings): void
  // ── V2 ──
  /** 배운 별칭 (그 기기 저장, D-V2-10) — 읽은 값 그대로(검사는 readLearnedAliases) */
  readLearned?(): unknown
  writeLearned?(list: readonly LearnedAlias[]): void
  /** 고칠까요 카드의 [고치기]·[되돌리기]: 손 고치기와 같은 상품 고치기 (registrationId = noteVoiceRegistered에 넘긴 id) */
  fixRecent?(registrationId: string, changes: { readonly name?: string; readonly price?: number }, options?: VoiceWriteOptions): Promise<RecentFixOutcome>
  /** 상품 번호 바꾸기 (손 고치기와 같은 product.renumber, R-10·D-V3-58). 바꿨으면 true */
  /** 바꿨으면 true, 서버가 찜이 있다고 막았으면 'claimed'(409 VOICE_RENUMBER_CLAIMED) */
  renumber?(from: number, to: number, options?: VoiceWriteOptions): Promise<boolean | 'claimed'>
  /** 이 기기 ID (음성 기록 voiceLog.device — 두 기기 판단 D-V3-76) */
  deviceId?(): string
  /** 그 번호를 마지막으로 음성으로 등록·고친 기기 (서버 음성 기록), 모르면 null (D-V3-76) */
  lastVoiceDevice?(no: number): string | null
  /** 그 방송 자료를 받았나 — 받기 전에는 바로 등록하지 않는다 (RA-V3-006). 없으면 참 */
  ready?(): boolean
  /** 문자찜을 저절로 넣어도 되나 (콘솔 밖은 아니다 — 카드로 남긴다, D-V3-52). 없으면 참 */
  smsAutoAllowed?(): boolean
  /** 음성 인식 기록 한 덩어리를 이 기기에 남긴다 (설정이 켜져 있을 때, D-V3-56) */
  archiveChunk?(chunk: VoiceArchiveChunk): void
  /**
   * 음성 인식 끊김·멈춤 한 줄("인식 끊김 0.8초 (network)" · "인식 멈춤 2.0초 → 다시 켬" · "다시 켠 뒤 시작 0.1초 · 첫 결과 0.9초 (stall)")을
   * 이 기기에 남긴다 (기록 모아 두기가 켜져 있을 때 — 들은 글 없음)
   */
  archiveGap?(gap: ArchiveGap): void
  /** 판매자가 "음성 끄기"를 눌렀다 (켠 방송 ID를 지운다, D-V3-52) */
  voiceOff?(): void
  /** 그 상품을 손으로 고치는 창을 연다 (D-V3-59 [아까 것을 다른 번호로]) */
  openProduct?(registrationId: string): void
  /** 등록 되돌리기 (지금의 5초 되돌리기). 되돌리기를 시작했으면 true */
  undoRecent?(registrationId: string): boolean
  // ── V3 — 이것이 있어야 바로 등록을 한다 (없는 화면은 V2 카드 확인 그대로) ──
  /** 그 방송의 그 번호 상품, 없으면 null */
  existingProduct?(no: number): ExistingView | null
}

/** 컨트롤러가 생기기 전·꺼진 처음 상태 */
export const VOICE_IDLE: VoiceSnapshot = {
  phase: 'off',
  stateLabel: null,
  error: null,
  unsupported: false,
  interim: null,
  heard: [],
  cards: [],
  front: null,
  forms: new Map(),
  notes: new Map(),
  settings: null,
  secondsText: '',
  settingsProblem: null,
  historyFailed: false,
  tooSoon: false,
  now: 0,
  flushedClosed: [],
  sms: [],
  smsSettings: null,
  smsSecondsText: '',
  smsSettingsProblem: null,
  smsDropped: [],
  hearing: null,
  readout: null,
  info: new Map(),
  paused: new Map(),
  offers: [],
  log: [],
  everOn: false,
  quietMs: 1800,
  quietText: '1.8',
  quietProblem: null,
  learnedCount: 0,
  instant: true,
  archive: false,
  missedFolded: 0,
}

/** ms → "1.8" */
export const quietText = (ms: number): string => (ms / 1000).toFixed(1)

/** 할 일 → 기록의 한 일 */
const LOG_ACTION: Readonly<Record<VoiceAction['kind'], VoiceLogAction>> = {
  create: 'create',
  fill: 'fill',
  edit: 'edit',
  confirmEdit: 'offer',
  close: 'close',
  offer: 'offer',
  offerNumber: 'offer',
  offerUndo: 'offer',
  discard: 'discard',
}

/** 창이 열려 미룬 자동 확정을 다시 보는 간격 */
const DEFERRED_POLL_MS = 250
/**
 * "음성: 다시 시작 중"을 적어도 이만큼 보인다 (AC-I4-12). 엔진은 다시 시작하자마자 같은 순간에 듣는 중을 알리므로 그대로 그리면 한 번도 보이지 않는다.
 * 그 사이 최종 결과가 오면(다시 듣고 있다) 바로 "듣는 중"으로 바꾼다.
 */
export const RESTART_LABEL_MS = 1000
/** 탭 메모리에 두는 최근 인식 끊김 수 (V3 실방송 보강) */
export const RECOGNITION_GAPS_KEPT = 50
/** 멈춤 지킴이 시간 저장 키 (같은 음성 설정 저장값 안, 밀리초 — 화면 칸 없음) */
export const STALL_KEY = 'voice.stallMs'
/**
 * 켠 직후 판매 이력(D-I4-06)을 받는 동안 온 최종 문장은 이력을 받을 때까지(켠 때부터 최대 이만큼) 카드 만들기를 미룬다 —
 * 켜자마자 말한 지난 판매 품종도 이력 사전으로 알아듣게. 들린 말 기록에는 바로 남고, 미룬 문장은 온 차례대로 카드가 된다.
 * 받지 못했거나(실패) 이 시간이 지나면 그때의 사전(지금 범위 + 기본 사전)으로 만든다. 끄거나 엔진이 멈추면 바로 만든다.
 */
export const HISTORY_WAIT_MS = 2000

/** 이력을 기다리며 미룬 최종 문장과 그 문장이 온 때의 설정·번호 범위 */
type HeldSentence = {
  readonly text: string
  readonly settings: VoiceSettings
  readonly maxNumber: number
  /** 그 문장이 온 때의 문자찜 설정 (끈 채 말한 문자찜 문장은 카드를 만들지 않는다) */
  readonly smsSettings: SmsVoiceSettings | null
  /** 인식이 끝날 때 넘긴 문장(최종 표시 없이 끝난 중간 결과, D-I5-02) — 그 카드는 자동 확정하지 않는다(문자찜 카드도 저절로 넣지 않는다) */
  readonly flushedAtEnd: boolean
}

/** 이력을 기다리며 미룬 모으기 결과(덩어리·문자찜)와 그때의 설정 (V2 — 문장 대신 덩어리를 미룬다) */
type HeldOutput = {
  readonly out: PhraseOutput
  readonly settings: VoiceSettings
  readonly maxNumber: number
  readonly smsSettings: SmsVoiceSettings | null
}

/** 카드를 만드는 동안의 목록 (한 번에 #set) */
type CardWork = {
  cards: readonly SuggestionCard[]
  sms: readonly SmsEntry[]
  dropped: readonly SmsDropped[]
  log: readonly VoiceLogEntry[]
  notes: ReadonlyMap<string, string>
  info: ReadonlyMap<string, CardInfo>
  offers: readonly VoiceOffer[]
  readout: Readout | null
}

/** 같은 말 막기 시간 (D-V1-06 — 패키지 SMS_REPEAT_WINDOW_MS와 같다): 닫은 카드를 이만큼 들고 있는다 */
const SMS_KEEP_MS = 10_000
/** 화면에 남기는 결과 카드 수 (넘으면 오래된 것부터 닫는다 — 찜은 그대로) */
export const SMS_RESULTS_SHOWN = 5

/** 이유를 붙인 문자찜 카드 ID (넣을 수 없는 상품·시각·VOICE_REPEATED — 같은 말 검사·열린 카드 수 규칙에서 이유 카드로, D-V1-17·D-V1-18) */
const reasonIds = (entries: readonly SmsEntry[]): ReadonlySet<string> => new Set(entries.filter((entry) => entry.reason !== null).map((entry) => entry.card.id))

/** "확인 필요" 구매자로 넣은 카드인가 — 뒤 4자리도 이름도 말하지 않았다(메모 `확인 필요`, D-V1-21) */
export const smsUnknownBuyer = (entry: SmsEntry): boolean => entry.card.status === 'SENT' && entry.card.reading.last4 === null && entry.card.reading.name === null

/** 화면에 보이는 문자찜 카드 (열림·보내는 중·결과) */
export const smsShown = (entry: SmsEntry): boolean => !entry.hidden && entry.card.status !== 'CLOSED'

type HistoryState = { readonly state: 'idle' | 'loading' | 'failed'; readonly past: readonly PastDay[] } | { readonly state: 'done'; readonly past: readonly PastDay[] }

const isOpen = (card: SuggestionCard): boolean => card.status === 'OPEN'

function firstEmpty(card: SuggestionCard): FormField {
  if (card.no === null) return 'no'
  if (card.name === null) return 'name'
  if (card.price === null) return 'price'
  return 'no'
}

/** 보내지 못했을 때 (연결이 끊김 등 — 서버 문장이 없을 때) */
export const SMS_SEND_FAILED = '문자찜을 넣지 못했어요. 인터넷 연결을 확인하고 다시 "넣기"를 눌러 주세요.'

/**
 * 같은 말 검사에 더는 필요 없는 문자찜 카드를 뺀다: 닫은 카드·닫은 결과 카드는 만든 지 10초까지만 (D-V1-06).
 * 결과 카드가 SMS_RESULTS_SHOWN개를 넘으면 오래된 것부터 화면에서 닫는다(찜은 그대로).
 */
export function pruneSms(entries: readonly SmsEntry[], now: number): readonly SmsEntry[] {
  let shown = 0
  let changed = false
  const out: SmsEntry[] = []
  for (const entry of entries) {
    let item = entry
    if (item.card.status === 'SENT' && !item.hidden && !item.sending) {
      shown++
      if (shown > SMS_RESULTS_SHOWN) item = { ...item, hidden: true }
    }
    const gone = (item.hidden || item.card.status === 'CLOSED') && !item.sending && Number.isFinite(now) && now - item.card.createdAt > SMS_KEEP_MS
    if (gone || item !== entry) changed = true
    if (!gone) out.push(item)
  }
  return changed ? out : entries
}

export class VoiceController {
  readonly #host: VoiceHost
  #snapshot: VoiceSnapshot
  readonly #listeners = new Set<() => void>()
  #module: VoiceModule | null = null
  #engine: SpeechEngine | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  /** "다시 시작 중"을 보이는 동안 (끝나면 엔진이 듣는 중이면 "듣는 중"으로) */
  #restartTimer: ReturnType<typeof setTimeout> | null = null
  /** 엔진이 마지막으로 알린 상태가 듣는 중이다 */
  #engineListening = false
  #disposed = false
  #nextCard = 1
  #nextHeard = 1
  #history: HistoryState = { state: 'idle', past: [] }
  /** 이력을 받는 동안 미룬 최종 문장 (온 차례) — 온 때의 설정·번호 범위를 함께 담는다 (TE-N3-004: 미룬 사이 자동 등록을 켜도 끈 채 말한 문장은 자동 등록하지 않는다) */
  #held: HeldOutput[] = []
  /** 지금 모으는 글을 받는 동안 자동 등록이 한 번이라도 꺼져 있었나 — 그러면 그 덩어리 카드는 자동 확정하지 않는다 (AC-I4-31, D-I4-05) */
  #phraseAutoOff = false
  /** #place가 닫은 끝에서 넘긴 카드의 글 — 다음 #set이 스냅샷에 싣는다 */
  #lostFlushed: string[] = []
  #heldTimer: ReturnType<typeof setTimeout> | null = null
  /** 이 시각까지만 이력을 기다린다 (host.now 기준) */
  #historyDeadline = 0
  #dictionary: { readonly names: readonly string[]; readonly past: readonly PastDay[]; readonly learned: readonly LearnedAlias[]; readonly prepared: VarietyDictionary } | null = null
  /** 문자찜 카드 ID → 주문마다의 요청 번호 (다시 보낼 때 같은 번호 — 찜이 둘 생기지 않게) */
  readonly #smsRequests = new Map<string, string[]>()
  /** 카드마다 요청 번호를 만든 때의 넣기 방법 — 같은 방법으로 다시 보내면 같은 요청 번호(서버 멱등), 바뀌면 새 번호 */
  readonly #smsChoices = new Map<string, string>()
  // ── V2 ──
  /** 모으기 상태 (D-V2-03) — 음성 모듈을 받은 뒤 */
  #phrase: PhraseState | null = null
  #phraseTimer: ReturnType<typeof setTimeout> | null = null
  /** 배운 별칭 (그 기기, D-V2-10) */
  #learned: readonly LearnedAlias[] = []
  #learnedLoaded = false
  /** 카드 ID → 품종 창 글 (배운 별칭의 "들은 말") — 카드가 목록에서 빠진 뒤에도 등록 때 쓴다 */
  readonly #windows = new Map<string, string>()
  /** 이 콘솔에서 음성 카드로 등록한 상품 (60초, D-V2-06 3) */
  #recent: RecentRegistration[] = []
  #nextOffer = 1
  // ── V3 ──
  /** 지금 모으는 덩어리에서 이미 바로 등록(또는 처리)한 번호 — 덩어리가 끝나면 비운다 */
  #instantNos = new Map<number, 'register' | 'existing'>()
  /** 지금 덩어리에서 처리한 조각 (`${no}@${start}`, D-V3-46) */
  readonly #pickDone = new Set<string>()
  /** 중간 결과 후보와 보인 시간 (D-V3-71) — 덩어리가 끝나면 비운다 */
  #interimSeen: readonly InterimSeen[] = []
  #interimShown: { readonly candidate: InterimCandidate; readonly text: string } | null = null
  #interimTimer: ReturnType<typeof setTimeout> | null = null
  /** 이 덩어리에서 한 일 (기록 모아 두기, D-V3-56) */
  readonly #chunkActs = new Set<VoiceArchiveChunk['action']>()
  /** 이 덩어리의 중간 결과 글 (기록 모아 두기, D-V3-56) */
  #chunkInterims: readonly string[] = []
  /** 최근 인식 끊김 (탭 메모리, 최근 RECOGNITION_GAPS_KEPT개 — 시간·까닭만) */
  #gaps: readonly SpeechGap[] = []
  /** 기기 안 인식(processLocally) 확인 결과 — 확인만 하고 쓰지 않는다. 확인 전 null */
  #onDevice: OnDeviceStatus | null = null
  /** 최근 인식 진단(멈춤 다시 열기·다시 켠 뒤 첫 결과·늦은 결과) (탭 메모리, 최근 RECOGNITION_GAPS_KEPT개) */
  #diagnostics: readonly SpeechDiagnostic[] = []
  /** 멈춤 지킴이 시간 (그 기기 저장값 voice.stallMs — 화면 칸 없음, 조정용). 엔진을 만들 때 읽는다. null = 기본 */
  #stallMs: number | null = null
  /** 지금 처리 중인 들은 말 (R-25 기록 한 줄 — 가려서 보낸다) */
  #heardNow = ''
  /** 접힌 "가격 못 들은 번호" (R80) */
  #folded: readonly number[] = []
  /** 기다리는 번호 (D-V3-67) — 하나만, 음성을 끄면 버린다 */
  #waiting: WaitingNumber | null = null
  /** 굳은 중간 글 (사용자 결정 — 1초 넘게 그대로인 앞 낱말은 최종처럼, 음성 패키지 stepStable) */
  #stable: StableState | null = null
  #stableTimer: ReturnType<typeof setTimeout> | null = null
  /** 마지막 중간 결과 글 (굳음을 타이머로 다시 볼 때) */
  #lastInterim = ''
  /** 중간 결과에 보인 번호와 시각 (빠진 0 되살리기의 증거, 20초) */
  #interimNos: { readonly no: number; readonly at: number }[] = []
  /** 음성으로 새로 등록한 번호와 시각 (빠진 0 되살리기의 맥락, 10분 · 최근 20개) */
  #contextNos: { readonly no: number; readonly at: number }[] = []
  /** 마지막으로 들린 번호 (가격만 고쳐 말함 — 그 사이 다른 번호가 들렸는지) */
  #lastHeardNo: number | null = null
  /** 이 덩어리에서 빠진 0을 되살린 원래 번호 (36 → 306의 36) */
  readonly #zeroRaw = new Set<number>()
  /** 앞 덩어리들의 말 (앞 상품 번호·가격 뒤 ~ 지금, 60초) — 등록 품종을 맥락으로 고를 때 (음성 패키지 varietyFromContext) */
  #contextTexts: { readonly text: string; readonly at: number; readonly between: boolean }[] = []
  /**
   * 같은 크롬 결과에서 갈린 덩어리 (D-V3-93): 크롬 결과 하나(굳은 글 상태가 처음부터 다시 세기 전까지)마다 차례 번호,
   * 마지막으로 굳어 넘긴 글(어느 결과·시각), 그 결과의 남은 글을 최종으로 받은 것(어느 결과·시각),
   * 바로 앞 덩어리가 그 굳은 앞부분으로 끝난 번호 없는 덩어리였으면 그 맥락 글
   */
  #stableRun = 0
  #confirmMark: { readonly run: number; readonly at: number } | null = null
  #remainderMark: { readonly run: number; readonly at: number } | null = null
  #splitHead: { readonly run: number; readonly seq: number; readonly item: { readonly text: string; readonly at: number; readonly between: boolean } } | null = null
  /** 번호마다 들은 다른 가격 (같은 번호 가격 고침 문턱 — 음성 패키지 gateSamePrice) */
  readonly #priceHeard = new Map<number, readonly HeardPrice[]>()
  /** 덩어리 차례 (조각 이름 — 같은 조각을 다시 읽은 것은 한 번) */
  #chunkSeq = 0
  /** 번호 없이 들린 '원' 가격 (실방송 10:14 — 다음 상품 가격을 번호보다 먼저 말함). 15초 안에 가격 없는 'N번'이 오면 그 번호의 가격 */
  #pendingPrice: { readonly price: number; readonly at: number } | null = null
  /** 차례를 기다리는 큰 글자 칸 안내 (D-V3-61) */
  /** 음성으로 등록·고친 번호와 시각 (D-V3-59 고쳐 말함) */
  /** 번호마다 마지막으로 음성으로 등록·고친 시각 (D-V3-59, TD-V3-005) */
  readonly #voiceTouched = new Map<number, number>()
  /** 음성으로 새로 등록한 번호와 시각 (최근 것이 뒤) — 고쳐 말함을 끊는 것은 다른 번호의 새 등록뿐 */
  #voiceRegistered: { readonly no: number; readonly at: number }[] = []
  readonly #readoutQueue: { readonly text: string; readonly discarded: boolean }[] = []
  /** 판매자가 닫거나 되돌리거나 "그대로 두기"를 누른 번호 — 음성을 끌 때까지 카드만 (D-V3-10) */
  readonly #rejected = new Set<number>()
  /** 창이 열려 미룬 바로 등록 카드 (창이 닫히면 등록, AC-V3-43 a) */
  readonly #dueCards = new Set<string>()
  /** 창이 열려 미룬 중간 후보 (D-V3-71) */
  readonly #dueInterim: { readonly candidate: InterimCandidate; readonly text: string }[] = []
  /** 지금 모으는 덩어리 도중 바로 등록 설정이 꺼진 적이 있다 (D-V2-22와 같은 원칙) */
  #phraseInstantOff = false
  /** 보낸 바로 등록 (번호 → 보낸 값) */
  readonly #pending = new Map<number, PendingInstant>()

  constructor(host: VoiceHost) {
    this.#host = host
    this.#snapshot = { ...VOICE_IDLE, now: host.now() }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): VoiceSnapshot => this.#snapshot

  // ── 켜기·끄기 (D-I4-04) ─────────────────────────────────────────────

  /** "음성 켜기"/"음성 끄기" */
  toggle(): void {
    if (this.#snapshot.phase === 'on' || this.#snapshot.phase === 'loading') this.turnOff()
    else if (this.#snapshot.phase === 'off') void this.turnOn()
  }

  async turnOn(): Promise<void> {
    if (this.#disposed || this.#snapshot.phase !== 'off') return
    this.#set({ phase: 'loading', error: null, unsupported: false })
    let module: VoiceModule
    try {
      module = await this.#host.load()
    } catch {
      if (!this.#disposed && this.#phase() === 'loading') this.#set({ phase: 'off', error: VOICE_LOAD_FAILED })
      return
    }
    if (this.#disposed || this.#phase() !== 'loading') return
    this.#module = module
    if (this.#snapshot.settings === null) {
      const stored = this.#host.readSettings()
      const settings = module.resolveVoiceSettings(stored)
      // 조용한 시간은 같은 저장값의 `voice.quietMs` (범위 밖·모르는 값은 1800, D-V2-09)
      const quietMs = module.resolveQuietMs(stored)
      this.#stallMs = this.#readStall(module, stored)
      this.#set({ settings, secondsText: String(settings['voice.autoConfirmSec']), quietMs, quietText: quietText(quietMs), quietProblem: null, instant: readInstant(stored), archive: readArchive(stored) })
    }
    if (this.#phrase === null) this.#phrase = module.createPhraseState({ quietMs: this.#snapshot.quietMs })
    if (!this.#learnedLoaded) {
      this.#learnedLoaded = true
      let stored: unknown
      try {
        stored = this.#host.readLearned?.() ?? null
      } catch {
        stored = null
      }
      this.#learned = module.readLearnedAliases(stored)
      this.#set({ learnedCount: this.#learned.length })
    }
    if (this.#snapshot.smsSettings === null) {
      // 못 읽거나 깨진 값은 기본(듣기 켬·3초) — resolveSmsSettings가 고른다
      const smsSettings = module.resolveSmsSettings(this.#host.readSmsSettings?.() ?? null)
      this.#set({ smsSettings, smsSecondsText: String(smsSettings['voice.smsAutoSec']) })
    }
    const engine = this.#ensureEngine(module)
    // 지원하지 않는 브라우저는 안내 창을 띄우기 전에 알린다 (AC-I4-12)
    if (!engine.isSupported()) {
      this.#set({ phase: 'off', error: module.SPEECH_ERROR_MESSAGES.UNSUPPORTED, unsupported: true })
      return
    }
    if (!this.#host.readConsent()) {
      this.#set({ phase: 'consent' })
      return
    }
    this.#start()
  }

  /** 안내 창의 "음성 켜기": 그 기기에 확인을 남기고 시작한다 */
  acceptConsent(): void {
    if (this.#disposed || this.#snapshot.phase !== 'consent') return
    this.#host.writeConsent()
    this.#start()
  }

  /** 안내 창의 "닫기"·Esc: 꺼진 그대로 */
  declineConsent(): void {
    if (this.#snapshot.phase !== 'consent') return
    this.#set({ phase: 'off' })
    this.#host.focusQuick()
  }

  /** "음성 끄기": 인식을 멈추고 모든 카드의 자동 확정을 멈춘다(카드는 남는다) */
  turnOff(): void {
    const phase = this.#snapshot.phase
    if (phase === 'consent') {
      this.declineConsent()
      return
    }
    if (phase === 'off') return
    this.#host.voiceOff?.()
    this.#becomeOff()
    this.#engine?.stop()
    this.#host.focusQuick()
  }

  /** 콘솔을 떠날 때: 인식을 멈추고 기다림을 모두 버린다 */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#clearPhraseTimer()
    this.#releaseRestart()
    this.#dropHeld()
    if (this.#interimTimer !== null) clearTimeout(this.#interimTimer)
    this.#clearStable()
    this.#engine?.stop()
    this.#listeners.clear()
  }

  /** 지금 단계 (await 뒤에 다시 읽는다) */
  #phase(): VoicePhase {
    return this.#snapshot.phase
  }

  #ensureEngine(module: VoiceModule): SpeechEngine {
    if (this.#engine !== null) return this.#engine
    // 홈 화면 앱은 저절로 끝난 것을 모두 센다 — 권한 창이 끝없이 뜨지 않게 1분에 6번째면 멈춘다 (D-I5-18, UA 아님)
    // 멈춤 지킴이 시간: 그 기기 저장값 voice.stallMs (없으면 기본 2초, 1초보다 짧게는 안 됨)
    this.#stallMs = this.#readStall(module, this.#host.readSettings())
    const engine = module.createWebSpeechEngine({ now: () => this.#host.now(), countAllEnds: isHomeScreenApp(), ...(this.#stallMs === null ? {} : { stallMs: this.#stallMs }) })
    engine.onResult((result) => this.#onResult(result))
    engine.onError((error) => this.#onError(error))
    engine.onState((state) => this.#onState(state))
    // 인식 끊김 재기 (V3 실방송 보강) — 앞 판 음성 모듈에는 없을 수 있다
    if (typeof engine.onGap === 'function') engine.onGap((gap) => this.#onGap(module, gap))
    if (typeof engine.onDiagnostic === 'function') engine.onDiagnostic((diagnostic) => this.#onDiagnostic(module, diagnostic))
    // 기기 안 인식은 확인만 한다(엔진을 바꾸지 않는다) — 인식 객체·마이크를 열지 않는 정적 확인
    if (typeof engine.onDeviceStatus === 'function') {
      void engine.onDeviceStatus().then(
        (status) => {
          this.#onDevice = status
        },
        () => {
          this.#onDevice = 'unsupported'
        },
      )
    }
    this.#engine = engine
    return engine
  }

  /** 인식이 끊겼다 다시 들었다: 탭 메모리에 두고, 기록 모아 두기가 켜져 있으면 한 줄 남긴다 */
  #onGap(module: VoiceModule, gap: SpeechGap): void {
    if (this.#disposed) return
    this.#gaps = [...this.#gaps.slice(-(RECOGNITION_GAPS_KEPT - 1)), gap]
    if (this.#snapshot.phase !== 'on' || !this.#snapshot.archive || this.#host.archiveGap === undefined) return
    try {
      const text = typeof module.formatSpeechGap === 'function' ? module.formatSpeechGap(gap) : `인식 끊김 ${(Math.round(gap.ms / 100) / 10).toFixed(1)}초 (${gap.reason})`
      this.#host.archiveGap({ at: gap.to, ms: gap.ms, reason: gap.reason, text })
    } catch {
      // 남기지 못하면 이번 줄은 없다
    }
  }

  /** 저장값의 멈춤 지킴이 시간 (숫자가 없으면 null = 엔진 기본) */
  #readStall(module: VoiceModule, stored: unknown): number | null {
    const raw = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>)[STALL_KEY] : undefined
    return typeof raw === 'number' && Number.isSafeInteger(raw) && typeof module.readStallMs === 'function' ? module.readStallMs(raw) : null
  }

  /** 멈춤 다시 열기·다시 켠 뒤 첫 결과·늦은 결과: 탭 메모리에 두고, 기록 모아 두기가 켜져 있으면 한 줄 남긴다 */
  #onDiagnostic(module: VoiceModule, diagnostic: SpeechDiagnostic): void {
    if (this.#disposed) return
    this.#diagnostics = [...this.#diagnostics.slice(-(RECOGNITION_GAPS_KEPT - 1)), diagnostic]
    if (this.#snapshot.phase !== 'on' || !this.#snapshot.archive || this.#host.archiveGap === undefined || typeof module.formatSpeechDiagnostic !== 'function') return
    try {
      const reason = diagnostic.kind === 'stall' ? 'stall' : diagnostic.kind
      this.#host.archiveGap({ at: diagnostic.at, ms: diagnostic.ms, reason, text: module.formatSpeechDiagnostic(diagnostic) })
    } catch {
      // 남기지 못하면 이번 줄은 없다
    }
  }

  /** 최근 인식 진단 (오래된 것부터) — 시간·까닭만 */
  recognitionDiagnostics(): readonly SpeechDiagnostic[] {
    return this.#diagnostics
  }

  /** 최근 인식 끊김 (오래된 것부터) — 시간·까닭만 */
  recognitionGaps(): readonly SpeechGap[] {
    return this.#gaps
  }

  /** 기기 안 인식 확인 결과 (확인 전·음성을 켜기 전 null). 확인만 하고 쓰지 않는다 */
  onDeviceRecognition(): OnDeviceStatus | null {
    return this.#onDevice
  }

  #start(): void {
    const engine = this.#engine
    if (engine === null) return
    this.#releaseRestart()
    this.#set({ phase: 'on', error: null, unsupported: false, interim: null, stateLabel: this.#label('LISTENING'), everOn: true })
    engine.start()
    if (this.#phase() === 'on') this.#loadHistory()
    // 누른 버튼("음성 켜기")이 사라졌다 — 말하고 바로 Enter를 칠 수 있게 빠른 입력칸으로
    this.#host.focusQuick()
  }

  #becomeOff(): void {
    this.#releaseRestart()
    // 모으던 글은 덩어리로 읽는다 — 그 카드는 자동 확정하지 않는다 (D-V2-03 e)
    const module0 = this.#module
    this.#clearPhraseTimer()
    if (module0 !== null && this.#phrase !== null && this.#snapshot.phase === 'on') {
      const step = module0.stopPhrase(this.#phrase, this.#host.now())
      this.#phrase = step.state
      this.#queueOutputs(module0, step.out)
    }
    // 이력을 기다리며 미룬 문장도 카드로 (끈 뒤라 자동 확정은 아래에서 멈춘다)
    this.#flushHeld()
    this.#clearPhraseTimer()
    const cards = this.#snapshot.cards.map((card) => (card.autoConfirmAt === null ? card : { ...card, autoConfirmAt: null }))
    // 기다리던 문자찜 카드는 남고 저절로 넣지 않는다 — 누르면 넣는다 (AC-V1-22, D-V1-05)
    const module = this.#module
    const sms = module === null ? this.#snapshot.sms : this.#snapshot.sms.map((entry) => (entry.card.autoAt === null ? entry : { ...entry, card: module.stopSmsAuto(entry.card) }))
    // 거절한 번호는 음성을 끌 때까지 (D-V3-10)
    this.#rejected.clear()
    this.#instantNos = new Map()
    this.#pickDone.clear()
    this.#waiting = null
    this.#folded = []
    this.#interimSeen = []
    this.#interimShown = null
    if (this.#interimTimer !== null) clearTimeout(this.#interimTimer)
    this.#interimTimer = null
    this.#clearStable()
    this.#interimNos = []
    this.#lastHeardNo = null
    this.#contextTexts = []
    this.#confirmMark = null
    this.#remainderMark = null
    this.#splitHead = null
    this.#pendingPrice = null
    this.#dueCards.clear()
    this.#dueInterim.length = 0
    this.#phraseInstantOff = false
    this.#set({ phase: 'off', stateLabel: null, interim: null, tooSoon: false, cards, sms, hearing: null, paused: new Map() })
  }

  #label(state: SpeechState): string {
    const word = this.#module?.SPEECH_STATE_LABELS[state] ?? ''
    return `음성: ${word}`
  }

  #onState(state: SpeechState): void {
    this.#engineListening = state === 'LISTENING'
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    if (state === 'RESTARTING') {
      this.#holdRestart()
      this.#set({ stateLabel: this.#label('RESTARTING') })
    } else if (state === 'LISTENING') {
      // "다시 시작 중"을 보이는 동안이면 그 시간이 지난 뒤에 바꾼다
      if (this.#restartTimer === null) this.#set({ stateLabel: this.#label('LISTENING') })
    } else this.#becomeOff()
  }

  /** "다시 시작 중"을 RESTART_LABEL_MS 동안 둔다 (다시 끊기면 그때부터 다시 잰다) */
  #holdRestart(): void {
    this.#releaseRestart()
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      if (!this.#disposed && this.#snapshot.phase === 'on' && this.#engineListening) this.#set({ stateLabel: this.#label('LISTENING') })
    }, RESTART_LABEL_MS)
  }

  #releaseRestart(): void {
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer)
    this.#restartTimer = null
  }

  /** 최종 결과가 왔다 — "다시 시작 중"을 보이는 중이고 엔진이 듣는 중이면 바로 "듣는 중"으로 (그릴 것 없으면 빈 조각) */
  #listeningAgain(): Partial<VoiceSnapshot> {
    if (this.#restartTimer === null || !this.#engineListening) return {}
    this.#releaseRestart()
    return { stateLabel: this.#label('LISTENING') }
  }

  #onError(error: SpeechError): void {
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    this.#set({ error: error.message, unsupported: error.kind === 'UNSUPPORTED' })
  }

  #onResult(result: SpeechResult): void {
    if (this.#disposed || this.#snapshot.phase !== 'on') return
    const module = this.#module
    const settings = this.#snapshot.settings
    if (settings !== null && !settings['voice.autoConfirm']) this.#phraseAutoOff = true
    // 덩어리 도중 한 번이라도 바로 등록이 꺼져 있었으면 그 덩어리는 카드만·같은 번호는 묻기 (D-V3-35)
    if (!this.#snapshot.instant) this.#phraseInstantOff = true
    if (!result.final) {
      // 중간 결과도 조용한 시간을 다시 센다 (D-V2-03, 사례 S17) — 말하는 동안 자동 등록을 멈춘다 (D-V2-06)
      if (module !== null && settings !== null && this.#phrase !== null) {
        this.#noteInterimNumbers(module, result.text)
        this.#interimResult(module, result.text, false)
        return
      }
      this.#set({ interim: result.text })
      return
    }
    // 굳어서 이미 넘긴 앞 낱말은 떼고 남은 글만 최종으로 (사용자 결정 — 넘긴 글로 한 등록은 되돌리지 않는다)
    // 굳은 글로 앞부분을 먼저 넘긴 결과의 남은 글이면 그 결과 차례를 적는다 (D-V3-93)
    const splitRun = this.#stable !== null && this.#stable.taken > 0 ? this.#stableRun : null
    const finalText = module === null ? result.text : this.#finishStable(module, result.text)
    this.#remainderMark = splitRun !== null && finalText.trim() !== '' ? { run: splitRun, at: this.#host.now() } : null
    const heard = finalText === '' ? this.#snapshot.heard : pushHeard(this.#snapshot.heard, { id: this.#nextHeard++, text: finalText })
    const label = this.#listeningAgain()
    if (module === null || settings === null || this.#phrase === null) {
      this.#set({ ...label, interim: null, heard })
      return
    }
    // 최종 결과는 곧바로 카드로 만들지 않고 모은다 (D-V2-03) — 조용한 시간이 지나면 한 덩어리로 읽는다
    const step = module.feed(this.#phrase, { text: finalText, final: true, at: this.#host.now(), flushedAtEnd: result.flushedAtEnd === true })
    this.#phrase = step.state
    const work = this.#startWork(module)
    this.#runOutputs(work, module, step.out)
    this.#tryInstant(work, module)
    this.#set({ ...label, interim: null, heard, ...this.#finishWork(work, module) })
  }

  /**
   * 중간 결과 하나 (또는 타이머로 같은 글을 다시 봄): 1초 넘게 그대로인 앞 낱말은 최종처럼 먼저 넘기고(#confirmed), 남은 글만 중간 결과로.
   * fromTimer면 새로 굳은 것이 없을 때 아무것도 하지 않는다(조용한 시간을 늘리지 않게)
   */
  #interimResult(module: VoiceModule, text: string, fromTimer: boolean): void {
    if (this.#phrase === null) return
    this.#lastInterim = text
    let rest = text
    if (typeof module.stepStable === 'function') {
      let stable: ReturnType<VoiceModule['stepStable']> | null
      const before = this.#stable
      try {
        stable = module.stepStable(this.#stable, text, this.#host.now())
      } catch {
        stable = null
      }
      if (stable !== null) {
        // 새 크롬 결과 (처음이거나 첫 낱말부터 달라짐 — 굳은 글 상태가 처음부터 센다)
        if (before === null || before.tokens.length === 0 || before.tokens[0] !== stable.state.tokens[0] || stable.state.taken < before.taken) this.#stableRun++
        this.#stable = stable.state
        this.#armStable(stable.nextAt)
        if (stable.confirm !== null) this.#confirmed(module, stable.confirm)
        else if (fromTimer) return
        rest = stable.interim
      }
    }
    if (this.#phrase === null) return
    const step = module.feed(this.#phrase, { text: rest, final: false, at: this.#host.now() })
    this.#phrase = step.state
    const work = this.#startWork(module)
    this.#runOutputs(work, module, step.out)
    this.#tryInstant(work, module)
    if (!fromTimer && this.#snapshot.archive && this.#chunkInterims.length < 50) this.#chunkInterims = [...this.#chunkInterims, text]
    this.#set({ interim: rest === '' ? null : rest, ...this.#finishWork(work, module) })
  }

  /** 굳은 앞 낱말을 최종 결과처럼 (같은 모으기·조각 읽기·기다리는 번호·가격 고침) */
  #confirmed(module: VoiceModule, text: string): void {
    if (this.#phrase === null || text.trim() === '') return
    const heard = pushHeard(this.#snapshot.heard, { id: this.#nextHeard++, text })
    this.#confirmMark = { run: this.#stableRun, at: this.#host.now() }
    const step = module.feed(this.#phrase, { text, final: true, at: this.#host.now() })
    this.#phrase = step.state
    const work = this.#startWork(module)
    this.#runOutputs(work, module, step.out)
    this.#tryInstant(work, module)
    this.#set({ heard, ...this.#finishWork(work, module) })
  }

  /** 최종 결과: 넘긴 앞 낱말 수만큼 뗀 글 (굳은 글 상태는 처음으로) */
  #finishStable(module: VoiceModule, text: string): string {
    const stable = this.#stable
    this.#clearStable()
    if (stable === null || typeof module.finishStable !== 'function') return text
    try {
      return module.finishStable(stable, text).text
    } catch {
      return text
    }
  }

  #armStable(at: number | null): void {
    if (this.#stableTimer !== null) clearTimeout(this.#stableTimer)
    this.#stableTimer = null
    if (at === null || this.#disposed) return
    this.#stableTimer = setTimeout(() => {
      this.#stableTimer = null
      const module = this.#module
      if (this.#disposed || module === null || this.#snapshot.phase !== 'on' || this.#lastInterim === '' || this.#stable === null) return
      this.#interimResult(module, this.#lastInterim, true)
    }, Math.max(0, at - this.#host.now()))
  }

  #clearStable(): void {
    if (this.#stableTimer !== null) clearTimeout(this.#stableTimer)
    this.#stableTimer = null
    this.#stable = null
    this.#lastInterim = ''
  }

  /** 중간 결과에 보인 번호를 적는다 (20초) — 크롬이 최종에서 "306번"을 "36번"으로 바꿔 적는 일 */
  #noteInterimNumbers(module: VoiceModule, text: string): void {
    const now = this.#host.now()
    const rr = this.#readRegistration(module, text, false)
    const fresh = this.#interimNos.filter((item) => now - item.at <= 20_000)
    const nos = rr === null ? [] : rr.heardNumbers.filter((no) => !fresh.some((item) => item.no === no))
    this.#interimNos = [...fresh, ...nos.map((no) => ({ no, at: now }))].slice(-20)
  }

  /** 빠진 0 되살리기 (음성 패키지 fixDroppedZero): 두 자리 XY를 앞 번호 맥락으로 X0Y로. 거절한 번호로는 바꾸지 않는다 */
  #droppedZero(module: VoiceModule, pick: SegmentPick): number | null {
    if (typeof module.fixDroppedZero !== 'function') return null
    const now = this.#host.now()
    try {
      const fix = module.fixDroppedZero({
        no: pick.no,
        price: pick.price,
        recent: this.#contextNos.filter((item) => now - item.at <= 600_000).map((item) => item.no),
        heardBefore: [...this.#interimNos.filter((item) => now - item.at <= 20_000).map((item) => item.no), ...(this.#waiting === null ? [] : [this.#waiting.no])],
        maxNumber: this.#host.maxNumber(),
        product: (no) => {
          const found = this.#existingOf(no)
          return found === null ? null : found === 'closed' ? 'closed' : { price: found.price }
        },
      })
      return fix === null || this.#rejected.has(fix.no) ? null : fix.no
    } catch {
      return null
    }
  }

  /**
   * 번호 없이 가격만 고쳐 말함 (음성 패키지 priceOnlyFix, 실방송 "309번 … 55만 원" 뒤 "50만 원"): 마지막 음성 등록 30초 안·그 뒤 다른 번호 없음·원 가격 하나면
   * 그 상품을 같은 번호 규칙으로 — 찜 0이면 바로 고침(되돌리기), 찜이 있으면 묻기. key로 한 번만
   */
  #priceOnly(work: CardWork, module: VoiceModule, rest: string, key: string): InstantDone | null {
    if (typeof module.priceOnlyFix !== 'function' || rest.trim() === '' || this.#pickDone.has(key)) return null
    const rr = this.#readRegistration(module, rest, true)
    if (rr === null) return null
    const last = this.#voiceRegistered.at(-1) ?? null
    const found = last === null ? null : this.#existingOf(last.no)
    const existing = found === null || found === 'closed' ? null : found
    let fix: ReturnType<VoiceModule['priceOnlyFix']>
    try {
      fix = module.priceOnlyFix({
        wonPrices: rr.wonPrices,
        heardNumbers: rr.heardNumbers,
        // 정정 낱말이 있어야 고침 (실방송 10:14 — 번호 앞에 다음 상품 가격을 말한다)
        correction: typeof module.hasPriceCorrection === 'function' && module.hasPriceCorrection(rest),
        lastRegistered: last,
        lastHeardNo: this.#lastHeardNo,
        waiting: this.#waiting !== null,
        product: existing === null ? null : { price: existing.price, claimCount: existing.claimCount },
        now: this.#host.now(),
      })
    } catch {
      fix = null
    }
    if (fix === null || existing === null) return null
    this.#pickDone.add(key)
    const auto = fix.auto && !this.#rejected.has(fix.no) && !this.#phraseInstantOff && this.#snapshot.instant
    const heard: ExistingHeard = { name: null, price: fix.price, nameNeedsCheck: false, priceSure: true, numberFrom: 'marker' }
    this.#heardNow = rest
    let done: InstantDone
    if (existing.pending === true) {
      this.#setPending(fix.no, { after: { heard, auto } })
      done = { action: 'discard', reason: LOG_PENDING, readout: null }
    } else done = this.#applyExisting(work, module, fix.no, existing, heard, auto, false)
    const now = this.#host.now()
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: [{ text: rest }], read: { no: fix.no, name: null, price: fix.price, candidates: [] }, action: done.action, reason: done.reason }))
    if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: now + READOUT_MS }
    return done
  }

  /** 조각 읽기에서 마지막 조각 뒤 남은 글(조각이 없으면 글 전체)을 가격만 고쳐 말함으로 본다 — 남은 글의 첫 토큰 위치로 한 번만 */
  #priceOnlyRest(work: CardWork, module: VoiceModule, seg: SegmentReading, whole: string): InstantDone | null {
    const rest = seg.picks.length === 0 ? whole : seg.rest
    if (rest.trim() === '') return null
    const start = seg.picks.length === 0 ? 0 : (seg.picks.at(-1)?.end ?? -1) + 1
    return this.#priceOnly(work, module, rest, `price@${String(start)}`)
  }

  /**
   * 정정 낱말이 든 "N번 … 원 가격" (음성 패키지 readMarkerCorrection, TD-V3-013): "65번 아니 5만 원"·"65번 다시 5만 원"은 조각 읽기가 고르지 않아(정정 낱말)
   * 아무 일 없이 사라졌다. 이미 있는 상품이면 그 번호 가격 고침으로 같은 번호 규칙(R-22 + 정정 낱말이라 문턱 통과, D-V3-83 (가))에 넘긴다 — 없는 번호는 새로 등록하지 않는다.
   * 마지막 조각 뒤 남은 글(조각이 없으면 글 전체)로, 그 첫 토큰 위치로 한 번만
   */
  #markerCorrection(work: CardWork, module: VoiceModule, seg: SegmentReading, whole: string): InstantDone | null {
    if (typeof module.readMarkerCorrection !== 'function') return null
    const rest = seg.picks.length === 0 ? whole : seg.rest
    const start = seg.picks.length === 0 ? 0 : (seg.picks.at(-1)?.end ?? -1) + 1
    const key = `mark@${String(start)}`
    if (rest.trim() === '') return null
    // 이미 이 글로 고쳤다(최종 결과가 왔을 때) — 덩어리 끝에 다른 길(옛 판단)로 또 고치지 않게 처리한 것으로 돌려준다
    if (this.#pickDone.has(key)) return { action: 'discard', reason: LOG_INSTANT_DONE, readout: null }
    let read: ReturnType<VoiceModule['readMarkerCorrection']>
    try {
      read = module.readMarkerCorrection(rest, { maxNumber: this.#host.maxNumber() })
    } catch {
      read = null
    }
    if (read === null) return null
    const found = this.#existingOf(read.no)
    if (found === null || found === 'closed') return null
    this.#pickDone.add(key)
    this.#lastHeardNo = read.no
    if (!this.#instantNos.has(read.no)) this.#instantNos.set(read.no, 'existing')
    const auto = !this.#rejected.has(read.no) && !this.#phraseInstantOff && this.#snapshot.instant
    const heard: ExistingHeard = { name: null, price: read.price, nameNeedsCheck: false, priceSure: true, numberFrom: 'marker' }
    this.#heardNow = read.text
    let done: InstantDone
    if (found.pending === true) {
      this.#setPending(read.no, { after: { heard, auto } })
      done = { action: 'discard', reason: LOG_PENDING, readout: null }
    } else done = this.#applyExisting(work, module, read.no, found, heard, auto, false, { fragment: `${String(this.#chunkSeq)}:${key}`, correction: true })
    const now = this.#host.now()
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: [{ text: read.text }], read: { no: read.no, name: null, price: read.price, candidates: [] }, action: done.action, reason: done.reason }))
    if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: now + READOUT_MS }
    return done
  }

  /** 앞 덩어리 말로 품종 고르기 (이름만 — 사전 이름만, 애매하면 그대로) */
  #contextName(module: VoiceModule, name: string | null, texts: readonly { readonly text: string; readonly at: number; readonly between: boolean }[] = this.#contextTexts): string | null {
    if (typeof module.varietyFromContext !== 'function') return name
    const now = this.#host.now()
    const fresh = texts.filter((item) => now - item.at <= 60_000)
    if (fresh.length === 0) return name
    const context = fresh.filter((item) => !item.between).map((item) => item.text)
    const between = fresh.filter((item) => item.between).map((item) => item.text)
    try {
      return module.varietyFromContext({ name, context, between, dictionary: this.#prepared(module) })
    } catch {
      return name
    }
  }

  /**
   * 덩어리가 끝났을 때 맥락 말을 고친다: 등록한 덩어리는 마지막 조각 뒤 말만(앞 상품 말일 수 있어 약하게),
   * 번호만 들린 덩어리는 그 글 하나(기다리는 번호의 말 — 따로 든 이름), 번호 없는 덩어리는 따로 든 이름으로 더함
   */
  #noteContext(module: VoiceModule, chunk: PhraseChunk, picked: boolean, otherNumber: boolean, now: number): void {
    const text = chunk.text
    const fresh = this.#contextTexts.filter((item) => now - item.at <= 60_000)
    const head = this.#splitHead
    this.#splitHead = null
    if (picked) {
      const rest = this.#readSegments(module, text, true)?.rest ?? ''
      this.#contextTexts = rest.trim() === '' ? [] : [{ text: rest, at: now, between: false }]
    } else if (otherNumber) {
      // 같은 크롬 결과에서 갈린 덩어리 (D-V3-93): 이 덩어리가 그 결과의 남은 글 하나이고 바로 앞 덩어리가 그 굳은 앞부분으로 끝난 번호 없는 덩어리면 함께 남긴다
      const only = chunk.pieces.length === 1 ? chunk.pieces[0] : undefined
      const mark = this.#remainderMark
      const keep = head !== null && only !== undefined && mark !== null && mark.at === only.at && mark.run === head.run && head.seq === this.#chunkSeq - 1 ? head.item : null
      this.#contextTexts = [...(keep === null ? [] : [keep]), { text, at: now, between: true }]
    } else {
      const rr = this.#readRegistration(module, text, true)
      const between = rr !== null && rr.heardNumbers.length === 0
      const item = { text, at: now, between }
      this.#contextTexts = [...fresh, item].slice(-10)
      // 굳어 넘긴 앞부분으로 끝난 번호 없는 덩어리 — 다음 덩어리가 그 결과의 남은 글이면 쓴다
      const last = chunk.pieces.at(-1)
      const mark = this.#confirmMark
      if (between && last !== undefined && mark !== null && mark.at === last.at) this.#splitHead = { run: mark.run, seq: this.#chunkSeq, item }
    }
  }

  /** 품종만 들린 덩어리를 방금 음성 등록한 상품의 빈 품종 채우기로 (음성 패키지 nameOnlyFill) — 덩어리 끝에만 */
  #nameOnly(work: CardWork, module: VoiceModule, text: string, key: string): InstantDone | null {
    if (typeof module.nameOnlyFill !== 'function' || typeof module.varietiesIn !== 'function' || text.trim() === '' || this.#pickDone.has(key)) return null
    const rr = this.#readRegistration(module, text, true)
    if (rr === null) return null
    const last = this.#voiceRegistered.at(-1) ?? null
    const found = last === null ? null : this.#existingOf(last.no)
    const existing = found === null || found === 'closed' ? null : found
    let fill: ReturnType<VoiceModule['nameOnlyFill']>
    try {
      fill = module.nameOnlyFill({
        names: module.varietiesIn(text, { dictionary: this.#prepared(module) }),
        heardNumbers: rr.heardNumbers,
        wonPrices: rr.heardPrices,
        lastRegistered: last,
        lastHeardNo: this.#lastHeardNo,
        product: existing === null ? null : { name: existing.name },
        now: this.#host.now(),
      })
    } catch {
      fill = null
    }
    if (fill === null || existing === null || existing.pending === true) return null
    this.#pickDone.add(key)
    this.#heardNow = text
    const heard: ExistingHeard = { name: fill.name, price: null, nameNeedsCheck: false, priceSure: true, numberFrom: 'marker' }
    const done = this.#applyExisting(work, module, fill.no, existing, heard, !this.#rejected.has(fill.no) && this.#snapshot.instant, false, { gate: false })
    const now = this.#host.now()
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: [{ text }], read: { no: fill.no, name: fill.name, price: null, candidates: [] }, action: done.action, reason: done.reason }))
    if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: now + READOUT_MS }
    return done
  }

  /** '번' 없는 수가 최근 음성 등록 번호 흐름 밖인가 (음성 패키지 bareNumberFits) */
  #bareOffRun(module: VoiceModule, no: number): boolean {
    if (typeof module.bareNumberFits !== 'function') return false
    const now = this.#host.now()
    try {
      return !module.bareNumberFits(no, this.#contextNos.filter((item) => now - item.at <= 600_000).map((item) => item.no))
    } catch {
      return false
    }
  }

  /** 같은 번호 가격 고침 문턱 한 걸음 — 바로 고쳐도 되면 참. 지금 가격이 다시 들리면 후보를 지운다 */
  #priceGate(module: VoiceModule, no: number, current: number, price: number, fragment: string, said = false): boolean {
    if (typeof module.gateSamePrice !== 'function') return true
    try {
      const correction = said || (typeof module.hasPriceCorrection === 'function' && module.hasPriceCorrection(this.#heardNow))
      const step = module.gateSamePrice({ current, price, fragment, correction, history: this.#priceHeard.get(no) ?? [], now: this.#host.now() })
      if (step.history.length === 0) this.#priceHeard.delete(no)
      else this.#priceHeard.set(no, step.history)
      return step.apply || price === current
    } catch {
      return true
    }
  }

  #clearPhraseTimer(): void {
    if (this.#phraseTimer !== null) clearTimeout(this.#phraseTimer)
    this.#phraseTimer = null
  }

  /** 다음 tick 시각에 타이머 (모은 글·중간 결과가 없으면 없음) */
  #armPhrase(module: VoiceModule): void {
    this.#clearPhraseTimer()
    if (this.#disposed || this.#phrase === null || this.#snapshot.phase !== 'on') return
    const at = module.nextTickAt(this.#phrase)
    if (at === null) return
    this.#phraseTimer = setTimeout(() => {
      this.#phraseTimer = null
      this.#onPhraseTick()
    }, Math.max(0, at - this.#host.now()))
  }

  #onPhraseTick(): void {
    const module = this.#module
    if (this.#disposed || module === null || this.#phrase === null || this.#snapshot.phase !== 'on') return
    const step = module.tick(this.#phrase, this.#host.now())
    this.#phrase = step.state
    const work = this.#startWork(module)
    this.#runOutputs(work, module, step.out)
    this.#set(this.#finishWork(work, module))
  }

  /** 지금 목록으로 시작하는 작업 (이력을 기다리며 미룬 것이 끝났으면 먼저 그것부터) */
  #startWork(module: VoiceModule): CardWork {
    if (this.#held.length > 0 && !this.#waitingHistory()) return this.#heldCards(module)
    return this.#emptyWork()
  }

  #emptyWork(): CardWork {
    const s = this.#snapshot
    return { cards: s.cards, sms: s.sms, dropped: s.smsDropped, log: s.log, notes: s.notes, info: s.info, offers: s.offers, readout: s.readout }
  }

  /** 모으기 결과를 실행한다 (이력을 기다리는 동안은 미룬다 — 그때의 설정·번호 범위와 함께) */
  #runOutputs(work: CardWork, module: VoiceModule, outs: readonly PhraseOutput[]): void {
    if (outs.length === 0) return
    const settings = this.#snapshot.settings
    if (settings === null) return
    // 모으는 동안 자동 등록이 꺼진 적이 있으면 끈 설정으로 (켠 뒤에 덩어리가 끝나도 자동 확정하지 않는다)
    // V3: 카드의 자동 확정 기다림은 없다 — 바로 등록이 대신한다 (D-V3-01, AC-V3-26)
    const used: VoiceSettings = this.#phraseAutoOff || this.#instantHost() ? { ...settings, 'voice.autoConfirm': false } : settings
    if (this.#phrase === null || module.nextTickAt(this.#phrase) === null) this.#phraseAutoOff = false
    const held = outs.map((out): HeldOutput => ({ out, settings: used, maxNumber: this.#host.maxNumber(), smsSettings: this.#snapshot.smsSettings }))
    if (this.#waitingHistory()) {
      this.#held.push(...held)
      this.#armHeld()
      return
    }
    for (const item of held) this.#runOutput(work, module, item)
  }

  /** 끄기 등 작업 밖에서 생긴 결과: 바로 실행하고 목록을 바꾼다 */
  #queueOutputs(module: VoiceModule, outs: readonly PhraseOutput[]): void {
    if (outs.length === 0) return
    const work = this.#startWork(module)
    this.#runOutputs(work, module, outs)
    const patch = this.#workPatch(work)
    if (Object.keys(patch).length > 0) this.#set(patch)
  }

  /** 작업을 마친 조각: 바뀐 목록 + 자동 등록 멈춤/다시 세기 + "들은 말" 칸, 다음 tick 타이머 */
  #finishWork(work: CardWork, module: VoiceModule): Partial<VoiceSnapshot> {
    const pause = this.#syncPause(work, module)
    const phrase = this.#phrase
    const view = phrase === null ? null : module.heardText(phrase)
    const hearing = view === null || (view.collected === '' && view.interim === '') ? null : { collected: view.collected, interim: view.interim }
    this.#armPhrase(module)
    return { ...this.#workPatch(work), ...pause, hearing }
  }

  /**
   * 말이 들리는 동안(모은 글·중간 결과) 열린 카드의 자동 확정 기다림을 멈추고, 끝나면 남은 초부터 다시 센다 (D-V2-06, AC-V2-24).
   * 덩어리 처리로 고친(손댄) 카드는 다시 세지 않는다(resumeAutoConfirm).
   */
  #syncPause(work: CardWork, module: VoiceModule): Partial<VoiceSnapshot> {
    const hearing = this.#phrase !== null && module.isHearing(this.#phrase)
    const now = this.#host.now()
    const before = this.#snapshot.paused
    const paused = new Map([...before].filter(([id]) => work.cards.some((card) => card.id === id && isOpen(card))))
    let cards = work.cards
    if (hearing) {
      cards = cards.map((card) => {
        // 기다림이 이미 끝난 카드(타이머가 늦었을 뿐)는 멈추지 않는다 — 곧 등록된다
        if (!isOpen(card) || card.autoConfirmAt === null || card.autoConfirmAt <= now) return card
        const step = module.pauseAutoConfirm(card, now)
        if (step.remainingMs !== null) paused.set(card.id, step.remainingMs)
        return step.card
      })
    } else if (paused.size > 0) {
      cards = cards.map((card) => {
        const left = paused.get(card.id)
        return left === undefined ? card : module.resumeAutoConfirm(card, left, now)
      })
      paused.clear()
    }
    const changedCards = cards.some((card, index) => card !== work.cards[index])
    if (changedCards) work.cards = cards
    const samePaused = paused.size === before.size && [...paused].every(([id, ms]) => before.get(id) === ms)
    return { ...(changedCards ? { cards } : {}), ...(samePaused ? {} : { paused }) }
  }

  /** 미룬 결과 하나 실행 */
  #runOutput(work: CardWork, module: VoiceModule, held: HeldOutput): void {
    const { out } = held
    if (out.kind === 'sms') {
      const sentence: HeldSentence = { text: out.sms.text, settings: held.settings, maxNumber: held.maxNumber, smsSettings: held.smsSettings, flushedAtEnd: out.sms.flushedAtEnd }
      this.#addSentence(work, module, sentence)
      work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [{ text: out.sms.text, flushedAtEnd: out.sms.flushedAtEnd }], action: 'sms' }))
      return
    }
    const before = work.log
    this.#runChunk(work, module, out.chunk, held)
    this.#archive(module, out.chunk, before === work.log ? null : (work.log[0] ?? null))
    this.#chunkInterims = []
    this.#chunkActs.clear()
  }

  /** 덩어리 하나를 기록 모아 두기에 (설정 켬일 때만, D-V3-56) */
  #archive(module: VoiceModule, chunk: PhraseChunk, entry: VoiceLogEntry | null): void {
    if (!this.#snapshot.archive || this.#host.archiveChunk === undefined || typeof module.createArchiveChunk !== 'function') return
    const reason = entry?.reason ?? null
    const acts = this.#chunkActs
    const action: VoiceArchiveChunk['action'] = acts.has('REGISTERED')
      ? 'REGISTERED'
      : acts.has('FIXED')
        ? 'FIXED'
        : acts.has('ASKED')
          ? 'ASKED'
          : acts.has('IGNORED')
            ? 'IGNORED'
            : entry === null
        ? 'DROPPED'
        : entry.action === 'create'
          ? 'REGISTERED'
          : entry.action === 'edit' || entry.action === 'fill'
            ? 'FIXED'
            : entry.action === 'offer'
              ? 'ASKED'
              : reason === LOG_ALREADY
                ? 'IGNORED'
                : 'DROPPED'
    try {
      const read = entry?.read ?? null
      this.#host.archiveChunk(
        module.createArchiveChunk({ at: this.#host.now(), text: chunk.text, interims: this.#chunkInterims, reading: read === null ? null : { no: read.no, price: read.price, name: read.name }, action, reason }),
      )
    } catch {
      // 남기지 못하면 이번 덩어리는 없다
    }
  }

  /** "음성 인식 기록 모아 두기" 켬/끔 (D-V3-56) */
  setArchive(on: boolean): void {
    const settings = this.#snapshot.settings
    if (settings === null) return
    this.#set({ archive: on })
    this.#writeSettings(settings)
  }

  /** 내려받기 JSON (broadcastId가 있으면 그 방송만) — 음성 모듈이 없으면 null */
  async exportArchive(broadcastId?: string): Promise<unknown> {
    const module = this.#module
    if (module === null || typeof module.createArchiveExport !== 'function') return null
    const broadcasts = await archiveBroadcasts(broadcastId)
    const out = module.createArchiveExport(broadcasts, this.#host.now())
    // 인식 끊김 줄은 방송마다 gaps로 붙인다 (덩어리 형식은 그대로) — 끊김만 있는 방송은 덩어리 없이
    const gaps = await archiveGaps(broadcastId, this.#host.now())
    if (gaps.size === 0) return out
    const listed = out.broadcasts.map((item) => ({ ...item, gaps: gaps.get(item.broadcastId)?.gaps ?? [] }))
    const known = new Set(out.broadcasts.map((item) => item.broadcastId))
    const only = [...gaps].filter(([id]) => !known.has(id)).map(([id, group]) => ({ broadcastId: id, title: group.title, date: group.date, chunks: [], gaps: group.gaps }))
    return { ...out, broadcasts: [...listed, ...only] }
  }

  /** 덩어리 하나: 읽기(readChunk) → 할 일 고르기(chooseAction) → 실행, 기록·결과 한 줄 (D-V2-04~08) */
  #runChunk(work: CardWork, module: VoiceModule, chunk: PhraseChunk, held: HeldOutput): void {
    const now = this.#host.now()
    this.#heardNow = chunk.text
    const reading = module.readChunk(chunk.text, { dictionary: this.#prepared(module), maxNumber: held.maxNumber })
    const tooLong = [...chunk.text].length > module.PHRASE_MAX_CODE_POINTS
    this.#pruneRecent(now)
    // 설정을 꺼도 V3 읽기(추측 품종·같은 번호 무시·합치기·번호 검사)는 하고 바로 등록·바로 고침만 하지 않는다 (R30, TE-V3-005)
    const v3 = this.#instantHost() ? this.#readRegistration(module, chunk.text, true) : null
    // 같은 덩어리의 V3 읽기를 넘겨 번호 둘·가격 뒤 '번' 없는 번호를 버리게 한다 (D-V3-41)
    const registration = v3
    // 바로 등록 켬이면 '원' 가격 없는 결과·덩어리 사이 이어 채우기를 할 일 고르기가 버린다 (D-V3-44)
    const autoRegister = v3 !== null && this.#snapshot.instant
    let action = module.chooseAction(reading, { cards: work.cards, recent: this.#recent, now, chunkStartedAt: chunk.startedAt, tooLong, registration, autoRegister })
    let reason: string | null = action.kind === 'discard' ? action.reason : null
    const info = new Map(work.info)
    const notes = new Map(work.notes)
    const candidatesFor = (name: string | null): readonly VarietyCandidate[] => (name === null ? reading.candidates : [])
    // V3 바로 등록 (D-V3-01·05·08·10·13·19·21): 덩어리 끝에 바로 등록한 번호·이미 있는 번호·합치기·확정 읽기를 먼저 본다
    const noAuto = chunk.noAutoConfirm === true || this.#phraseInstantOff || !this.#snapshot.instant
    // 켬이면 조각 읽기로 덩어리를 앞에서부터 소비한다 (D-V3-46) — 조각이 없으면 옛 판단
    const dialogNow = this.#host.dialogOpen()
    // 창이 열린 동안 끝난 덩어리: 1초 넘게 보였던 중간 후보는 창이 닫히면 등록 (D-V3-71·AC-V3-43 a)
    if (v3 !== null && !noAuto && dialogNow) this.#deferInterim(module, chunk.text)
    const segmentsDone = v3 !== null && !noAuto && !dialogNow ? this.#segmentsChunk(work, module, chunk) : null
    const instantDone = segmentsDone ?? (v3 === null ? null : this.#instantChunk(work, module, chunk, reading, action, v3, noAuto))
    const handledNos = new Set(this.#instantNos.keys())
    // 가격만 고쳐 말함은 그 사이 다른 번호가 들리면 하지 않는다 — 처리하지 못한 번호(번호만 들린 조각 등)도 들린 번호다
    // (조각으로 처리한 번호는 #runPicks가 이미 적었다. 빠진 0을 되살린 원래 번호는 처리한 번호로 본다)
    const unhandled = (v3?.heardNumbers ?? []).filter((no) => !handledNos.has(no) && !this.#zeroRaw.has(no))
    const lastUnhandled = unhandled.at(-1)
    if (lastUnhandled !== undefined) this.#lastHeardNo = lastUnhandled
    // 이 덩어리로 맥락을 고치기 전의 맥락 — 이 덩어리에서 기다리는 번호를 이어 받아 등록하면(번호 없는 가격 6a) 그 품종은 앞 말 맥락으로 (R-17 8 1b)
    // (번호만 든 덩어리는 맥락을 그 글 하나로 비운다 — 그때만 넘긴다)
    const contextBefore = handledNos.size === 0 && unhandled.length > 0 ? this.#contextTexts : null
    this.#noteContext(module, chunk, handledNos.size > 0, unhandled.length > 0, now)
    this.#zeroRaw.clear()
    this.#chunkSeq++
    this.#pickDone.clear()
    this.#instantNos = new Map()
    if (this.#phrase === null || module.nextTickAt(this.#phrase) === null) this.#phraseInstantOff = false
    // 기다리는 번호 (D-V3-67): 번호만 들린 조각은 다음 원 가격을 60초 기다리고, 놓치면 "15번 가격을 못 들었어요" 카드
    const waited = v3 !== null && !noAuto ? this.#stepWaiting(work, module, chunk, reading, v3, handledNos, contextBefore) : null
    if (waited !== null) {
      const read = { no: reading.no, name: reading.name, price: reading.price, candidates: reading.candidates }
      work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: chunk.pieces, read, action: waited.action, reason: waited.reason }))
      if (waited.readout !== null) work.readout = { text: waited.readout, discarded: false, until: now + READOUT_MS }
      return
    }
    if (instantDone !== null) {
      const read = { no: reading.no, name: reading.name, price: reading.price, candidates: reading.candidates }
      work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: chunk.pieces, read, action: instantDone.action, reason: instantDone.reason }))
      if (instantDone.readout !== null) work.readout = { text: instantDone.readout, discarded: false, until: now + READOUT_MS }
      return
    }
    switch (action.kind) {
      case 'create': {
        const id = `voice-${String(this.#nextCard++)}`
        const card = module.createChunkCard({ id, action, text: chunk.text, createdAt: now, settings: held.settings, noAutoConfirm: chunk.noAutoConfirm })
        if (card === null) {
          action = { kind: 'discard', reason: module.VOICE_LOG_REASONS.noFields, cancelled: false }
          reason = action.reason
          break
        }
        const placed: SuggestionCard = card
        // 번호 없는 카드는 띄우지 않는다 — 음성 기록에만 (사용자 요구 V3: 번호와 가격이 둘 다 확실할 때만 올림). 번호 둘이면 그 까닭도 기록에
        // 가격 뒤의 '번' 없는 번호도 카드 없이 (D-V3-41)
        if (v3 !== null && (placed.no === null || v3.blocked === 'BARE_NUMBER_AFTER_PRICE')) {
          action = {
            kind: 'discard',
            reason: placed.no !== null ? module.VOICE_LOG_REASONS.numberAfterPrice : v3.heardNumbers.length >= 2 ? module.manyNumbersReason(v3.heardNumbers) : module.VOICE_LOG_REASONS.noNumber,
            cancelled: false,
          }
          reason = action.reason
          break
        }
        if (v3 !== null) {
          // 창이 열려 미룬 바로 등록 — 창이 닫히면 등록 (AC-V3-43 a)
          if (v3.ready !== null && v3.ready.no === placed.no && !noAuto && !this.#rejected.has(v3.ready.no)) this.#dueCards.add(id)
        }
        // 추측 품종은 칸에 넣지 않고 후보 단추로만 (D-V3-37 — 누르면 채우고 손댄 카드)
        info.set(id, { candidates: placed.name === null || placed.nameNeedsCheck === true ? withGuess(reading.candidates, placed.name === null ? v3 : null) : [], ask: action.ask })
        if (reading.nameWindow !== null) this.#windows.set(id, reading.nameWindow)
        this.#touchLearned(module, reading, now)
        this.#place(work, module, placed)
        break
      }
      case 'fill': {
        const target = action.cardId
        const card = work.cards.find((item) => item.id === target)
        if (card === undefined) break
        const filled = module.fillCard(card, action, now, held.settings, { noAutoConfirm: chunk.noAutoConfirm })
        work.cards = module.replaceCard(work.cards, filled).filter(isOpen)
        info.set(card.id, { candidates: candidatesFor(filled.name), ask: action.ask })
        if (action.changes.name !== undefined && reading.nameWindow !== null) this.#windows.set(card.id, reading.nameWindow)
        this.#touchLearned(module, reading, now)
        if (action.skipped.length > 0) reason = module.VOICE_LOG_REASONS.conflict
        // 이어 채우기로 원 가격이 채워지면 그 카드를 바로 등록 (D-V3-01, AC-V3-28)
        if (v3 !== null && v3.priceSure && v3.blocked === null && !noAuto && !filled.touched && filled.no !== null && filled.price !== null && !this.#rejected.has(filled.no) && this.#existingOf(filled.no) === null) {
          if (this.#host.dialogOpen()) this.#dueCards.add(filled.id)
          else this.#registerCard(work, filled)
        }
        break
      }
      case 'edit': {
        const target = action.cardId
        const card = work.cards.find((item) => item.id === target)
        if (card === undefined) break
        const edited = module.editCard(card, action.changes, { maxNumber: held.maxNumber })
        if (!edited.ok) {
          reason = edited.message
          break
        }
        const next: SuggestionCard = action.nameNeedsCheck ? { ...edited.card, nameNeedsCheck: true } : edited.card
        work.cards = module.replaceCard(work.cards, next).filter(isOpen)
        notes.set(card.id, action.message)
        info.set(card.id, { candidates: candidatesFor(next.name), ask: module.askFor(next) })
        if (Object.hasOwn(action.changes, 'name') && reading.nameWindow !== null) this.#windows.set(card.id, reading.nameWindow)
        break
      }
      case 'confirmEdit': {
        // 앞 값이 카드 값과 다르다 — 카드는 그대로 두고 묻는다. 손댄 카드가 되어 자동 확정하지 않는다 (D-V2-19)
        const target = action.cardId
        const card = work.cards.find((item) => item.id === target)
        if (card === undefined) break
        work.cards = module.replaceCard(work.cards, module.touchCard(card)).filter(isOpen)
        const offer: VoiceOffer = {
          id: `offer-${String(this.#nextOffer++)}`,
          kind: 'card',
          registrationId: target,
          message: action.message,
          changes: {},
          cardChanges: action.changes,
          cardNote: action.editMessage,
          cardNameCheck: action.nameNeedsCheck,
          stage: 'ask',
          before: null,
          undoUntil: null,
          error: null,
        }
        work.offers = [offer, ...work.offers.filter((item) => !(item.kind === 'card' && item.registrationId === target))]
        break
      }
      case 'close': {
        const target = action.cardId
        const closing = work.cards.find((card) => card.id === target)
        if (closing?.no !== null && closing?.no !== undefined && this.#instantOn()) this.#rejected.add(closing.no)
        work.cards = work.cards.filter((card) => card.id !== target)
        break
      }
      case 'offer':
      case 'offerNumber':
      case 'offerUndo': {
        const kind = action.kind === 'offer' ? 'offer' : action.kind === 'offerNumber' ? 'number' : action.canUndo ? 'undo' : 'late'
        const offer: VoiceOffer = {
          id: `offer-${String(this.#nextOffer++)}`,
          kind,
          registrationId: action.registrationId,
          message: action.message,
          changes: action.kind === 'offer' ? action.changes : {},
          stage: 'ask',
          before: null,
          undoUntil: null,
          error: null,
        }
        work.offers = [offer, ...work.offers]
        break
      }
      default:
        break
    }
    // 이 덩어리 처리 중 다른 곳(가격 못 들은 번호 카드 등)이 더한 칸은 지우지 않는다
    for (const [key, value] of work.info) if (!info.has(key)) info.set(key, value)
    for (const [key, value] of work.notes) if (!notes.has(key)) notes.set(key, value)
    work.info = info
    work.notes = notes
    const read = { no: reading.no, name: reading.name, price: reading.price, candidates: reading.candidates }
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: chunk.pieces, read, action: LOG_ACTION[action.kind], reason }))
    let text: string
    if (action.kind === 'discard' && v3 !== null && !action.cancelled) {
      // D-V3-61: 번호도 '원' 가격도 없는 덩어리는 기록에만 — 켬에서 번호만 있으면 "15번 · 가격을 못 들었어요", '원' 가격만 있으면 "70,000원 · 번호를 못 들었어요"
      const shown = this.#discardReadout(module, action.reason, reading, v3, handledNos)
      if (shown === null) return
      text = shown
    } else if (action.kind === 'discard') text = action.cancelled ? CANCELLED_READOUT : (reason ?? module.VOICE_LOG_REASONS.noFields)
    else if (action.kind === 'edit') text = action.message
    else if (action.kind === 'offer' || action.kind === 'offerNumber' || action.kind === 'offerUndo' || action.kind === 'confirmEdit') text = action.message
    else text = module.describeReading(reading)
    work.readout = { text, discarded: action.kind === 'discard', until: now + READOUT_MS }
  }

  /**
   * 기다리는 번호 한 걸음 (D-V3-67, 음성 패키지 stepWaiting): 이어 받으면 그 번호로 바로 등록("이어 받음"),
   * 다른 'N번'이 먼저 오거나 60초가 지나면 가격 입력 카드. 이어 받아 처리했으면 기록할 것, 아니면 null
   */
  #stepWaiting(
    work: CardWork,
    module: VoiceModule,
    chunk: PhraseChunk,
    reading: ChunkReading,
    v3: RegistrationReading,
    handled: ReadonlySet<number>,
    contextBefore: readonly { readonly text: string; readonly at: number; readonly between: boolean }[] | null,
  ): InstantDone | null {
    if (typeof module.stepWaiting !== 'function' || !this.#snapshot.instant || chunk.text.includes('문자찜')) return null
    const last = [...handled].at(-1)
    const piece =
      last !== undefined
        ? { markerNo: last, wonPrice: null, paired: true }
        : {
            markerNo: v3.numberFrom === 'marker' ? reading.no : null,
            wonPrice: reading.no === null && v3.priceSure && reading.price !== null ? reading.price : null,
            paired: false,
          }
    let step: ReturnType<VoiceModule['stepWaiting']>
    try {
      step = module.stepWaiting({ waiting: this.#waiting, now: this.#host.now(), piece, exists: (no) => this.#existingOf(no) !== null })
    } catch {
      return null
    }
    // 기다림은 그 번호를 들은 때부터 센다 (덩어리 끝이 아니라 덩어리 처음)
    this.#waiting = step.waiting !== null && step.waiting.no !== this.#waiting?.no && Number.isFinite(chunk.startedAt) ? { ...step.waiting, since: Math.min(step.waiting.since, chunk.startedAt) } : step.waiting
    if (step.card !== null) this.#missedCard(work, module, step.card)
    let take = step.take
    const now = this.#host.now()
    const pending = this.#pendingPrice !== null && now - this.#pendingPrice.at <= PENDING_PRICE_MS && now >= this.#pendingPrice.at ? this.#pendingPrice : null
    if (take === null && pending !== null && !piece.paired && piece.markerNo !== null && piece.wonPrice === null && this.#waiting?.no === piece.markerNo) {
      // 앞에 번호 없이 들린 가격 + 가격 없는 'N번' → 그 번호의 가격 (기다리는 번호는 끝)
      take = { no: piece.markerNo, price: pending.price }
      this.#waiting = null
    }
    // 번호가 들리면 앞의 번호 없는 가격은 끝난다. 번호 없이 '원' 가격만 들리고(정정 낱말 없음) 받을 번호가 없으면 다음 번호를 15초 기다린다
    if (piece.markerNo !== null) this.#pendingPrice = null
    else if (piece.wonPrice !== null && step.take === null && !(typeof module.hasPriceCorrection === 'function' && module.hasPriceCorrection(chunk.text))) this.#pendingPrice = { price: piece.wonPrice, at: now }
    if (take === null || this.#rejected.has(take.no) || this.#existingOf(take.no) !== null) return null
    this.#instantNos.set(take.no, 'register')
    // 기다리던 번호의 품종: 이 덩어리 품종, 없으면 번호를 들은 덩어리·앞 말 맥락 (사용자 요구 — 다른 결과에 들린 품종도)
    // 번호만 든 이 덩어리가 앞 맥락을 비웠어도(R-17 8 1b — 등록 안 된 덩어리일 때의 규칙) 이 덩어리로 등록하면 비우기 전 맥락 + 이 덩어리 글로 고른다
    // (실방송 금화다육 251번 "3만 원에 … BTS … 나왔는데요" 다음 "251번" — 이어 받은 등록이 품종 없이 되던 것)
    const takeName = this.#contextName(module, reading.name, contextBefore === null ? undefined : [...contextBefore, ...this.#contextTexts.filter((item) => !contextBefore.includes(item))])
    const done = this.#registerInstant(work, { no: take.no, price: take.price, name: takeName, nameNeedsCheck: false, numberFrom: 'marker' }, chunk.text)
    this.#instantNos = new Map()
    return { action: 'create', reason: LOG_TAKEN, readout: done.readout === null ? null : `${done.readout} · ${TAKEN_MARK}` }
  }

  #takeWaiting(work: CardWork, module: VoiceModule, text: string, final: boolean): void {
    if (typeof module.stepWaiting !== 'function') return
    const rr = this.#readRegistration(module, text, final)
    if (rr === null || rr.extraction.no !== null || rr.heardNumbers.length > 0 || !rr.priceSure || rr.extraction.price === null) return
    let step: ReturnType<VoiceModule['stepWaiting']>
    try {
      step = module.stepWaiting({ waiting: this.#waiting, now: this.#host.now(), piece: { markerNo: null, wonPrice: rr.extraction.price, paired: false }, exists: (no) => this.#existingOf(no) !== null })
    } catch {
      return
    }
    this.#waiting = step.waiting
    if (step.card !== null) this.#missedCard(work, module, step.card)
    const take = step.take
    if (take === null || this.#rejected.has(take.no) || this.#existingOf(take.no) !== null) return
    this.#instantNos.set(take.no, 'register')
    const done = this.#registerInstant(work, { no: take.no, price: take.price, name: this.#contextName(module, rr.extraction.name), nameNeedsCheck: false, numberFrom: 'marker' }, text)
    const now = this.#host.now()
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: [{ text }], read: { no: take.no, name: rr.extraction.name, price: take.price, candidates: [] }, action: 'create', reason: LOG_TAKEN }))
    if (done.readout !== null) work.readout = { text: `${done.readout} · ${TAKEN_MARK}`, discarded: false, until: now + READOUT_MS }
  }

  /** "15번 가격을 못 들었어요" 카드 (D-V3-67) — 가격을 적어 [등록]하거나 [닫기]. 같은 번호 카드가 있으면 그대로 */
  #missedCard(work: CardWork, module: VoiceModule, no: number): void {
    if (this.#existingOf(no) !== null || work.cards.some((card) => isOpen(card) && card.no === no)) return
    // 가격 못 들은 번호 카드는 3장까지 — 넘으면 가장 오래된 것을 접어 "가격 못 들은 번호 N개 더"로 (R80)
    const missed = work.cards.filter((card) => isOpen(card) && work.info.get(card.id)?.missed === true).sort((a, b) => a.createdAt - b.createdAt)
    if (missed.length >= 3) {
      const oldest = missed[0]
      if (oldest !== undefined) {
        work.cards = work.cards.filter((card) => card.id !== oldest.id)
        this.#folded = [...this.#folded, oldest.no ?? 0]
      }
    }
    const id = `voice-${String(this.#nextCard++)}`
    const card: SuggestionCard = { id, no, name: null, price: null, confidence: 'LOW', text: '', createdAt: this.#host.now(), status: 'OPEN', touched: false, autoConfirmAt: null }
    work.notes = new Map(work.notes).set(id, missedPriceNote(no))
    work.info = new Map(work.info).set(id, { candidates: [], ask: null, missed: true })
    this.#place(work, module, card)
  }

  /**
   * "가격을 못 들었어요" 카드의 [등록]: 적은 가격을 그 방송 가격 단위로 읽어 빠른 입력과 같은 등록 경로로. 읽지 못하면 문장을 돌려준다
   */
  submitMissed(id: string, text: string): string | null {
    const card = this.#find(id)
    if (card === undefined || card.no === null) return null
    const unit = this.#host.priceUnit?.() ?? 'THOUSAND'
    const price = parseAmount(text.trim(), { 'price.unit': unit })
    if (price === null || price < 100) return MISSED_PRICE_PROBLEM
    this.take(id)
    this.#host.register({ ...card, price, touched: true }, { no: card.no, name: '', price }, 'click')
    return null
  }

  /** 60초가 지난 기다리는 번호를 카드로 (덩어리가 오지 않아도) */
  #expireWaiting(): void {
    const module = this.#module
    if (module === null || this.#waiting === null || typeof module.waitingExpired !== 'function') return
    if (!module.waitingExpired(this.#waiting, this.#host.now())) return
    const no = this.#waiting.no
    this.#waiting = null
    const work = this.#emptyWork()
    this.#missedCard(work, module, no)
    this.#set(this.#workPatch(work))
  }

  /** V3 버림의 큰 글자 칸 (D-V3-41·61) — 보이지 않으면 null(기록에만) */
  #discardReadout(module: VoiceModule, why: string | null, reading: ChunkReading, v3: RegistrationReading, handled: ReadonlySet<number>): string | null {
    const reasons = module.VOICE_LOG_REASONS
    // 번호가 들린 버림(번호 여럿·가격 뒤 번호)은 그대로 4초 (D-V3-41)
    if (why !== null && (why === reasons.numberAfterPrice || why.startsWith('번호가 여럿'))) return why
    const instant = this.#snapshot.instant
    // 번호만 들린 조각은 4초 안내 대신 기다리는 번호가 된다 (D-V3-67)
    void handled
    if (instant && reading.no === null && reading.price !== null && v3.priceSure) return `${formatWon(reading.price)} · ${NUMBER_MISSING_READOUT}`
    return null
  }

  /** 배운 별칭으로 채웠으면 그 별칭을 썼다고 적는다 (오래 안 쓴 것부터 지우므로) */
  #touchLearned(module: VoiceModule, reading: ChunkReading, now: number): void {
    const window = reading.nameWindow
    if (window === null || reading.name === null) return
    const key = window.replace(/\s+/g, '')
    if (!this.#learned.some((item) => item.heard === key && item.name === reading.name)) return
    this.#learned = module.touchLearnedAlias(this.#learned, key, now)
    this.#saveLearned()
  }

  #saveLearned(): void {
    try {
      this.#host.writeLearned?.(this.#learned)
    } catch {
      // 남기지 못하면 이번 콘솔에서만 쓴다
    }
  }

  /** 바뀐 목록만 담은 조각 */
  #workPatch(work: CardWork): Partial<VoiceSnapshot> {
    const s = this.#snapshot
    return {
      ...(this.#folded.length === s.missedFolded ? {} : { missedFolded: this.#folded.length }),
      ...(work.cards === s.cards ? {} : { cards: work.cards }),
      ...(work.sms === s.sms ? {} : { sms: work.sms }),
      ...(work.dropped === s.smsDropped ? {} : { smsDropped: work.dropped }),
      ...(work.log === s.log ? {} : { log: work.log }),
      ...(work.notes === s.notes ? {} : { notes: work.notes }),
      ...(work.info === s.info ? {} : { info: work.info }),
      ...(work.offers === s.offers ? {} : { offers: work.offers }),
      ...(work.readout === s.readout ? {} : { readout: work.readout }),
    }
  }

  #pruneRecent(now: number): void {
    this.#recent = this.#recent.filter((item) => now - item.registeredAt <= 60_000)
  }

  /**
   * 목록에 이 문장의 카드를 더한다 (카드를 만들 결과가 아니면 그대로). 문자찜 표시가 있으면 문자찜 카드(R-21), 없으면 상품 카드(R-17) — 하나만(R-21 2).
   * 설정·번호 범위는 문장이 온 때의 값, 사전은 지금 사전(이력을 기다린 까닭), 만든 시각은 카드가 보이는 지금
   * — 자동 등록 기다림을 판매자가 화면에서 다 볼 수 있게 미룬 시간만큼 줄이지 않는다
   */
  #addSentence(work: CardWork, module: VoiceModule, sentence: HeldSentence): void {
    const { text, settings, maxNumber } = sentence
    const smsOn = this.#host.writeSms !== undefined
    const read = module.readVoiceSentence(text, {
      extract: { maxNumber, dictionary: this.#prepared(module) },
      sms: { maxNumber, ...(this.#host.smsReadOptions?.() ?? {}) },
      // 문자찜 쓰기가 없는 화면이면 문자찜 문장은 카드를 만들지 않는다
      smsSettings: smsOn ? sentence.smsSettings : { 'voice.smsListen': false },
    })
    if (read.kind === 'none') return
    if (read.kind === 'sms') {
      this.#addSms(work, module, text, read.reading, sentence.smsSettings, sentence.flushedAtEnd)
      return
    }
    const card = module.createCard({
      id: `voice-${String(this.#nextCard++)}`,
      extraction: read.extraction,
      text,
      createdAt: this.#host.now(),
      settings,
      // 끝에서 넘긴 문장 카드는 자동 확정하지 않는다 (D-I5-02, AC-I5-04) — 보통 결과에는 속성을 넘기지 않는다
      ...(sentence.flushedAtEnd ? { flushedAtEnd: true } : {}),
    })
    if (card !== null) this.#place(work, module, card)
  }

  /** 새 카드를 맨 앞에 — 열린 카드 수 규칙은 상품 카드·문자찜 카드를 함께 센다 (D-204·D-I4-02, addVoiceCard) */
  #place(work: CardWork, module: VoiceModule, card: VoiceCard, entry?: SmsEntry): void {
    const merged: VoiceCard[] = [...work.cards, ...work.sms.map((item) => item.card)].sort((a, b) => b.createdAt - a.createdAt)
    const next = module.addVoiceCard(merged, card, reasonIds(work.sms))
    const byId = new Map(next.map((item) => [item.id, item]))
    // 3장 규칙으로 닫힌 끝에서 넘긴 카드는 자동 등록도 안 되므로 조용히 사라지면 말한 상품을 잃는다 — 안내를 남긴다 (U-I5-01)
    // 안내를 닫기 전에 여러 장이 차례로 밀려 닫혀도 앞의 것을 덮지 않고 모두 쌓는다
    for (const lost of next) {
      if (module.isSmsCard(lost) || lost.flushedAtEnd !== true || isOpen(lost)) continue
      if (work.cards.some((old) => old.id === lost.id && isOpen(old))) this.#lostFlushed.push(module.describeCard(lost))
    }
    work.cards = next.filter((item): item is SuggestionCard => !module.isSmsCard(item) && isOpen(item))
    const dropped: SmsDropped[] = []
    const rest = work.sms.map((item) => {
      const changed = byId.get(item.card.id)
      if (changed === undefined || changed === item.card || !module.isSmsCard(changed)) return item
      // 넣을 수 있던(이유 없는) 카드가 넣지 않은 채 닫혔다 — 안내를 남긴다 (U-V1-01). D-V1-18 뒤로는 addVoiceCard가 그런 카드를 닫지 않아 지킴 장치로만 남는다
      if (item.card.status === 'OPEN' && changed.status === 'CLOSED' && item.reason === null && item.results.length === 0) {
        const short = smsShortText(this.describeSms(item.card))
        dropped.push({ id: item.card.id, short, text: smsDroppedText(short) })
      }
      return { ...item, card: changed }
    })
    work.sms = entry === undefined ? rest : [entry, ...rest]
    if (dropped.length > 0) work.dropped = [...dropped, ...work.dropped]
  }

  /** 문자찜 문장 → 같은 말이면 앞 카드에 표시, 아니면 새 문자찜 카드 (D-V1-06·07) */
  #addSms(work: CardWork, module: VoiceModule, text: string, reading: SmsReading, smsSettings: SmsVoiceSettings | null, flushedAtEnd: boolean): void {
    const now = this.#host.now()
    // 같은 말 검사: 넣었거나 넣을 수 있는 카드만 (넣지 않고 닫은 카드·이유 카드는 빼서 다시 말하면 새 카드, D-V1-17)
    const repeat = module.findSmsRepeat(
      work.sms.map((item) => item.card),
      reading,
      now,
      reasonIds(work.sms),
    )
    if (repeat !== null) {
      work.sms = work.sms.map((item) => (item.card.id === repeat.id ? { ...item, card: module.markSmsRepeat(item.card) } : item))
      return
    }
    let card = module.createSmsCard({ id: `voice-${String(this.#nextCard++)}`, reading, text, createdAt: now, settings: smsSettings })
    let reason: string | null = reading.problem === null ? null : module.SMS_PROBLEM_MESSAGES[reading.problem]
    let timeCheck = false
    if (reason === null && reading.time !== null) {
      const time = this.#readTime(reading.time, now)
      if (time === null) reason = module.SMS_PROBLEM_MESSAGES.TIME_UNCLEAR
      else if (time.late) {
        // 지금보다 늦은 받은 시각: 저절로 넣지 않고 묻는다 (AC-V1-26)
        timeCheck = true
        card = module.stopSmsAuto(card)
      }
    }
    if (reason === null) {
      const blocked = module.findSmsBlock(card, (no) => this.#smsProduct(no))
      if (blocked !== null) reason = module.smsBlockMessage(blocked.no, blocked.block)
    }
    if (reason !== null) card = module.stopSmsAuto(card)
    // 끝에서 넘긴(끝이 잘렸을 수 있는) 문자찜 문장은 저절로 넣지 않는다 — 판매자가 보고 넣는다 (D-I5-02와 같은 까닭, 합치기 AUTO)
    if (flushedAtEnd) card = module.stopSmsAuto(card)
    this.#place(work, module, card, { card, reason, timeCheck, sending: false, error: null, results: [], hidden: false })
  }

  /** 밀려 닫힌 카드 안내를 모두 닫는다 */
  dismissFlushedClosed(): void {
    if (this.#snapshot.flushedClosed.length > 0) this.#set({ flushedClosed: [] })
  }

  /** "이 기기에서는 음성이 어려워요" 안내의 "닫기" (D-I5-15). 다른 오류는 그대로 둔다 */
  dismissUnsupported(): void {
    if (this.#snapshot.unsupported) this.#set({ error: null, unsupported: false })
  }

  /** 상품 등록이 성공했다 (빠른 입력) — 지원 안 함 안내대로 손 입력을 마쳤으니 그 안내를 내린다 (D-I5-15) */
  noteRegistered(): void {
    this.dismissUnsupported()
  }

  // ── V3 바로 등록 (번호·가격이 들리는 순간) ───────────────────────────

  /** 콘솔이 상품 보드를 넘기고 음성 패키지에 V3 판단이 있다 (없는 화면은 V2 카드 확인 그대로) */
  #instantHost(): boolean {
    const module = this.#module
    return this.#host.existingProduct !== undefined && module !== null && typeof module.readRegistration === 'function'
  }

  /** 바로 등록을 하는가: V3 화면 + 설정 켬 */
  #instantOn(): boolean {
    return this.#snapshot.instant && this.#instantHost() && this.#host.ready?.() !== false
  }

  /** 음성 쓰기에 실을 기록 한 줄 (R-25): 들은 말을 가리고 300글자까지. 음성 모듈이 없으면 null */
  voiceLogFor(text: string, undo?: string): VoiceLogInput | null {
    const module = this.#module
    if (module === null || typeof module.maskArchiveText !== 'function') return null
    const heard = [...module.maskArchiveText(text)].slice(0, 300).join('')
    const device = this.#host.deviceId?.()
    return { heard, source: 'voice', ...(undo === undefined ? {} : { undo }), ...(device === undefined ? {} : { device }) }
  }

  #voiceLog(undo?: string): { readonly voiceLog?: VoiceLogInput } {
    const log = this.voiceLogFor(this.#heardNow, undo)
    return log === null ? {} : { voiceLog: log }
  }

  /** V3 화면인가 (바로 등록 설정을 보이고 자동 확정·기다리는 시간 설정은 뺀다) */
  instantScreen(): boolean {
    return this.#instantHost()
  }

  /** "번호와 가격이 들리면 바로 등록" 켬/끔 — 같은 음성 설정 저장값에 (D-V3-16) */
  setInstant(on: boolean): void {
    const settings = this.#snapshot.settings
    if (settings === null) return
    // 덩어리 도중 끄면 그 덩어리는 바로 등록하지 않는다 (다시 켜도)
    if (!on && this.#module !== null && this.#phrase !== null && this.#module.nextTickAt(this.#phrase) !== null) this.#phraseInstantOff = true
    if (!on) {
      this.#dueCards.clear()
      this.#dueInterim.length = 0
    }
    this.#set({ instant: on })
    this.#writeSettings(settings)
  }

  /** 지금 모으는 덩어리 글 (모은 글 + 중간 결과) */
  #chunkText(module: VoiceModule): string {
    if (this.#phrase === null) return ''
    const view = module.heardText(this.#phrase)
    return [view.collected, view.interim].filter((part) => part.trim() !== '').join(' ')
  }

  /** final = 최종 결과만 든 글 (중간 결과가 끝에 붙어 있으면 거짓 — 글 끝의 '번' 없는 번호는 아직 확정하지 않는다, D-V3-26) */
  #readRegistration(module: VoiceModule, text: string, final: boolean): RegistrationReading | null {
    try {
      return module.readRegistration(text, { dictionary: this.#prepared(module), maxNumber: this.#host.maxNumber(), ...(final ? { final: true } : {}) })
    } catch {
      return null
    }
  }

  /**
   * 결과가 올 때마다(중간 결과 포함, D-V3-01): 번호와 가격이 확정됐으면 조용한 시간을 기다리지 않고 바로 — 덩어리 안 같은 번호는 한 번만.
   * 미룸(AC-V3-43): 이력을 받는 동안·창이 열린 동안·덩어리 도중 설정을 끈 덩어리·문자찜 말·거절한 번호는 여기서 하지 않는다(덩어리 끝에 본다)
   */
  #tryInstant(work: CardWork, module: VoiceModule): void {
    if (!this.#instantOn() || this.#phraseInstantOff || this.#waitingHistory() || this.#snapshot.phase !== 'on') return
    const text = this.#chunkText(module)
    if (text === '' || text.includes('문자찜')) return
    if (this.#host.dialogOpen()) {
      // 창이 열린 동안에도 중간 후보는 센다 — 창이 닫히면 등록 (D-V3-71·AC-V3-43 a)
      const shownInterim = this.#phrase === null ? '' : module.heardText(this.#phrase).interim
      if (shownInterim.trim() !== '') this.#trackInterim(work, module, text)
      return
    }
    this.#heardNow = text
    const interim = this.#phrase === null ? '' : module.heardText(this.#phrase).interim
    const seg = this.#readSegments(module, text, interim.trim() === '')
    if (seg !== null) this.#runPicks(work, module, seg, text, false)
    // 글 끝 가격이 `원까지`·`원에`라 뒤 낱말을 기다리는 조각(지난 일 가격일 수 있다): 없는 번호의 새 등록만 바로 (R1 — `108번 … 10만 원까지` 때 등록),
    // 있는 상품의 가격은 뒤 낱말을 듣고 고친다 (실방송 468번 "120만 원까지 팔아 본 적 있어요")
    if (seg !== null && seg.held !== undefined && seg.held.length > 0) this.#runPicks(work, module, { ...seg, picks: seg.held }, text, false, true)
    // 번호 없이 가격만 고쳐 말함 (최종·굳은 글만): 마지막 조각 뒤 남은 글, 또는 조각이 없는 글
    if (seg !== null && interim.trim() === '') this.#priceOnlyRest(work, module, seg, text)
    // 정정 낱말이 든 "65번 아니 5만 원" (최종·굳은 글만, TD-V3-013)
    if (seg !== null && interim.trim() === '') this.#markerCorrection(work, module, seg, text)
    // 기다리는 번호가 있고 이 글에 번호 없이 원 가격이 들리면 그 자리에서 이어 받는다 (D-V3-67, 조용한 시간 전)
    if (seg !== null && seg.picks.length === 0 && this.#waiting !== null) this.#takeWaiting(work, module, text, interim.trim() === '')
    // 중간 결과의 빠른 꼴이 1초 동안 같으면 바로 (D-V3-71)
    if (interim.trim() !== '') this.#trackInterim(work, module, text)
    else this.#interimShown = null
  }

  /** 중간 결과 후보를 센다 (D-V3-71 (ㄱ)) — 1,000ms 같으면 등록, 아니면 그 시각에 다시 본다 */
  #trackInterim(work: CardWork, module: VoiceModule, text: string): void {
    if (typeof module.interimCandidate !== 'function' || typeof module.trackInterim !== 'function') return
    let candidate: InterimCandidate | null
    try {
      const unit = this.#host.priceUnit?.()
      candidate = module.interimCandidate(text, { dictionary: this.#prepared(module), maxNumber: this.#host.maxNumber(), ...(unit === undefined ? {} : { priceUnit: unit }) })
    } catch {
      candidate = null
    }
    this.#interimShown = candidate === null ? null : { candidate, text }
    if (candidate === null) return
    const step = module.trackInterim(this.#interimSeen, candidate, this.#host.now())
    this.#interimSeen = step.seen
    if (step.stable !== null) {
      if (!this.#host.dialogOpen()) this.#interimPick(work, module, step.stable, text)
      return
    }
    // 1,000ms 뒤 같은 후보가 아직 보이면 등록
    if (this.#interimTimer !== null) clearTimeout(this.#interimTimer)
    const last = step.seen.at(-1)
    const wait = last === undefined ? module.INTERIM_STABLE_MS : last.since + module.INTERIM_STABLE_MS - this.#host.now()
    this.#interimTimer = setTimeout(() => {
      this.#interimTimer = null
      this.#onInterimTimer()
    }, Math.max(0, wait))
  }

  #onInterimTimer(): void {
    const module = this.#module
    const shown = this.#interimShown
    if (this.#disposed || module === null || shown === null || this.#snapshot.phase !== 'on' || !this.#instantOn() || this.#phraseInstantOff) return
    const step = module.trackInterim(this.#interimSeen, shown.candidate, this.#host.now())
    this.#interimSeen = step.seen
    if (step.stable === null || this.#host.dialogOpen()) return
    const work = this.#emptyWork()
    this.#interimPick(work, module, step.stable, shown.text)
    this.#set(this.#workPatch(work))
  }

  /** 중간 글 후보 하나를 조각처럼 처리 (바로 등록·같은 번호 R-22), 기록 "중간 글로 등록" */
  #interimPick(work: CardWork, module: VoiceModule, item: InterimCandidate, text: string): void {
    if (this.#instantNos.has(item.no)) return
    const pick: SegmentPick = { no: item.no, price: item.price, name: item.name, numberFrom: 'marker', priceFrom: 'quick', start: -1, end: -1, blocked: null, bigChange: false }
    const before = work.log
    this.#runPicks(work, module, { tokens: [], picks: [pick], others: [], tail: null, rest: '' }, text, false)
    if (work.log !== before && work.log[0] !== undefined) work.log = [{ ...work.log[0], reason: LOG_INTERIM }, ...work.log.slice(1)]
  }

  /** 조각 읽기 (D-V3-46·48): 덩어리 글 → 조각마다 등록 값. final = 최종 결과만 든 글 */
  #readSegments(module: VoiceModule, text: string, final: boolean): SegmentReading | null {
    if (typeof module.readSegments !== 'function') return null
    try {
      const unit = this.#host.priceUnit?.()
      return module.readSegments(text, { dictionary: this.#prepared(module), maxNumber: this.#host.maxNumber(), ...(final ? { final: true } : {}), ...(unit === undefined ? {} : { priceUnit: unit }) })
    } catch {
      return null
    }
  }

  /**
   * 아직 처리하지 않은 조각마다 한 번 (`${no}@${start}`로 거름): 없는 번호면 바로 등록, 이미 있는 번호면 R-22, 300만 원 넘으면 카드(덩어리 끝에서만).
   * 같은 덩어리에서 이미 등록한 번호를 다른 가격으로 다시 말하면 R-22(보내는 중이면 등록 뒤, D-V3-19)
   */
  #runPicks(work: CardWork, module: VoiceModule, seg: SegmentReading, whole: string, chunkEnd: boolean, newOnly = false): void {
    for (const raw of seg.picks) {
      const key = `${String(raw.no)}@${String(raw.start)}`
      if (this.#pickDone.has(key)) continue
      // 빠진 0 되살리기 (실방송 "36번" = 306번): 앞 번호 맥락이 뚜렷할 때만 X0Y로
      const fixedNo = this.#droppedZero(module, raw)
      const pick: SegmentPick = fixedNo === null ? raw : { ...raw, no: fixedNo }
      // newOnly(기다리는 가격 조각): 없는 번호의 새 등록만 — 있는·판매 종료·거절·고치는 중인 번호는 손대지 않고 뒤 낱말을 기다린다
      if (newOnly && (this.#existingOf(pick.no) !== null || this.#rejected.has(pick.no) || this.#instantNos.has(pick.no))) continue
      const zeroNote = fixedNo === null ? null : droppedZeroNote(raw.no, fixedNo)
      // '번' 없는 수가 앞 번호 흐름(최근 음성 등록 2개)에서 멀면 번호가 아니다 (실방송 "얼마 드릴까 50"·"25 자 25만 원")
      if (pick.numberFrom === 'bare' && this.#bareOffRun(module, pick.no)) {
        this.#pickDone.add(key)
        work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [{ text: whole }], read: { no: pick.no, name: pick.name, price: pick.price, candidates: [] }, action: 'discard', reason: LOG_BARE_OFF_RUN }))
        continue
      }
      if (fixedNo !== null) this.#zeroRaw.add(raw.no)
      this.#lastHeardNo = pick.no
      // 기록·카드에 남기는 들은 말은 그 일을 만든 조각 글만 (RA-V3-004·SA-V3-001)
      const text = pick.start >= 0 && pick.end >= pick.start && seg.tokens.length > pick.end ? seg.tokens.slice(pick.start, pick.end + 1).join(' ') : whole
      this.#heardNow = text
      if (this.#rejected.has(pick.no)) {
        // 거절한 번호: 바로 하지 않는다 — 덩어리 끝에 이미 있는 상품이면 묻기만(auto 거짓), 없으면 카드 (D-V3-10)
        if (chunkEnd) {
          this.#pickDone.add(key)
          const found = this.#existingOf(pick.no)
          if (found !== null && found !== 'closed' && found.pending !== true) {
            const done = this.#applyExisting(work, module, pick.no, found, { name: pick.name, price: pick.price, nameNeedsCheck: false, priceSure: true, numberFrom: pick.numberFrom }, false, false)
            work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [{ text }], read: { no: pick.no, name: pick.name, price: pick.price, candidates: [] }, action: done.action, reason: done.reason }))
            if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: this.#host.now() + READOUT_MS }
          } else this.#pickCard(work, module, pick, text, null)
        }
        continue
      }
      if (work.cards.some((card) => isOpen(card) && card.no === pick.no && card.touched)) {
        if (chunkEnd) this.#pickDone.add(key)
        continue
      }
      const existing = this.#existingOf(pick.no)
      // 판매 종료한 번호(등록을 되돌린 번호 포함)는 바로 하지 않는다 — 덩어리 끝에 카드
      if (existing === 'closed') {
        if (chunkEnd) {
          this.#pickDone.add(key)
          // 판매 종료 상품은 R-22 묻기 (NOT_OPEN — 판매 중이 아닌 상품이라…). 상품 자료를 못 보면 카드
          let view: ExistingView | null
          try {
            view = this.#host.existingProduct?.(pick.no) ?? null
          } catch {
            view = null
          }
          if (view !== null) {
            const done = this.#applyExisting(work, module, pick.no, view, { name: pick.name, price: pick.price, nameNeedsCheck: false, priceSure: true, numberFrom: pick.numberFrom }, true, false)
            work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [{ text }], read: { no: pick.no, name: pick.name, price: pick.price, candidates: [] }, action: done.action, reason: done.reason }))
            if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: this.#host.now() + READOUT_MS }
          } else this.#pickCard(work, module, pick, text, null)
        }
        continue
      }
      this.#pickDone.add(key)
      const now = this.#host.now()
      const heard: ExistingHeard = { name: pick.name, price: pick.price, nameNeedsCheck: false, priceSure: true, numberFrom: pick.numberFrom }
      let done: InstantDone
      if (existing === null) {
        this.#instantNos.set(pick.no, 'register')
        // 덩어리 첫 조각의 품종은 앞 덩어리 말(1분 안)도 본다 — "바이칼녹금 … / 312번 녹금 5만 원" → 바이칼녹금 (이름만)
        const name = raw === seg.picks[0] ? this.#contextName(module, pick.name) : pick.name
        done = this.#registerInstant(work, { no: pick.no, price: pick.price, name, nameNeedsCheck: false, numberFrom: pick.numberFrom }, text)
      } else if (existing.pending === true) {
        // 보내는 중인 번호 — 등록이 끝난 뒤 같은 번호 판단 (D-V3-19)
        this.#setPending(pick.no, { after: { heard, auto: true } })
        done = { action: 'discard', reason: LOG_PENDING, readout: null }
      } else {
        if (!this.#instantNos.has(pick.no)) this.#instantNos.set(pick.no, 'existing')
        // 정정 낱말은 조각 어디에 있어도 센다 — 'N번' 앞이어도("아니 65번 5만 원"·"다시 15번 7만 원", TD-V3-013 AUTO). 조각 = 앞 조각 끝 뒤 ~ 이 조각 끝
        const index = seg.picks.indexOf(raw)
        const from = index > 0 ? (seg.picks[index - 1]?.end ?? -1) + 1 : 0
        const said = pick.start >= 0 && seg.tokens.length > pick.end && typeof module.hasPriceCorrection === 'function' && module.hasPriceCorrection(seg.tokens.slice(from, pick.end + 1).join(' '))
        done = this.#applyExisting(work, module, pick.no, existing, heard, true, false, { fragment: `${String(this.#chunkSeq)}:${key}`, correction: said })
      }
      const read = { no: pick.no, name: pick.name, price: pick.price, candidates: [] }
      const reason = zeroNote === null ? done.reason : done.reason === null ? zeroNote : `${done.reason} · ${zeroNote}`
      work.log = module.addLogEntry(work.log, module.createLogEntry({ at: now, pieces: [{ text }], read, action: done.action, reason }))
      const readout = zeroNote === null ? done.readout : done.readout === null ? zeroNote : `${done.readout} · ${zeroNote}`
      if (readout !== null) work.readout = { text: readout, discarded: false, until: now + READOUT_MS }
    }
  }

  /**
   * 음성 번호 옮기기 (R-24, D-V3-58): "아까 65번은 61번이에요"(언제든)·"65번 아니 61번"·"아니 61번"(고쳐 말함일 때만).
   * 찜 0·새 번호 비어 있음·판매 중일 때만 손 고치기와 같은 product.renumber, 10초 되돌리기. 아니면 4초 안내. 옮기기 말이 아니면 null
   */
  #renumberChunk(work: CardWork, module: VoiceModule, text: string): InstantDone | null {
    if (typeof module.readRenumber !== 'function' || this.#host.renumber === undefined) return null
    let read: { readonly from: number | null; readonly to: number } | null
    try {
      read = module.readRenumber(text, { maxNumber: this.#host.maxNumber() })
    } catch {
      read = null
    }
    if (read === null) return null
    const corrected = /(아니|말고|정정)/.test(text)
    const from = read.from ?? this.#voiceRegistered.at(-1)?.no ?? null
    if (from === null || from === read.to) return null
    // ⓑ·ⓒ는 고쳐 말함일 때만 (D-V3-59)
    if (corrected && this.#instantNos.get(from) !== 'register' && !this.#recentVoice(from)) return null
    const to = read.to
    const notice = (message: string): InstantDone => ({ action: 'discard', reason: message, readout: message })
    const source = this.#existingOf(from)
    if (source === null || source === 'closed') return notice(renumberNotOpen(from))
    if (source.pending === true || source.key === '') {
      this.#setPending(from, { renumberTo: to })
      return { action: 'discard', reason: LOG_PENDING, readout: null }
    }
    // 찜이 먼저 (찜이 있으면 다 팔린 상품도 "찜이 있어" 문장, TE-V3-017)
    if (source.claimCount > 0) return notice(renumberClaims(from))
    if (source.status !== undefined && source.status !== 'OPEN') return notice(renumberNotOpen(from))
    if (this.#existingOf(to) !== null) return notice(renumberTaken(to))
    // 옮기기 말 조각만 기록 (RA-V3-004)
    this.#heardNow = text
    void this.#runRenumber(from, to)
    return { action: 'edit', reason: renumberDone(from, to), readout: null }
  }

  async #runRenumber(from: number, to: number): Promise<void> {
    const requestId = this.#requestId()
    const logged = this.#voiceLog()
    await Promise.resolve()
    if (this.#disposed) return
    // 보내기 직전에 다시 본다: 그사이 찜이 생겼거나 새 번호가 생겼으면 옮기지 않는다 (RA-V3-001)
    if (this.#claimsOn(from) || this.#existingOf(to) !== null) {
      const text = this.#claimsOn(from) ? renumberClaims(from) : renumberTaken(to)
      this.#set({ readout: { text, discarded: true, until: this.#host.now() + READOUT_MS } })
      return
    }
    let result: boolean | 'claimed'
    try {
      result = (await this.#host.renumber?.(from, to, { requestId, ...logged })) ?? false
    } catch {
      result = false
    }
    if (this.#disposed) return
    const now = this.#host.now()
    if (result === 'claimed') {
      this.#set({ readout: { text: RENUMBER_CLAIMED, discarded: true, until: now + READOUT_MS } })
      return
    }
    if (result !== true) {
      this.#set({ readout: { text: RENUMBER_FAILED, discarded: true, until: now + READOUT_MS } })
      return
    }
    this.#touchVoice(to, 'fix')
    const message = renumberDone(from, to)
    const offer: VoiceOffer = { id: `offer-${String(this.#nextOffer++)}`, kind: 'offer', registrationId: '', no: to, message, changes: {}, stage: 'fixed', before: null, undoUntil: now + (this.#module?.OFFER_UNDO_MS ?? 10_000), error: null, renumber: { from, to }, voiceRequestId: requestId, voiceHeard: logged.voiceLog?.heard ?? '' }
    this.#set({ offers: [offer, ...this.#snapshot.offers], readout: { text: message, discarded: false, until: now + READOUT_MS } })
  }

  /** 옮긴 번호 되돌리기 (to → from, from이 아직 비었을 때) */
  async #revertRenumber(offer: VoiceOffer): Promise<void> {
    const move = offer.renumber
    if (move === undefined || offer.stage !== 'fixed') return
    if (offer.undoUntil !== null && this.#host.now() > offer.undoUntil) return
    if (this.#existingOf(move.from) !== null) {
      this.#replaceOffer(offer.id, { error: renumberTaken(move.from) })
      return
    }
    // 옮긴 뒤 새 번호에 찜이 생겼으면 되돌리지 않는다 — 되돌리면 그 찜이 끝난다(R-10 RENUMBERED, RA-V3-001)
    if (this.#claimsOn(move.to)) {
      this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== offer.id), readout: { text: renumberRevertClaims(move.to), discarded: true, until: this.#host.now() + READOUT_MS } })
      return
    }
    this.#replaceOffer(offer.id, { stage: 'busy', error: null })
    let result: boolean | 'claimed'
    try {
      const undoLog = offer.voiceRequestId === undefined ? null : this.voiceLogFor(offer.voiceHeard ?? '', offer.voiceRequestId)
      result = (await this.#host.renumber?.(move.to, move.from, undoLog === null ? {} : { voiceLog: undoLog })) ?? false
    } catch {
      result = false
    }
    if (this.#disposed) return
    if (result === 'claimed') {
      this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== offer.id), readout: { text: RENUMBER_CLAIMED, discarded: true, until: this.#host.now() + READOUT_MS } })
      return
    }
    if (result !== true) {
      this.#replaceOffer(offer.id, { stage: 'fixed', error: RENUMBER_FAILED })
      return
    }
    this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== offer.id) })
  }

  /** 그 번호 상품에 살아 있는 찜(1등·대기)이 있나 — 상품 보드의 지금 값 */
  #claimsOn(no: number): boolean {
    let found: ExistingView | null
    try {
      found = this.#host.existingProduct?.(no) ?? null
    } catch {
      found = null
    }
    return found !== null && found.claimCount > 0
  }

  /** 조각 하나를 카드로 (300만 원 넘음·거절한 번호·판매 종료) */
  #pickCard(work: CardWork, module: VoiceModule, pick: SegmentPick, text: string, note: string | null): void {
    const id = `voice-${String(this.#nextCard++)}`
    const card: SuggestionCard = { id, no: pick.no, name: pick.name, price: pick.price, confidence: 'HIGH', text, createdAt: this.#host.now(), status: 'OPEN', touched: false, autoConfirmAt: null }
    const open = work.cards.find((item) => isOpen(item) && item.no === pick.no)
    if (open !== undefined) {
      if (!open.touched) work.cards = module.replaceCard(work.cards, { ...open, name: pick.name ?? open.name, price: pick.price, text })
      return
    }
    if (note !== null) work.notes = new Map(work.notes).set(id, note)
    work.info = new Map(work.info).set(id, { candidates: [], ask: null })
    this.#place(work, module, card)
  }

  /**
   * 덩어리 끝 (조각 읽기): 남은 조각 처리 · 꼬리(정정 → 그 번호 R-22, 취소 → 되돌림) · 버린 다른 번호 4초 안내(D-V3-46). 조각이 없으면 null(옛 판단)
   */
  #segmentsChunk(work: CardWork, module: VoiceModule, chunk: PhraseChunk): InstantDone | null {
    const seg = this.#readSegments(module, chunk.text, true)
    if (seg === null || chunk.text.includes('문자찜')) return null
    // 최종 글에서 그 번호의 가격이 사라졌으면 1초 넘게 보였던 중간 후보로 (D-V3-71 (ㄴ))
    const seen = this.#interimSeen
    this.#interimSeen = []
    this.#interimShown = null
    if (typeof module.interimFallback === 'function' && seen.length > 0) {
      const fallback = module.interimFallback(seen, seg.picks, [...this.#instantNos.keys()])
      if (fallback !== null && this.#existingOf(fallback.no) === null && !this.#rejected.has(fallback.no)) {
        this.#interimPick(work, module, fallback, chunk.text)
        if (seg.picks.length === 0) return { action: 'create', reason: LOG_INTERIM, readout: work.readout?.text ?? null }
      }
    }
    if (seg.picks.length === 0) return this.#renumberChunk(work, module, chunk.text) ?? this.#priceOnlyRest(work, module, seg, chunk.text) ?? this.#markerCorrection(work, module, seg, chunk.text) ?? this.#nameOnly(work, module, chunk.text, 'name@0')
    this.#runPicks(work, module, seg, chunk.text, true)
    const fixedPrice = this.#priceOnlyRest(work, module, seg, chunk.text) ?? this.#markerCorrection(work, module, seg, chunk.text)
    if (fixedPrice !== null) return fixedPrice
    const restStart = (seg.picks.at(-1)?.end ?? -1) + 1
    const filled = seg.rest.trim() === '' ? null : this.#nameOnly(work, module, seg.rest, `name@${String(restStart)}`)
    if (filled !== null) return filled
    // 등록 직후 같은 덩어리의 "아니 61번" (R-24 ⓒ)
    if (seg.rest.trim() !== '') {
      const moved = this.#renumberChunk(work, module, seg.rest)
      if (moved !== null) return moved
    }
    const tail = seg.tail
    if (tail !== null && tail.kind === 'cancel' && this.#instantNos.get(tail.no) === 'register') {
      const text = this.#undoInstant(work, tail.no)
      return { action: 'close', reason: LOG_UNDONE, readout: text }
    }
    // 남은 글을 이미 가격만 고쳐 말함으로 고쳤으면(최종 결과가 왔을 때 #tryInstant) 꼬리 정정으로 또 고치지 않는다 — 정정 한 번에 쓰기 하나 (TD-V3-012)
    const restFixed = this.#pickDone.has(`price@${String(restStart)}`)
    if (tail !== null && tail.kind === 'correction' && !restFixed) {
      let reading: ChunkReading | null
      try {
        reading = module.readChunk(tail.text, { dictionary: this.#prepared(module), maxNumber: this.#host.maxNumber() })
      } catch {
        reading = null
      }
      const existing = this.#existingOf(tail.no)
      if (reading !== null && existing !== null && existing !== 'closed') {
        const v3 = this.#readRegistration(module, tail.text, true)
        const heard: ExistingHeard = { name: reading.name, price: reading.price, nameNeedsCheck: reading.nameNeedsCheck, priceSure: v3?.priceSure === true || (reading.price !== null && (v3?.wonPrices ?? []).includes(reading.price)) }
        if (existing.pending === true) this.#setPending(tail.no, { after: { heard, auto: !this.#rejected.has(tail.no) } })
        else return this.#applyExisting(work, module, tail.no, existing, heard, !this.#rejected.has(tail.no), true)
      }
    }
    const first = seg.picks[0]
    if (first !== undefined && seg.others.length > 0) {
      const message = otherNumberMessage(first.no, seg.others)
      return { action: 'discard', reason: message, readout: message }
    }
    return { action: 'discard', reason: LOG_INSTANT_DONE, readout: null }
  }

  /**
   * 덩어리가 끝났을 때 (V3): 처리했으면 기록할 것, 아니면 null(V2 할 일 그대로).
   * 1) 바로 등록한 덩어리에 취소 → 되돌림(D-V3-21) 2) 다른 'N번' → 큰 글자 칸·기록만(D-V3-05·45) 3) 바로 한 번호 → 덮은 결과로 R-22(D-V3-13·19)
   * 4) 새 카드(create)의 번호: 이미 있는 번호 → R-22, 같은 번호 열린 카드 → 합치기(D-V3-08), 확정 → 바로 등록
   */
  #instantChunk(work: CardWork, module: VoiceModule, chunk: PhraseChunk, reading: ChunkReading, action: VoiceAction, v3: RegistrationReading | null, noAuto: boolean): InstantDone | null {
    const registered = [...this.#instantNos].filter(([, kind]) => kind === 'register').map(([no]) => no)
    if (registered.length > 0 && reading.cancel) {
      const texts = registered.map((no) => this.#undoInstant(work, no)).filter((text): text is string => text !== null)
      return { action: 'close', reason: LOG_UNDONE, readout: texts.length === 0 ? null : texts.join(' · ') }
    }
    const first = registered[0]
    if (first !== undefined && v3 !== null) {
      const others = v3.heardNumbers.filter((no) => !this.#instantNos.has(no))
      // 큰 글자 칸 4초 + 음성 기록 (D-V3-45 — [알겠어요] 알림이 아니다), 등록은 그대로
      if (others.length > 0) {
        const message = otherNumberMessage(first, others)
        return { action: 'discard', reason: message, readout: message }
      }
    }
    const no = reading.no
    const heard = (): ExistingHeard => {
      // 정정 덩어리는 가격이 둘이라 줄 읽기가 비지만, 덮은 가격이 '원'으로 들린 가격이면 확실하다 (D-V3-13)
      const sure = v3 !== null && (v3.priceSure || (v3.correction && reading.price !== null && v3.wonPrices.includes(reading.price)))
      const numberFrom = v3?.numberFrom ?? null
      // 추측 품종은 같은 번호 판단에도 쓰지 않는다 (D-V3-37)
      return { name: reading.name, price: reading.price, nameNeedsCheck: reading.nameNeedsCheck, priceSure: sure, ...(numberFrom === null ? {} : { numberFrom }) }
    }
    // 이미 있던 번호로 그 순간 처리했다 — 다시 하지 않는다 (고친 값이 목록에 닿기 전에 또 고치지 않게)
    if (no !== null && this.#instantNos.get(no) === 'existing') return { action: 'discard', reason: LOG_INSTANT_DONE, readout: null }
    if (no !== null && this.#instantNos.has(no)) {
      const existing = this.#existingOf(no)
      if (existing === null || existing === 'closed') return { action: 'discard', reason: LOG_INSTANT_DONE, readout: null }
      if (existing.pending === true) {
        this.#setPending(no, { after: { heard: heard(), auto: !noAuto && !this.#rejected.has(no) } })
        return { action: 'discard', reason: LOG_PENDING, readout: null }
      }
      return this.#applyExisting(work, module, no, existing, heard(), !noAuto && !this.#rejected.has(no), true)
    }
    if (action.kind !== 'create' || no === null) return null
    const rejected = this.#rejected.has(no)
    const existing = this.#existingOf(no)
    if (existing === 'closed') return null
    if (existing !== null) {
      if (existing.pending === true) {
        this.#setPending(no, { after: { heard: heard(), auto: !noAuto && !rejected } })
        return { action: 'discard', reason: LOG_PENDING, readout: null }
      }
      return this.#applyExisting(work, module, no, existing, heard(), !noAuto && !rejected, false)
    }
    const open = work.cards.find((card) => isOpen(card) && card.no === no)
    if (open !== undefined) return this.#mergeCard(work, module, open, reading, v3, noAuto || rejected)
    const ready = v3?.ready ?? null
    if (ready !== null && ready.no === no && !noAuto && !rejected && !chunk.text.includes('문자찜') && !this.#host.dialogOpen()) {
      this.#instantNos.set(no, 'register')
      return this.#registerInstant(work, ready, chunk.text)
    }
    return null
  }

  /** 같은 번호 열린 카드에 합친다 (D-V3-08): 손댄 카드는 그대로. 합친 카드가 원 가격까지 갖추면 바로 등록 */
  #mergeCard(work: CardWork, module: VoiceModule, open: SuggestionCard, reading: ChunkReading, v3: RegistrationReading | null, noAuto: boolean): InstantDone {
    if (open.touched) return { action: 'discard', reason: LOG_TOUCHED, readout: null }
    const changes: { name?: string; price?: number } = {}
    if (reading.name !== null && reading.name !== open.name) changes.name = reading.name
    if (reading.price !== null && reading.price !== open.price) changes.price = reading.price
    let next = open
    if (Object.keys(changes).length > 0) {
      const edited = module.editCard(open, changes, { maxNumber: this.#host.maxNumber() })
      if (!edited.ok) return { action: 'discard', reason: edited.message, readout: null }
      // 말로 합친 것은 판매자가 손댄 것이 아니다 — 손대지 않은 카드로 둔다 (editCard는 손댄 카드로 만든다)
      const merged: SuggestionCard = { ...edited.card, touched: false }
      next = changes.name === undefined ? merged : { ...merged, nameNeedsCheck: reading.nameNeedsCheck }
      if (changes.name !== undefined && reading.nameWindow !== null) this.#windows.set(open.id, reading.nameWindow)
    }
    // 합친 뒤 번호·원 가격이 갖춰지면 그 자리에서 바로 등록 (AC-V3-27 R23)
    // 번호를 'N번'으로 들었을 때만 (AC-V3-06 e, D-V3-32)
    if (!noAuto && v3 !== null && v3.priceSure && v3.blocked === null && v3.numberFrom === 'marker' && next.no !== null && next.price !== null) {
      if (this.#host.dialogOpen()) this.#dueCards.add(next.id)
      else {
        work.cards = module.replaceCard(work.cards, next)
        return this.#registerCard(work, next)
      }
    }
    work.cards = module.replaceCard(work.cards, next).filter(isOpen)
    const info = new Map(work.info)
    info.set(open.id, { candidates: next.name === null || next.nameNeedsCheck === true ? withGuess(reading.candidates, next.name === null ? v3 : null) : [], ask: module.askFor(next) })
    work.info = info
    return { action: 'edit', reason: LOG_MERGED, readout: module.describeCard(next).replace(/\s*—.*$/, '') }
  }

  #setPending(no: number, patch: Partial<PendingInstant>): void {
    const pending = this.#pending.get(no)
    if (pending !== undefined) this.#pending.set(no, { ...pending, ...patch })
  }

  /** 덩어리 안 취소: 그 바로 등록을 5초 되돌리기로 되돌린다 (D-V3-21). 아직 보내는 중이면 등록이 끝나는 대로 */
  #undoInstant(work: CardWork, no: number): string | null {
    this.#rejected.add(no)
    const pending = this.#pending.get(no)
    if (pending?.key !== null) this.#pending.delete(no)
    if (pending !== undefined && pending.key === null) {
      // 아직 보내는 중 — 등록이 끝나면 되돌리고 그때 알린다 ("되돌렸어요"를 미리 띄우지 않는다, RA-V3-002)
      this.#pending.set(no, { ...pending, cancel: true })
      return null
    }
    let board: ExistingView | null
    try {
      board = this.#host.existingProduct?.(no) ?? null
    } catch {
      board = null
    }
    const key = pending?.key ?? board?.key ?? null
    if (key !== null && this.#host.undoRecent?.(key) === true) {
      this.#recent = this.#recent.filter((item) => item.id !== key)
      return undoneReadout(no)
    }
    const offer: VoiceOffer = { id: `offer-${String(this.#nextOffer++)}`, kind: 'late', registrationId: key ?? '', no, message: OFFER_UNDO_FAILED, changes: {}, stage: 'ask', before: null, undoUntil: null, error: null }
    work.offers = [offer, ...work.offers]
    return OFFER_UNDO_FAILED
  }

  /** 그 번호의 지금 상품 (판매 종료면 'closed'), 보낸 바로 등록이 아직 목록에 없으면 보낸 값(pending), 없으면 null */
  #existingOf(no: number): (ExistingView & { readonly pending?: true }) | 'closed' | null {
    let found: ExistingView | null
    try {
      found = this.#host.existingProduct?.(no) ?? null
    } catch {
      found = null
    }
    if (found !== null) return found.closed ? 'closed' : found
    const pending = this.#pending.get(no)
    if (pending === undefined) return null
    // 등록이 끝났는데 목록에 없다 = 되돌렸거나 닫혔다 (목록이 늦게 와도 서버가 같은 번호를 두 번 만들지 않는다)
    if (pending.key !== null || this.#host.now() - pending.at > PENDING_KEEP_MS) {
      this.#pending.delete(no)
      return null
    }
    return { key: pending.key ?? '', name: pending.name, price: pending.price, claimCount: 0, closed: false, pending: true }
  }

  /** 바로 등록: 카드 없이 등록 경로로 (같은 번호 열린 카드는 닫는다). 등록하지 못하면 콘솔이 카드로 돌려놓는다 (D-V3-19) */
  #registerInstant(work: CardWork, ready: ReadyRegistration, text: string): InstantDone {
    const open = work.cards.find((item) => isOpen(item) && item.no === ready.no)
    const card: SuggestionCard = {
      id: open?.id ?? `voice-${String(this.#nextCard++)}`,
      no: ready.no,
      // 추측 품종은 등록에 쓰지 않는다 — 사전 이름만, 없으면 품종 미입력 (D-V3-37)
      name: ready.nameNeedsCheck ? null : (ready.name ?? (open?.nameNeedsCheck === true ? null : (open?.name ?? null))),
      price: ready.price,
      confidence: 'HIGH',
      text,
      createdAt: open?.createdAt ?? this.#host.now(),
      status: 'OPEN',
      touched: false,
      autoConfirmAt: null,
    }
    return this.#registerCard(work, card)
  }

  /** 카드 하나를 바로 등록 (목록에서 뺀다) */
  #registerCard(work: CardWork, card: SuggestionCard): InstantDone {
    const no = card.no
    const price = card.price
    if (no === null || price === null) return { action: 'discard', reason: LOG_INSTANT_DONE, readout: null }
    work.cards = work.cards.filter((item) => !(isOpen(item) && (item.no === no || item.id === card.id)))
    this.#dueCards.delete(card.id)
    this.#instantNos.set(no, 'register')
    // 확인이 필요한 품종(추측·사전 밖)은 보지 않은 등록에 쓰지 않는다 (D-V3-37)
    const name = card.nameNeedsCheck === true ? '' : (card.name ?? '')
    const registration: CardRegistration = { no, name, price }
    this.#pending.set(no, { cardId: card.id, name: registration.name, price, key: null, at: this.#host.now() })
    this.#host.register(card, registration, 'instant')
    this.#touchVoice(no, 'register')
    this.#chunkActs.add('REGISTERED')
    return { action: 'create', reason: LOG_INSTANT, readout: registeredReadout(no, name, price) }
  }

  /** 이미 있는 번호 (R-22, D-V3-06·07): 무시 · 바로 고침(되돌리기 10초) · 묻기 카드 + 까닭 줄. quiet = 같은 덩어리 끝처럼 무시를 조용히 */
  #applyExisting(
    work: CardWork,
    module: VoiceModule,
    no: number,
    existing: ExistingView & { readonly pending?: true },
    heard: ExistingHeard,
    auto: boolean,
    quiet: boolean,
    options: { readonly gate?: boolean; readonly fragment?: string; readonly correction?: boolean } = {},
  ): InstantDone {
    const status = existing.status ?? 'OPEN'
    // 고쳐 말함 (D-V3-59): 같은 덩어리이거나, 이 콘솔이 그 번호를 음성으로 등록·고친 지 60초 안이고 그 사이 다른 번호를 음성으로 등록하지 않음
    // 다른 기기가 마지막으로 등록·고친 번호면 고쳐 말함이 아니다 — 바로 고치지 않고 묻는다 (D-V3-76)
    const lastDevice = this.#host.lastVoiceDevice?.(no) ?? null
    const myDevice = this.#host.deviceId?.() ?? null
    const otherDevice = lastDevice !== null && myDevice !== null && lastDevice !== myDevice && this.#instantNos.get(no) !== 'register'
    const recent = !otherDevice && (this.#instantNos.get(no) === 'register' || this.#recentVoice(no))
    let decision: { readonly action: 'IGNORE' | 'AUTO_FIX' | 'ASK'; readonly changes: InstantChanges; readonly reason: string | null }
    try {
      decision = module.decideSameNumber({
        heard: {
          price: heard.price,
          priceSure: heard.priceSure !== false,
          name: heard.name,
          nameFrom: heard.name === null ? null : heard.nameNeedsCheck === true ? 'GUESS' : 'DICTIONARY',
          numberFrom: heard.numberFrom === 'bare' ? 'BARE' : 'MARKER',
        },
        product: { name: existing.name, price: existing.price, status, liveClaims: existing.claimCount },
        auto,
        recent,
        otherDevice,
      })
    } catch {
      decision = { action: 'IGNORE', changes: {}, reason: null }
    }
    const ignore: InstantDone = { action: 'discard', reason: LOG_ALREADY, readout: quiet ? null : alreadyReadout(no) }
    // 같은 번호 가격 고침 문턱 (실방송 333번): 정정 낱말이 있거나 같은 새 가격을 다른 조각에서 60초 안에 두 번 들어야 바로 고친다
    const gated = options.gate !== false && heard.price !== null && heard.priceSure !== false && !this.#priceGate(module, no, existing.price, heard.price, options.fragment ?? String(this.#chunkSeq), options.correction === true)
    if (gated && decision.action === 'AUTO_FIX' && decision.changes.price !== undefined) {
      const candidate = pickChanges(existing, { name: decision.changes.name ?? null, price: decision.changes.price })
      if (existing.pending === true || existing.key === '') return { action: 'discard', reason: LOG_PENDING, readout: null }
      this.#chunkActs.add('ASKED')
      this.#ask(work, no, existing, candidate, REASON_PRICE_ONCE)
      return { action: 'offer', reason: LOG_FIX_CANDIDATE, readout: null }
    }
    this.#chunkActs.add(decision.action === 'IGNORE' ? 'IGNORED' : decision.action === 'ASK' ? 'ASKED' : 'FIXED')
    if (decision.action === 'IGNORE') return ignore
    const changes = pickChanges(existing, { name: decision.changes.name ?? null, price: decision.changes.price ?? null })
    if (Object.keys(changes).length === 0) return ignore
    if (existing.pending === true || existing.key === '') return { action: 'discard', reason: LOG_PENDING, readout: null }
    if (decision.action === 'ASK') {
      if (decision.reason === 'MAYBE_OTHER') {
        // 다른 화분일 수 있다 — 덮어쓰지 않고 카드 한 장 (D-V3-59)
        const message = maybeOtherMessage(no, existing.price, existing.claimCount)
        const offer: VoiceOffer = { id: `offer-${String(this.#nextOffer++)}`, kind: 'offer', registrationId: existing.key, no, message, changes, stage: 'ask', before: null, undoUntil: null, error: null, maybeOther: true, voiceHeard: this.#heardNow }
        work.offers = [offer, ...work.offers.filter((item) => !(item.kind === 'offer' && item.stage === 'ask' && item.registrationId === existing.key))]
        return { action: 'offer', reason: LOG_ASK, readout: null }
      }
      const note = decision.reason === 'NOT_OPEN' ? REASON_NOT_OPEN : decision.reason === 'NUMBER_BARE' ? REASON_BARE_NUMBER : undefined
      this.#ask(work, no, existing, changes, note)
      return { action: 'offer', reason: LOG_ASK, readout: askMessage(no, existing, changes) }
    }
    const offer: VoiceOffer = { id: `offer-${String(this.#nextOffer++)}`, kind: 'offer', registrationId: existing.key, no, message: fixingMessage(no, existing, changes), changes, stage: 'busy', before: null, undoUntil: null, error: null }
    // 고침 후보로 물었던 같은 상품의 묻기 카드는 바로 고침으로 바뀌었으니 내린다
    work.offers = [offer, ...work.offers.filter((item) => !(item.kind === 'offer' && item.stage === 'ask' && item.registrationId === existing.key && item.note === REASON_PRICE_ONCE))]
    void this.#autoFix(offer.id, existing.key, no, existing, changes, decision.reason === 'NOT_RECENT')
    return { action: 'edit', reason: LOG_AUTO_FIX, readout: null }
  }

  /** 이 콘솔이 그 번호를 음성으로 등록·고친 지 60초 안이고 그 뒤 다른 번호를 음성으로 등록하지 않았나 (D-V3-59) */
  #recentVoice(no: number): boolean {
    const now = this.#host.now()
    const at = this.#voiceTouched.get(no)
    if (at === undefined || now - at > 60_000) return false
    // 그 뒤 다른 번호를 음성으로 새로 등록했으면 고쳐 말함이 아니다 (다른 번호를 고치기만 한 것은 끊지 않는다, TD-V3-005)
    return !this.#voiceRegistered.some((item) => item.no !== no && item.at > at)
  }

  /** 음성으로 등록·고친 번호를 적는다 (D-V3-59) */
  #touchVoice(no: number, kind: 'register' | 'fix'): void {
    const now = this.#host.now()
    this.#voiceTouched.set(no, now)
    for (const [key, at] of this.#voiceTouched) if (now - at > 60_000) this.#voiceTouched.delete(key)
    if (kind === 'register') this.#voiceRegistered = [...this.#voiceRegistered.filter((item) => now - item.at <= 60_000), { no, at: now }].slice(-50)
    if (kind === 'register') this.#contextNos = [...this.#contextNos.filter((item) => now - item.at <= 600_000 && item.no !== no), { no, at: now }].slice(-20)
  }

  /** 묻기 카드 (같은 상품·같은 고칠 값의 묻기는 하나만, AC-V3-31) */
  #ask(work: CardWork, no: number, existing: ExistingView, changes: InstantChanges, note: string | undefined): void {
    const message = askMessage(no, existing, changes)
    const same = (item: VoiceOffer): boolean => item.kind === 'offer' && item.stage === 'ask' && item.registrationId === existing.key
    const offer: VoiceOffer = { id: `offer-${String(this.#nextOffer++)}`, kind: 'offer', registrationId: existing.key, no, message, changes, stage: 'ask', before: null, undoUntil: null, error: null, voiceHeard: this.#heardNow, ...(note === undefined ? {} : { note }) }
    work.offers = [offer, ...work.offers.filter((item) => !same(item))]
  }

  /** 바로 고침: 보내기 직전에 상품을 다시 보고(찜·판매 중) 손 고치기와 같은 상품 고치기, 고친 뒤 [되돌리기] (D-V3-07) */
  async #autoFix(offerId: string, key: string, no: number, existing: ExistingView, changes: InstantChanges, notRecent = false): Promise<void> {
    const requestId = this.#requestId()
    const logged = this.#voiceLog()
    // 묻기·알림 카드가 화면 목록에 들어간 뒤에 바꾼다 (이 함수는 목록을 만드는 중에 불린다, TE-V3-007)
    await Promise.resolve()
    if (this.#disposed) return
    let now: ExistingView | null
    try {
      now = this.#host.existingProduct?.(no) ?? null
    } catch {
      now = null
    }
    const status = now?.status ?? 'OPEN'
    // 보내기 직전에 판매 중이 아니게 됐으면 묻는다 (D-V3-07). 찜이 있어도 고친다 — 찜 가격은 그대로(NEW_ONLY, D-V3-57)
    if (now !== null && status !== 'OPEN' && status !== 'SOLD') {
      this.#replaceOffer(offerId, { stage: 'ask', message: askMessage(no, existing, changes), note: REASON_NOT_OPEN })
      return
    }
    // 고쳐 말함이 아닌데 그사이 찜이 생겼으면 덮어쓰지 않는다 (D-V3-59)
    if (now !== null && notRecent && now.claimCount > 0) {
      this.#replaceOffer(offerId, { stage: 'ask', message: maybeOtherMessage(no, existing.price, now.claimCount), maybeOther: true })
      return
    }
    const claims = now?.claimCount ?? existing.claimCount
    const fix = this.#host.fixRecent
    let outcome: RecentFixOutcome
    try {
      outcome = fix === undefined ? { kind: 'failed', message: AUTO_FIX_FAILED } : await fix(key, changes, { newOnly: true, requestId, ...logged })
    } catch {
      outcome = { kind: 'failed', message: AUTO_FIX_FAILED }
    }
    if (this.#disposed || this.#findOffer(offerId) === undefined) return
    if (outcome.kind === 'dialog') {
      this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== offerId) })
      return
    }
    if (outcome.kind === 'failed') {
      // 묻기 카드로 남긴다 — 판매자가 [고치기]를 다시 누를 수 있다
      this.#replaceOffer(offerId, { stage: 'ask', message: askMessage(no, existing, changes), error: outcome.message })
      return
    }
    this.#recent = this.#recent.map((item) => (item.id === key ? { ...item, ...changes } : item))
    const offerTime = this.#module?.OFFER_UNDO_MS ?? 10_000
    this.#touchVoice(no, 'fix')
    const fixed = fixedMessage(no, existing, changes)
    // 찜이 있는 상품 가격을 바꾸면 찜 가격은 그대로라고 알린다 (D-V3-57)
    const note = changes.price !== undefined && claims > 0 ? claimsKeptNote(claims) : undefined
    this.#replaceOffer(offerId, { stage: 'fixed', before: outcome.before, undoUntil: this.#host.now() + offerTime, message: fixed, error: null, voiceRequestId: requestId, voiceHeard: logged.voiceLog?.heard ?? '', ...(note === undefined ? {} : { note }) })
    // 큰 글자 칸 4초 (D-V3-57), 고쳐 말함이 아니면 다른 번호였을 때 할 말 (D-V3-59)
    const until = this.#host.now() + READOUT_MS
    this.#set({ readout: { text: notRecent ? notRecentReadout(no, existing, changes) : fixed, discarded: false, until } })
  }

  /** 음성 등록이 차례에서 "이미 있는 번호"로 끝났다 (다른 기기 등, D-V3-18) — 창 없이 그 순간의 상품으로 R-22 */
  instantExists(card: SuggestionCard): void {
    const module = this.#module
    if (this.#disposed || module === null || card.no === null) return
    if (this.#pending.get(card.no)?.cardId === card.id) this.#pending.delete(card.no)
    const existing = this.#existingOf(card.no)
    if (existing === null || existing === 'closed') {
      this.restore(card, { touched: true })
      return
    }
    const work = this.#emptyWork()
    const done = this.#applyExisting(work, module, card.no, existing, { name: card.name, price: card.price, nameNeedsCheck: card.nameNeedsCheck === true, priceSure: true }, !this.#rejected.has(card.no), true, { gate: false })
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [{ text: card.text }], read: { no: card.no, name: card.name, price: card.price, candidates: [] }, action: done.action, reason: done.reason }))
    if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: this.#host.now() + READOUT_MS }
    this.#set(this.#workPatch(work))
  }

  /** 등록이 끝난 바로 등록: 미뤄 둔 취소(D-V3-21)·같은 번호 판단(D-V3-19)을 한다 */
  #afterRegistered(no: number, key: string): void {
    const module = this.#module
    const pending = this.#pending.get(no)
    if (module === null || pending === undefined) return
    if (pending.cancel === true) {
      this.#pending.delete(no)
      if (this.#host.undoRecent?.(key) === true) {
        this.#recent = this.#recent.filter((item) => item.id !== key)
        this.#set({ readout: { text: undoneReadout(no), discarded: false, until: this.#host.now() + READOUT_MS } })
      }
      return
    }
    if (pending.renumberTo !== undefined) {
      const to = pending.renumberTo
      this.#pending.delete(no)
      if (this.#existingOf(to) === null) void this.#runRenumber(no, to)
      return
    }
    const after = pending.after
    if (after === undefined) return
    const { after: _done, ...rest } = pending
    this.#pending.set(no, rest)
    let found: ExistingView | null
    try {
      found = this.#host.existingProduct?.(no) ?? null
    } catch {
      found = null
    }
    const existing: ExistingView = found ?? { key, name: pending.name, price: pending.price, claimCount: 0, closed: false }
    if (existing.closed) return
    const work = this.#emptyWork()
    const done = this.#applyExisting(work, module, no, { ...existing, key }, after.heard, after.auto, true)
    work.log = module.addLogEntry(work.log, module.createLogEntry({ at: this.#host.now(), pieces: [], read: null, action: done.action, reason: done.reason }))
    if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: this.#host.now() + READOUT_MS }
    this.#set(this.#workPatch(work))
  }

  /** 창이 열린 동안 끝난 덩어리의 중간 후보를 미뤄 둔다 */
  #deferInterim(module: VoiceModule, text: string): void {
    const seen = this.#interimSeen
    this.#interimSeen = []
    this.#interimShown = null
    if (typeof module.interimFallback !== 'function' || seen.length === 0) return
    const final = this.#readSegments(module, text, true)
    const fallback = module.interimFallback(seen, final?.picks ?? [], [])
    if (fallback !== null) this.#dueInterim.push({ candidate: fallback, text })
  }

  /** 창이 닫힌 뒤: 창 때문에 미룬 바로 등록 카드를 등록한다 (AC-V3-43 a) */
  #runDue(): void {
    if ((this.#dueCards.size === 0 && this.#dueInterim.length === 0) || this.#host.dialogOpen() || !this.#instantOn() || this.#snapshot.phase !== 'on') return
    const work = this.#emptyWork()
    const module = this.#module
    for (const item of this.#dueInterim.splice(0)) {
      if (module !== null && this.#existingOf(item.candidate.no) === null && !this.#rejected.has(item.candidate.no)) this.#interimPick(work, module, item.candidate, item.text)
    }
    for (const id of [...this.#dueCards]) {
      this.#dueCards.delete(id)
      const card = work.cards.find((item) => item.id === id && isOpen(item))
      if (card === undefined || card.touched || card.no === null || card.price === null || this.#rejected.has(card.no) || this.#existingOf(card.no) !== null) continue
      const done = this.#registerCard(work, card)
      if (done.readout !== null) work.readout = { text: done.readout, discarded: false, until: this.#host.now() + READOUT_MS }
    }
    this.#set(this.#workPatch(work))
  }

  // ── 이력을 기다리며 미룬 문장 (HISTORY_WAIT_MS) ─────────────────────

  #waitingHistory(): boolean {
    return this.#history.state === 'loading' && this.#host.now() < this.#historyDeadline
  }

  #armHeld(): void {
    if (this.#heldTimer !== null) return
    this.#heldTimer = setTimeout(
      () => {
        this.#heldTimer = null
        this.#flushHeld()
      },
      Math.max(0, this.#historyDeadline - this.#host.now()),
    )
  }

  /** 미룬 문장을 지금 사전으로 카드로 만든 목록 (미룬 것이 없으면 지금 목록) — 미룬 목록은 비운다 */
  #heldCards(module: VoiceModule): CardWork {
    if (this.#heldTimer !== null) clearTimeout(this.#heldTimer)
    this.#heldTimer = null
    const held = this.#held
    this.#held = []
    const work = this.#emptyWork()
    for (const item of held) this.#runOutput(work, module, item)
    return work
  }

  #flushHeld(): void {
    if (this.#held.length === 0) {
      this.#dropHeld()
      return
    }
    const module = this.#module
    if (this.#disposed || module === null) {
      this.#dropHeld()
      return
    }
    const work = this.#heldCards(module)
    const patch = this.#snapshot.phase === 'on' ? this.#finishWork(work, module) : this.#workPatch(work)
    if (Object.keys(patch).length > 0) this.#set(patch)
  }

  #dropHeld(): void {
    if (this.#heldTimer !== null) clearTimeout(this.#heldTimer)
    this.#heldTimer = null
    this.#held = []
  }

  // ── 판매 이력 사전 (D-I4-06) ────────────────────────────────────────

  #loadHistory(): void {
    if (this.#history.state === 'loading' || this.#history.state === 'done') return
    this.#history = { state: 'loading', past: [] }
    this.#historyDeadline = this.#host.now() + HISTORY_WAIT_MS
    this.#host.fetchHistory().then(
      (past) => {
        if (this.#disposed) return
        this.#history = { state: 'done', past }
        this.#set({ historyFailed: false })
        this.#flushHeld()
      },
      () => {
        if (this.#disposed) return
        this.#history = { state: 'failed', past: [] }
        this.#set({ historyFailed: true })
        this.#flushHeld()
      },
    )
  }

  /** 배운 별칭 → 지금 범위 이름 → 지난 범위 이름 → 기본 사전 (지금 범위 상품이 바뀌면 다음 덩어리부터) */
  #prepared(module: VoiceModule): VarietyDictionary {
    const names = this.#host.currentNames()
    const past = this.#history.state === 'done' ? this.#history.past : []
    const cached = this.#dictionary
    const learned = this.#learned
    if (cached !== null && cached.names === names && cached.past === past && cached.learned === learned) return cached.prepared
    const history = historyNames(names, past, module.normalizeDictionary)
    // 배운 별칭 → 판매 이력 → 기본 사전(데이터 사전·별칭) (D-V2-10)
    const prepared = module.prepareVoiceDictionary({ learned, history })
    this.#dictionary = { names, past, learned, prepared }
    return prepared
  }

  // ── 카드 (D-204, D-I4-02·03) ───────────────────────────────────────

  /** 카드 글 (describeCard — "15번 핑크프릴 15,000원 — 등록할까요?") */
  describe(card: SuggestionCard): string {
    return this.#module?.describeCard(card) ?? ''
  }

  #find(id: string): SuggestionCard | undefined {
    return this.#snapshot.cards.find((card) => card.id === id && isOpen(card))
  }

  #replace(card: SuggestionCard): void {
    this.#set({ cards: this.#snapshot.cards.map((item) => (item.id === card.id ? card : item)) })
  }

  /** 빠른 입력칸의 Enter (칸이 비었을 때 맨 앞 카드). 카드 쪽이 처리했으면 true — 아니면 빠른 입력 그대로 */
  enter(line: string, context: { readonly wide: boolean; readonly dialogOpen: boolean; readonly composing?: boolean }): boolean {
    const snapshot = this.#snapshot
    const decision = decideVoiceEnter({
      line,
      cards: snapshot.cards,
      front: snapshot.front,
      now: this.#host.now(),
      wide: context.wide,
      dialogOpen: context.dialogOpen,
      ...(context.composing === undefined ? {} : { composing: context.composing }),
      editing: new Set(snapshot.forms.keys()),
    })
    if (decision.kind === 'quick') return false
    if (decision.kind === 'tooSoon') {
      this.#set({ tooSoon: true })
      return true
    }
    this.confirm(decision.card.id, 'enter')
    return true
  }

  /**
   * 카드 등록 (Enter·"등록"·자동 확정). 번호·가격이 없으면 등록하지 않고 그 카드의 고치기 칸을 연다(빈 칸에 커서).
   * 있으면 목록에서 빼고 등록 경로로 넘긴다 — 그 방송에 같은 번호가 있는지는 등록 경로가 차례 안에서 본다("고칠까요?").
   */
  confirm(id: string, source: RegisterSource): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    const result = module.confirmCard(card, { maxNumber: this.#host.maxNumber(), existingNumbers: [] })
    if (!result.ok) {
      if (source === 'auto') {
        // 자동 확정은 칸을 열지 않는다 — 그 카드의 자동 확정만 끈다 (등록하지 못한 카드를 다시 자동 확정하려고 하지 않는다)
        this.#replace({ ...card, autoConfirmAt: null })
        return
      }
      if (result.reason === 'NOT_OPEN' || result.reason === 'NUMBER_EXISTS') return
      this.openForm(id, { focus: result.reason === 'PRICE_MISSING' || result.reason === 'PRICE_TOO_LOW' ? 'price' : 'no', message: result.message })
      return
    }
    this.take(id)
    this.#set({ tooSoon: false })
    this.learnFrom(card, result.registration.name)
    this.#host.register(card, result.registration, source)
  }

  /** 목록에서 뺀다 (등록 경로·"고칠까요?"로 넘길 때) */
  take(id: string): SuggestionCard | undefined {
    const card = this.#find(id)
    if (card === undefined) return undefined
    this.#set({ cards: this.#snapshot.cards.filter((item) => item.id !== id) })
    return card
  }

  /** "닫기": 등록 없이 사라진다 */
  close(id: string): void {
    const card = this.take(id)
    if (card === undefined) return
    // 판매자가 닫은 번호는 음성을 끌 때까지 카드만 (D-V3-10)
    if (card.no !== null) this.#rejected.add(card.no)
    this.#dueCards.delete(id)
    this.#host.focusQuick()
  }

  /** 등록 되돌리기(5초 띠)를 한 번호 — 음성을 끌 때까지 카드만 (D-V3-10) */
  rejectNumber(no: number): void {
    this.#rejected.add(no)
    this.#pending.delete(no)
  }

  /** "자동 등록 멈추기" (= 손댐) */
  stopAuto(id: string): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    this.#replace(module.touchCard(card))
  }

  /** "고치기": 카드 안에 번호·품종·가격 칸 (손댐 — 자동 확정이 꺼진다). 이미 열려 있으면 친 값은 두고 커서·문장만 */
  openForm(id: string, options: { readonly focus?: FormField; readonly message?: string } = {}): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    const touched = card.touched && card.autoConfirmAt === null ? card : module.touchCard(card)
    const current = this.#snapshot.forms.get(id)
    const focus = options.focus ?? firstEmpty(card)
    const form: CardForm =
      current === undefined
        ? {
            no: card.no === null ? '' : String(card.no),
            name: card.name ?? '',
            price: card.price === null ? '' : formatWon(card.price),
            focus,
            message: options.message ?? null,
            version: 1,
          }
        : { ...current, focus, message: options.message ?? current.message, version: current.version + 1 }
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, form)
    this.#set({ forms, cards: this.#snapshot.cards.map((item) => (item.id === id ? touched : item)) })
  }

  editForm(id: string, patch: Partial<Pick<CardForm, 'no' | 'name' | 'price'>>): void {
    const current = this.#snapshot.forms.get(id)
    if (current === undefined) return
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, { ...current, ...patch })
    this.#set({ forms })
  }

  /** 고치기 칸의 Enter가 오류: 문장을 보이고 그 칸에 커서 */
  formProblem(id: string, message: string, focus: FormField): void {
    const current = this.#snapshot.forms.get(id)
    if (current === undefined) return
    const forms = new Map(this.#snapshot.forms)
    forms.set(id, { ...current, message, focus, version: current.version + 1 })
    this.#set({ forms })
  }

  /** 고치기 칸의 Esc: 칸만 닫는다 (카드는 남고 손댐 그대로) */
  closeForm(id: string): void {
    if (!this.#snapshot.forms.has(id)) return
    const forms = new Map(this.#snapshot.forms)
    forms.delete(id)
    this.#set({ forms })
    this.#host.focusQuick()
  }

  /**
   * 등록 경로에서 돌아온 카드를 다시 넣는다 (자동 확정인데 차례에서 같은 번호가 생김·저장하지 못함). 자동 확정은 끄고, 만든 순서 자리에 넣는다.
   */
  restore(card: SuggestionCard, options: { readonly note?: string; readonly touched?: boolean } = {}): void {
    if (card.no !== null && this.#pending.get(card.no)?.cardId === card.id) this.#pending.delete(card.no)
    if (this.#disposed || this.#snapshot.cards.some((item) => item.id === card.id)) return
    const back: SuggestionCard = { ...card, status: 'OPEN', autoConfirmAt: null, touched: card.touched || options.touched === true }
    const cards = [...this.#snapshot.cards]
    const at = cards.findIndex((item) => item.createdAt < back.createdAt)
    cards.splice(at === -1 ? cards.length : at, 0, back)
    const notes = new Map(this.#snapshot.notes)
    if (options.note !== undefined) notes.set(card.id, options.note)
    this.#set({ cards, notes })
  }

  // ── 자동 확정 설정 (D-I4-05) ───────────────────────────────────────

  setAutoConfirm(on: boolean): void {
    const current = this.#snapshot.settings
    if (current === null) return
    const settings: VoiceSettings = { ...current, 'voice.autoConfirm': on }
    this.#writeSettings(settings)
    // 끄면 기다리던 카드도 멈춘다 (다시 켜도 그 카드는 자동 확정하지 않는다)
    const cards = on ? this.#snapshot.cards : this.#snapshot.cards.map((card) => (card.autoConfirmAt === null ? card : { ...card, autoConfirmAt: null }))
    // 이력을 기다리며 미룬 문장도 마찬가지 — 켠 채 말했어도 끄면 자동 등록하지 않는다 (다시 켜도)
    if (!on && this.#module !== null && this.#phrase !== null && this.#module.nextTickAt(this.#phrase) !== null) this.#phraseAutoOff = true
    if (!on) this.#held = this.#held.map((held) => ({ ...held, settings: { ...held.settings, 'voice.autoConfirm': false } }))
    this.#set({ settings, cards, ...(on ? {} : { paused: new Map() }) })
  }

  /** "기다리는 시간(초)": 3~30 정수만 받는다 — 아니면 checkVoiceSettings 문장을 보이고 값은 그대로 */
  setSeconds(text: string): void {
    const module = this.#module
    const current = this.#snapshot.settings
    if (module === null || current === null) return
    const value = parseSecondsText(text)
    // 음성 패키지는 옛 키를 더 검사하지 않는다(D-V3-16) — V2 화면(바로 등록이 없는 곳)에서만 쓰는 칸이라 범위는 여기서 본다
    if (!Number.isSafeInteger(value) || value < 3 || value > 30) {
      this.#set({ secondsText: text, settingsProblem: SECONDS_PROBLEM })
      return
    }
    const settings: VoiceSettings = { ...current, 'voice.autoConfirmSec': value }
    this.#writeSettings(settings)
    this.#set({ settings, secondsText: text, settingsProblem: null })
  }

  /** 저장: 자동 확정 설정 + 조용한 시간(기본값이 아니면 같은 저장값에 `voice.quietMs`, D-V2-09) */
  #writeSettings(settings: VoiceSettings, quietMs: number = this.#snapshot.quietMs): void {
    // 바로 등록 칸은 화면 상태(instant)가 정한다 — 패키지가 채운 값은 빼고 아래에서 끈 때만 남긴다
    const { [INSTANT_KEY]: _stored, ...plain } = settings as VoiceSettings & Record<string, unknown>
    const base: VoiceSettings & { readonly 'voice.quietMs'?: number } = quietMs === 1800 ? (plain as VoiceSettings) : { ...(plain as VoiceSettings), 'voice.quietMs': quietMs }
    // 바로 등록은 끈 때만 남긴다 (기본 켬, V3). 기록 모아 두기는 그 기기 기본(연습 켬·운영 끔)과 다를 때만 (D-V3-56)
    const instant = this.#snapshot.instant ? base : { ...base, [INSTANT_KEY]: false }
    const archived = this.#snapshot.archive === readArchive(null) ? instant : { ...instant, [ARCHIVE_KEY]: this.#snapshot.archive }
    // 멈춤 지킴이 시간(조정용 저장값)은 있던 값을 그대로 둔다
    const value = this.#stallMs === null ? archived : { ...archived, [STALL_KEY]: this.#stallMs }
    this.#host.writeSettings(value)
  }

  /** "말이 끝났다고 볼 때까지(초)": 1.0~4.0, 0.1초 단위 — 아니면 문장을 보이고 값은 그대로 (AC-V2-16) */
  setQuietSeconds(text: string): void {
    const module = this.#module
    const settings = this.#snapshot.settings
    if (module === null || settings === null) return
    const trimmed = text.trim().replace(',', '.')
    const sec = trimmed === '' || !/^\d+(\.\d+)?$/.test(trimmed) ? Number.NaN : Number(trimmed)
    const ms = module.quietSecToMs(sec)
    if (ms === null) {
      const problems = module.checkVoiceSettings({ [module.QUIET_MS_KEY]: Number.isFinite(sec) ? sec * 1000 : sec })
      this.#set({ quietText: text, quietProblem: problems[0]?.message ?? '말이 끝났다고 볼 때까지는 1.0초부터 4.0초까지 0.1초 단위로 정해 주세요' })
      return
    }
    this.#writeSettings(settings, ms)
    if (this.#phrase !== null) this.#phrase = { ...this.#phrase, quietMs: ms }
    this.#set({ quietMs: ms, quietText: text, quietProblem: null })
    if (this.#phase() === 'on') this.#armPhrase(module)
  }

  // ── 후보·배운 별칭 (D-V2-01·D-V2-10) ────────────────────────────────

  /** 후보 단추: 카드 품종을 그 이름으로 (손댄 카드), 그 말을 배운다 (AC-V2-07·09) */
  chooseCandidate(id: string, name: string): void {
    const module = this.#module
    const card = this.#find(id)
    if (module === null || card === undefined) return
    const candidate = this.#snapshot.info.get(id)?.candidates.find((item) => item.name === name)
    if (candidate === undefined) return
    const edited = module.editCard(card, { name })
    if (!edited.ok) return
    this.#learn(module, candidate.heard, name)
    const info = new Map(this.#snapshot.info)
    info.set(id, { candidates: [], ask: module.askFor(edited.card) })
    this.#windows.set(id, candidate.heard)
    const forms = this.#snapshot.forms.get(id)
    const formPatch = forms === undefined ? {} : { forms: new Map(this.#snapshot.forms).set(id, { ...forms, name }) }
    this.#set({ cards: this.#snapshot.cards.map((item) => (item.id === id ? edited.card : item)), info, ...formPatch })
  }

  /** 1·2·3 키로 후보를 고를 카드 (U-V2-05): 가장 새 열린 카드이고 품종이 비고 후보가 있을 때만 */
  keyCandidateCard(): string | null {
    let newest: SuggestionCard | null = null
    for (const card of this.#snapshot.cards) if (isOpen(card) && (newest === null || card.createdAt > newest.createdAt)) newest = card
    if (newest === null || (newest.name !== null && newest.nameNeedsCheck !== true)) return null
    return (this.#snapshot.info.get(newest.id)?.candidates.length ?? 0) > 0 ? newest.id : null
  }

  /** 1·2·3 키: 그 카드의 n번째 후보를 누른 것과 같다. 골랐으면 true */
  chooseCandidateByKey(index: number): boolean {
    const id = this.keyCandidateCard()
    if (id === null || this.#snapshot.forms.size > 0) return false
    const candidate = this.#snapshot.info.get(id)?.candidates[index]
    if (candidate === undefined || index > 2) return false
    this.chooseCandidate(id, candidate.name)
    return true
  }

  /**
   * 판매자가 등록한 카드의 품종이 들은 창 글과 다르면 배운다 (고치기 칸에 품종을 적어 확정·품종을 그대로 두고 등록, D-V2-10).
   * 콘솔의 고치기 칸 등록도 부른다. 배울 수 없는 말(1음절·막는 낱말·같은 이름)은 배우지 않는다
   */
  learnFrom(card: SuggestionCard, name: string): void {
    const module = this.#module
    const heard = this.#windows.get(card.id)
    this.#windows.delete(card.id)
    if (module === null || heard === undefined || name === '') return
    this.#learn(module, heard, name)
  }

  #learn(module: VoiceModule, heard: string, name: string): void {
    if (!module.canLearnAlias(heard, name)) return
    this.#learned = module.learnAlias(this.#learned, { heard, name, at: this.#host.now() })
    this.#saveLearned()
    this.#set({ learnedCount: this.#learned.length })
  }

  /** 기록 창의 [배운 품종 이름 지우기] */
  clearLearned(): void {
    this.#learned = []
    this.#saveLearned()
    this.#set({ learnedCount: 0 })
  }

  // ── 음성 기록 (D-V2-08) ─────────────────────────────────────────────

  /** 기록 창의 줄 (새것부터) — 시각은 그 기기 시간대 */
  logLines(): readonly VoiceLogLine[] {
    const module = this.#module
    if (module === null) return []
    return this.#snapshot.log.map((entry, index) => ({
      key: `${String(entry.at)}-${String(this.#snapshot.log.length - index)}`,
      time: module.formatLogTime(entry.at, -new Date(entry.at).getTimezoneOffset()),
      pieces: entry.pieces.map((piece) => module.describePiece(piece)),
      read: entry.read === null ? null : module.describeReading(entry.read),
      candidates: entry.read === null ? '' : module.describeCandidates(entry.read.candidates),
      action: module.VOICE_LOG_ACTION_LABELS[entry.action],
      reason: entry.reason,
    }))
  }

  /** [기록 지우기] */
  clearLog(): void {
    this.#set({ log: [] })
  }

  /** 카드의 후보·안내 */
  cardInfo(id: string): CardInfo | null {
    return this.#snapshot.info.get(id) ?? null
  }

  // ── 방금 등록한 상품 (D-V2-06 3) ────────────────────────────────────

  /** 콘솔이 음성 카드 등록이 저장됐다고 알린다 (등록 5초 되돌리기는 지금부터) */
  noteVoiceRegistered(entry: { readonly id: string; readonly no: number; readonly name: string; readonly price: number }): void {
    const now = this.#host.now()
    this.#pruneRecent(now)
    this.#recent = [...this.#recent.filter((item) => item.id !== entry.id), { ...entry, registeredAt: now, undoUntil: now + REGISTER_UNDO_MS }]
    this.#touchVoice(entry.no, 'register')
    const pending = this.#pending.get(entry.no)
    if (pending !== undefined) {
      this.#pending.set(entry.no, { ...pending, key: entry.id, at: now })
      this.#afterRegistered(entry.no, entry.id)
    }
  }

  #findOffer(id: string): VoiceOffer | undefined {
    return this.#snapshot.offers.find((offer) => offer.id === id)
  }

  #replaceOffer(id: string, patch: Partial<VoiceOffer>): void {
    this.#set({ offers: this.#snapshot.offers.map((offer) => (offer.id === id ? { ...offer, ...patch } : offer)) })
  }

  /** [그대로 두기]·[닫기]: 아무것도 바꾸지 않는다 */
  dismissOffer(id: string): void {
    const offer = this.#findOffer(id)
    if (offer === undefined) return
    // 묻기 카드의 "그대로 두기" — 그 번호는 음성을 끌 때까지 바로 고치지 않는다 (D-V3-10)
    if (offer.kind === 'offer' && offer.stage === 'ask') this.#rejectOffer(offer)
    this.#set({ offers: this.#snapshot.offers.filter((offer) => offer.id !== id) })
    this.#host.focusQuick()
  }

  /** 카드 위 고칠까요의 [고치기] (D-V2-19): 그 카드를 고친다 — 자동 확정은 없다(손댄 카드) */
  fixCardOffer(id: string): void {
    const offer = this.#findOffer(id)
    const module = this.#module
    if (offer === undefined || offer.kind !== 'card' || module === null) return
    const offers = this.#snapshot.offers.filter((item) => item.id !== id)
    const card = this.#find(offer.registrationId)
    if (card === undefined || offer.cardChanges === undefined) {
      this.#set({ offers })
      return
    }
    const edited = module.editCard(card, offer.cardChanges, { maxNumber: this.#host.maxNumber() })
    if (!edited.ok) {
      this.#replaceOffer(id, { error: edited.message })
      return
    }
    const next: SuggestionCard = module.touchCard(offer.cardNameCheck === true ? { ...edited.card, nameNeedsCheck: true } : edited.card)
    const notes = new Map(this.#snapshot.notes)
    if (offer.cardNote !== undefined) notes.set(card.id, offer.cardNote)
    const info = new Map(this.#snapshot.info)
    const before = info.get(card.id)
    info.set(card.id, { candidates: next.name === null ? (before?.candidates ?? []) : [], ask: module.askFor(next) })
    this.#set({ offers, notes, info, cards: this.#snapshot.cards.map((item) => (item.id === card.id ? next : item)) })
  }

  /** 이 카드 위에 보일 고칠까요 (D-V2-19) */
  cardOffer(cardId: string): VoiceOffer | undefined {
    return this.#snapshot.offers.find((offer) => offer.kind === 'card' && offer.registrationId === cardId)
  }

  /** [고치기]: 손 고치기와 같은 상품 고치기, 고친 뒤 10초 [되돌리기] */
  async fixOffer(id: string): Promise<void> {
    const offer = this.#findOffer(id)
    const fix = this.#host.fixRecent
    if (offer === undefined || offer.kind !== 'offer' || offer.stage !== 'ask' || fix === undefined) return
    this.#replaceOffer(id, { stage: 'busy', error: null })
    const fixRequest = this.#requestId()
    let outcome: RecentFixOutcome
    try {
      // 다른 화분일 수 있는 카드의 [새 가격으로 바꾸기]는 손 고치기 NEW_ONLY (D-V3-59)
      // 그 카드를 만든 조각 글로 기록 (RA-V3-004)
      const heardLog = offer.voiceHeard === undefined ? null : this.voiceLogFor(offer.voiceHeard)
      outcome = await fix(offer.registrationId, offer.changes, { ...(offer.maybeOther === true ? { newOnly: true } : {}), requestId: fixRequest, ...(heardLog === null ? {} : { voiceLog: heardLog }) })
    } catch {
      outcome = { kind: 'failed', message: OFFER_FIX_FAILED }
    }
    if (this.#disposed) return
    if (outcome.kind === 'dialog') {
      this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== id) })
      return
    }
    if (outcome.kind === 'failed') {
      this.#replaceOffer(id, { stage: 'ask', error: outcome.message })
      return
    }
    this.#recent = this.#recent.map((item) => (item.id === offer.registrationId ? { ...item, ...offer.changes } : item))
    const module = this.#module
    const offerTime = module?.OFFER_UNDO_MS ?? 10_000
    this.#replaceOffer(id, { stage: 'fixed', before: outcome.before, undoUntil: this.#host.now() + offerTime, message: OFFER_FIXED, error: null, voiceRequestId: fixRequest, ...(offer.voiceHeard === undefined ? {} : { voiceHeard: offer.voiceHeard }) })
  }

  /** 다른 화분일 수 있는 카드의 [아까 것을 다른 번호로]: 그 상품을 손으로 고치는 창 (D-V3-59) */
  renumberOffer(id: string): void {
    const offer = this.#findOffer(id)
    if (offer === undefined || offer.maybeOther !== true) return
    this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== id) })
    this.#host.openProduct?.(offer.registrationId)
  }

  /** 고친 뒤 [되돌리기]: 앞 값으로 같은 고치기 */
  async revertOffer(id: string): Promise<void> {
    const offer = this.#findOffer(id)
    if (offer?.renumber !== undefined) {
      await this.#revertRenumber(offer)
      return
    }
    const fix = this.#host.fixRecent
    if (offer === undefined || offer.stage !== 'fixed' || offer.before === null || fix === undefined) return
    if (offer.undoUntil !== null && this.#host.now() > offer.undoUntil) return
    const before = offer.before
    this.#replaceOffer(id, { stage: 'busy', error: null })
    let outcome: RecentFixOutcome
    try {
      // 음성으로 바로 고친 것을 되돌릴 때도 창 없이 (D-V3-57)
      const undoLog = offer.voiceRequestId === undefined ? null : this.voiceLogFor(offer.voiceHeard ?? '', offer.voiceRequestId)
      // 되돌리기는 그사이 생긴 입금 전 찜도 원래 가격으로 (UNPAID_CLAIMS, RA-V3-003)
      outcome = await fix(offer.registrationId, before, { ...(offer.no === undefined ? {} : { applyTo: 'UNPAID_CLAIMS' }), ...(undoLog === null ? {} : { voiceLog: undoLog }) })
    } catch {
      outcome = { kind: 'failed', message: OFFER_FIX_FAILED }
    }
    if (this.#disposed) return
    if (outcome.kind === 'failed') {
      this.#replaceOffer(id, { stage: 'fixed', error: outcome.message })
      return
    }
    this.#recent = this.#recent.map((item) => (item.id === offer.registrationId ? { ...item, ...before } : item))
    this.#rejectOffer(offer)
    this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== id) })
  }

  /** "되돌릴까요?"의 [되돌리기]: 지금의 등록 5초 되돌리기 */
  undoOffer(id: string): void {
    const offer = this.#findOffer(id)
    if (offer === undefined || offer.kind !== 'undo') return
    const done = this.#host.undoRecent?.(offer.registrationId) === true
    if (!done) {
      this.#set({ offers: this.#snapshot.offers.map((item) => (item.id === id ? { ...item, kind: 'late', message: OFFER_UNDO_FAILED } : item)) })
      return
    }
    this.#rejectOffer(offer)
    this.#recent = this.#recent.filter((item) => item.id !== offer.registrationId)
    this.#set({ offers: this.#snapshot.offers.filter((item) => item.id !== id) })
  }

  /** 그 고칠까요·되돌리기의 번호를 거절한 번호로 (D-V3-10) */
  #rejectOffer(offer: VoiceOffer): void {
    const no = offer.no ?? this.#recent.find((item) => item.id === offer.registrationId)?.no
    if (no !== undefined) this.#rejected.add(no)
  }

  // ── 시각·자동 확정 (D-204, D-I4-05) ────────────────────────────────

  /** 창이 닫혔거나 상품이 바뀌었을 때·기다림이 끝났을 때: 자동 확정을 다시 본다 */
  refresh(): void {
    if (this.#disposed) return
    this.#autoConfirm()
    this.#expireWaiting()
    this.#runDue()
    this.#smsAuto()
    // 맨 앞 카드의 "Enter 등록"이 보이면 "새 카드가 방금 나왔어요…"는 할 일을 다 했다
    const now = this.#host.now()
    const tooSoon = this.#snapshot.tooSoon && !enterReady(this.#snapshot.front, now)
    // 결과 한 줄은 4초, 고친 뒤 [되돌리기]는 10초까지 (D-V2-07·D-V2-06 3)
    let readout = this.#snapshot.readout !== null && this.#snapshot.readout.until <= now ? null : this.#snapshot.readout
    if (readout === null) {
      const next = this.#readoutQueue.shift()
      if (next !== undefined) readout = { ...next, until: now + READOUT_MS }
    }
    const offers = this.#snapshot.offers.some((offer) => offer.stage === 'fixed' && offer.undoUntil !== null && offer.undoUntil <= now)
      ? this.#snapshot.offers.filter((offer) => !(offer.stage === 'fixed' && offer.undoUntil !== null && offer.undoUntil <= now))
      : this.#snapshot.offers
    this.#set({ tooSoon, readout, offers })
  }

  /**
   * 기다림이 끝난 카드를 모두 등록한다. decideAutoConfirm은 한 번에 하나(기다림이 가장 먼저 끝난 것)를 고르므로 등록한 뒤 남은 카드를 다시 본다 —
   * 기다림이 같은 순간에 끝난 카드 둘도 그 순간에 함께 등록된다(AC-I4-31). 한 카드는 등록 경로에 한 번만 넘긴다(confirm이 목록에서 빼거나 자동 확정을 끈다).
   */
  #autoConfirm(): void {
    const tried = new Set<string>()
    for (;;) {
      const auto = this.#decideAuto()
      if (auto === null) return
      const { decision, products } = auto
      if (decision.blocked.length > 0) {
        // 그 순간 번호가 있으면 등록하지 않고 카드에 "고칠까요?" — 창은 띄우지 않는다 (D-I4-05)
        const notes = new Map(this.#snapshot.notes)
        for (const card of decision.blocked) if (card.no !== null) notes.set(card.id, editQuestion(card.no, products.get(card.no) === true))
        this.#set({ cards: decision.cards, notes })
      }
      const due = decision.due
      if (due === null || tried.has(due.id)) return
      tried.add(due.id)
      this.confirm(due.id, 'auto')
    }
  }

  /** 지금 자동 확정 판단 (음성 모듈·설정·카드가 없으면 null) */
  #decideAuto(): { readonly decision: AutoConfirmDecision; readonly products: ReadonlyMap<number, boolean> } | null {
    const module = this.#module
    const snapshot = this.#snapshot
    if (module === null || snapshot.settings === null || snapshot.cards.length === 0) return null
    const products = this.#host.products()
    const decision = decideAutoConfirm(
      {
        cards: snapshot.cards,
        settings: snapshot.settings,
        now: this.#host.now(),
        existingNumbers: new Set(products.keys()),
        voiceOn: snapshot.phase === 'on',
        dialogOpen: this.#host.dialogOpen(),
      },
      module.checkAutoConfirm,
    )
    return { decision, products }
  }

  /**
   * 기다림이 이미 끝난 카드가 있으면 그 판단: 'now' = 바로 다시 볼 것(등록하거나 "고칠까요?"), 'deferred' = 창이 열려 미룸, 없으면 null.
   * nextWake는 앞으로 올 시각만 보므로, 다시 보기 전에 다른 일(인식 결과 등)로 타이머를 다시 잡아도 기다림이 끝난 카드를 놓치지 않게 따로 본다.
   */
  #ripeAuto(): 'now' | 'deferred' | null {
    const now = this.#snapshot.now
    if (!this.#snapshot.cards.some((card) => isOpen(card) && card.autoConfirmAt !== null && card.autoConfirmAt <= now)) return null
    const decision = this.#decideAuto()?.decision
    if (decision === undefined) return null
    if (decision.deferred) return 'deferred'
    return decision.due !== null || decision.blocked.length > 0 ? 'now' : null
  }

  // ── 문자찜 카드 (VOC-04 문자찜 카드, ORD-08 AC9, D-V1-03~07) ───────────

  /** 카드 글 (describeSmsCard — 옵션 방식이면 상품 이름 포함) */
  describeSms(card: SmsCard): string {
    const module = this.#module
    if (module === null) return ''
    const name = this.#host.smsProductName
    return module.describeSmsCard(card, name === undefined ? {} : { productName: (no) => name(no) })
  }

  /** 문자찜 화면 문장 (음성 패키지의 따옴표 문장 그대로 — 화면 파일은 패키지 값을 직접 부르지 않는다, AC-I4-04). 받기 전엔 null */
  smsWords(): SmsWords | null {
    const module = this.#module
    if (module === null) return null
    return { labels: module.SMS_LABELS, listening: module.SMS_LISTENING, repeat: module.SMS_REPEAT_NOTE, timeCheck: module.SMS_TIME_CHECK, choose: module.smsChooseMessage }
  }

  /** 남은 초 글 ("3초 뒤 넣어요"), 기다리지 않으면 null */
  smsCountdown(entry: SmsEntry): string | null {
    if (entry.reason !== null || entry.sending || this.#snapshot.phase !== 'on') return null
    return this.#module?.smsCountdownText(entry.card, this.#snapshot.now) ?? null
  }

  #readTime(time: string, now: number): { readonly value: string; readonly late: boolean } | null {
    const read = this.#host.readSmsTime
    if (read === undefined) return null
    try {
      return read(time, now)
    } catch {
      return null
    }
  }

  #smsProduct(no: number): SmsProductView | null {
    try {
      return this.#host.smsProduct?.(no) ?? null
    } catch {
      return null
    }
  }

  #findSms(id: string): SmsEntry | undefined {
    return this.#snapshot.sms.find((entry) => entry.card.id === id)
  }

  #replaceSms(id: string, change: (entry: SmsEntry) => SmsEntry): void {
    this.#set({ sms: this.#snapshot.sms.map((entry) => (entry.card.id === id ? change(entry) : entry)) })
  }

  /** "넣지 않기"·이유 카드의 "닫기": 아무것도 보내지 않고 닫는다 (같은 말 검사에는 10초 남는다) */
  smsSkip(id: string): void {
    const module = this.#module
    const entry = this.#findSms(id)
    if (module === null || entry === undefined || entry.sending || entry.card.status !== 'OPEN') return
    this.#replaceSms(id, (item) => ({ ...item, card: module.closeSmsCard(item.card) }))
    this.#host.focusQuick()
  }

  /**
   * Esc가 닫을 카드 (D-V1-20): 맨 앞(가장 새) 기다리는 문자찜 카드 — 열림·저절로 넣기를 기다림·이유 없음·보내는 중 아님·고르기 아님. 없으면 null
   */
  smsEscTarget(): string | null {
    if (this.#snapshot.phase !== 'on') return null
    let best: SmsEntry | null = null
    for (const entry of this.#snapshot.sms) {
      const { card } = entry
      if (card.status !== 'OPEN' || card.autoAt === null || card.candidates !== null || entry.reason !== null || entry.sending || entry.hidden) continue
      if (best === null || card.createdAt > best.card.createdAt) best = entry
    }
    return best?.card.id ?? null
  }

  /** Esc = 맨 앞 기다리는 문자찜 카드의 "넣지 않기" (쓰기 없음, D-V1-20). 닫았으면 true */
  smsEscape(): boolean {
    const id = this.smsEscTarget()
    if (id === null) return false
    this.smsSkip(id)
    return true
  }

  /** 화면에 음성 문자찜 결과 카드가 열려 있다 (Ctrl+Z 알림, D-V1-22) */
  smsResultShown(): boolean {
    return this.#snapshot.sms.some((entry) => entry.card.status === 'SENT' && smsShown(entry))
  }

  /** 저절로 닫힌 문자찜 카드 안내의 "확인": 안내만 지운다 */
  smsDroppedSeen(id: string): void {
    if (!this.#snapshot.smsDropped.some((item) => item.id === id)) return
    this.#set({ smsDropped: this.#snapshot.smsDropped.filter((item) => item.id !== id) })
  }

  /** 결과 카드의 "닫기": 화면에서만 뺀다 (찜은 그대로) */
  smsDismiss(id: string): void {
    const entry = this.#findSms(id)
    if (entry === undefined || entry.sending || entry.card.status !== 'SENT') return
    this.#replaceSms(id, (item) => ({ ...item, hidden: true }))
    this.#host.focusQuick()
  }

  /** "지금 넣기"·"넣기" */
  smsSend(id: string): void {
    void this.#sendSms(id, { kind: 'auto' })
  }

  /** 고르기 카드의 후보 누르기 → 그 구매자로 넣기 (AC-V1-25) */
  smsChoose(id: string, buyer: string): void {
    void this.#sendSms(id, { kind: 'buyer', buyer })
  }

  /**
   * 고르기 카드의 "새 손님으로 넣기" (D-V1-14, AC-V1-25): 끝자리 + newBuyer로 넣는다(후보를 찾지 않고 새 문자 구매자).
   * 주문이 여럿이면 첫 주문이 만든 구매자로 나머지를 넣는다 — 주문마다 새 손님이 생기지 않게
   */
  smsNewBuyer(id: string): void {
    void this.#sendSms(id, { kind: 'new' })
  }

  /** 넣기: 주문마다 `sms` 쓰기 한 번 (요청 번호는 주문마다 다르고, 다시 보낼 때는 같다). 409면 고르기, 실패면 다시 열기(저절로 넣지 않음) */
  async #sendSms(id: string, choice: SmsChoice): Promise<void> {
    const module = this.#module
    const entry = this.#findSms(id)
    const write = this.#host.writeSms
    if (module === null || entry === undefined || write === undefined || entry.sending || entry.reason !== null) return
    const fresh = choice.kind === 'new'
    // 새 손님: 고르기 카드에서 끝자리가 있을 때만. 카드 규칙(sendSmsCard)은 후보 없이 끝자리로 넣는 쓰기를 만들고, 후보는 카드에 남긴다(실패하면 다시 고른다)
    if (fresh && (entry.card.candidates === null || entry.card.reading.last4 === null)) return
    const sent = module.sendSmsCard(fresh ? { ...entry.card, candidates: null } : entry.card, {
      product: (no) => this.#smsProduct(no),
      ...(choice.kind === 'buyer' ? { buyer: choice.buyer } : {}),
    })
    const result = fresh && sent.ok ? { ...sent, card: { ...sent.card, candidates: entry.card.candidates } } : sent
    if (!result.ok) {
      if (result.reason === 'NOT_OPEN') return
      // 문제·넣을 수 없는 상품(넣기 직전에 판매 종료 등)은 이유 카드로, 고르기 문제는 카드에 문장만 (D-V1-07)
      if (result.reason === 'PROBLEM' || result.reason === 'PRODUCT') this.#replaceSms(id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: result.message, error: null }))
      else this.#replaceSms(id, (item) => ({ ...item, error: result.message }))
      return
    }
    // 받은 시각: 손 입력과 같은 읽기로 지금 다시 읽는다 (보내는 때의 지금 기준)
    const writes = result.writes
    const received: (string | null)[] = []
    for (const one of writes) {
      if (one.time === null) {
        received.push(null)
        continue
      }
      const time = this.#readTime(one.time, this.#host.now())
      if (time === null) {
        this.#replaceSms(id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: module.SMS_PROBLEM_MESSAGES.TIME_UNCLEAR }))
        return
      }
      received.push(time.value)
    }
    // 넣기 방법(그대로·고른 구매자·새 손님)이 바뀌면 새 요청 번호 (본문이 달라졌다). 같은 방법으로 다시 보내면 같은 번호 — 응답만 잃은 쓰기가 두 번 기록되지 않는다
    if (!this.#smsRequests.has(id) || this.#smsChoices.get(id) !== choiceKey(choice)) {
      this.#smsRequests.set(id, writes.map(() => this.#requestId()))
      this.#smsChoices.set(id, choiceKey(choice))
    }
    const requests = this.#smsRequests.get(id) as string[]
    this.#replaceSms(id, (item) => ({ ...item, card: result.card, sending: true, error: null }))
    this.#host.focusQuick()
    const done = new Set(entry.results.map((line) => line.no))
    // 새 손님: 이미 넣은 주문이 정한 구매자가 있으면 그 구매자로 (첫 주문만 newBuyer)
    let made: string | null = fresh ? (entry.results.find((line) => line.buyer !== null)?.buyer ?? null) : null
    for (const [index, card] of writes.entries()) {
      if (done.has(card.no)) continue
      let one: VoiceSmsWrite = card
      if (fresh) {
        const { last4, ...rest } = card
        one = made !== null ? { ...rest, buyer: made } : last4 === undefined ? card : { ...rest, last4, newBuyer: true }
      }
      let outcome: SmsWriteOutcome
      try {
        outcome = await write(one, received[index] ?? null, requests[index] ?? this.#requestId())
      } catch {
        outcome = { kind: 'failed', message: SMS_SEND_FAILED }
      }
      if (this.#disposed) return
      if (outcome.kind === 'ok') {
        if (fresh && made === null) made = outcome.buyer
        const line: SmsResultLine = { no: one.no, seq: outcome.seq, buyer: outcome.buyer }
        this.#replaceSms(id, (item) => ({ ...item, results: [...item.results, line] }))
        continue
      }
      if (outcome.kind === 'repeated') {
        // 다른 기기가 방금 같은 말을 넣었다 — 이유 카드("닫기"만), 다시 넣지 않는다 (AC-V1-31, D-V1-13)
        this.#smsRequests.delete(id)
        this.#smsChoices.delete(id)
        this.#replaceSms(id, (item) => ({ ...item, card: module.reopenSmsCard(item.card), sending: false, error: null, reason: outcome.message === '' ? SMS_VOICE_REPEATED : outcome.message }))
        return
      }
      if (outcome.kind === 'ambiguous') {
        this.#replaceSms(id, (item) => ({ ...item, card: module.chooseSmsBuyer(item.card, outcome.candidates), sending: false, choose: outcome.message ?? null }))
        return
      }
      this.#replaceSms(id, (item) => ({ ...item, card: module.reopenSmsCard(item.card), sending: false, error: outcome.message }))
      return
    }
    this.#smsRequests.delete(id)
    this.#smsChoices.delete(id)
    this.#replaceSms(id, (item) => ({ ...item, sending: false }))
  }

  #requestId(): string {
    const make = this.#host.newRequestId
    if (make !== undefined) return make()
    return `voice-sms-${String(this.#host.now())}-${String(this.#nextCard++)}`
  }

  /**
   * 기다림이 끝난 문자찜 카드를 넣는다 (D-V1-05): 열림·주문 하나·문제 없음·손대지 않음·고르기 아님·받을 수 있는 상품·말한 시각이 늦지 않음·창 없음·음성 켜짐.
   * 넣을 수 없는 상품이 되었으면 이유 카드로 바꾼다. 창이 열려 있으면 그대로 두고 닫힌 뒤 다시 본다.
   */
  #smsAuto(): void {
    const module = this.#module
    if (module === null) return
    // 콘솔 밖에서는 저절로 넣지 않는다 — 콘솔을 열면 넣는다 (D-V3-52)
    if (this.#host.smsAutoAllowed?.() === false) return
    const now = this.#host.now()
    const voiceOn = this.#snapshot.phase === 'on'
    let dialogOpen: boolean | null = null
    for (const entry of this.#snapshot.sms) {
      if (entry.card.status !== 'OPEN' || entry.card.autoAt === null || entry.reason !== null || entry.sending) continue
      if (voiceOn && entry.card.autoAt > now) continue
      dialogOpen ??= this.#host.dialogOpen()
      const time = entry.card.reading.time
      const read = time === null ? null : this.#readTime(time, now)
      const decision = module.checkSmsAuto(entry.card, {
        now,
        voiceOn,
        dialogOpen,
        product: (no) => this.#smsProduct(no),
        timeAfterNow: read !== null && read.late,
      })
      if (decision.due) {
        void this.#sendSms(entry.card.id, { kind: 'auto' })
        continue
      }
      const block = decision.block
      if (block !== null) {
        this.#replaceSms(entry.card.id, (item) => ({ ...item, card: module.stopSmsAuto(item.card), reason: module.smsBlockMessage(block.no, block.block) }))
        continue
      }
      if (decision.card !== entry.card) {
        const timeCheck = time !== null && read !== null && read.late
        this.#replaceSms(entry.card.id, (item) => ({ ...item, card: decision.card, timeCheck: item.timeCheck || timeCheck }))
      }
    }
  }

  /** 기다림이 끝난 문자찜 카드가 있으면 'now'(창이 없음)·'deferred'(창이 열림), 없으면 null */
  #ripeSms(): 'now' | 'deferred' | null {
    const now = this.#snapshot.now
    const ripe = this.#snapshot.sms.some((entry) => entry.card.status === 'OPEN' && entry.card.autoAt !== null && entry.card.autoAt <= now && entry.reason === null && !entry.sending)
    if (!ripe) return null
    return this.#snapshot.phase === 'on' && this.#host.dialogOpen() ? 'deferred' : 'now'
  }

  /** 다음 남은 초 글자가 바뀌는 때까지 (기다리는 문자찜 카드가 없으면 null) */
  #smsWake(): number | null {
    const now = this.#snapshot.now
    let next = Number.POSITIVE_INFINITY
    for (const entry of this.#snapshot.sms) {
      const at = entry.card.autoAt
      if (entry.card.status !== 'OPEN' || at === null || at <= now || entry.reason !== null || entry.sending) continue
      const left = Math.ceil((at - now) / 1000)
      next = Math.min(next, at - (left - 1) * 1000)
    }
    return Number.isFinite(next) ? Math.max(0, next - now) : null
  }

  // ── 문자찜 설정 (D-V1-05·09 — 그 기기에 저장) ─────────────────────────

  /** "문자찜도 듣기" — 끄면 다음 문장부터 문자찜 카드를 만들지 않는다 (있던 카드는 그대로) */
  setSmsListen(on: boolean): void {
    const current = this.#snapshot.smsSettings
    if (current === null) return
    const smsSettings: SmsVoiceSettings = { ...current, 'voice.smsListen': on }
    this.#host.writeSmsSettings?.(smsSettings)
    this.#held = this.#held.map((held) => ({ ...held, smsSettings: held.smsSettings === null ? null : { ...held.smsSettings, 'voice.smsListen': on && held.smsSettings['voice.smsListen'] } }))
    this.#set({ smsSettings })
  }

  /** "문자찜 자동으로 넣기까지(초)": 0~10 정수만 받는다 — 아니면 checkSmsSettings 문장을 보이고 값은 그대로 */
  setSmsSeconds(text: string): void {
    const module = this.#module
    const current = this.#snapshot.smsSettings
    if (module === null || current === null) return
    const value = parseSecondsText(text)
    const problems = module.checkSmsSettings({ 'voice.smsAutoSec': value })
    if (problems.length > 0) {
      this.#set({ smsSecondsText: text, smsSettingsProblem: problems[0]?.message ?? null })
      return
    }
    const smsSettings: SmsVoiceSettings = { ...current, 'voice.smsAutoSec': value }
    this.#host.writeSmsSettings?.(smsSettings)
    this.#set({ smsSettings, smsSecondsText: text, smsSettingsProblem: null })
  }

  #set(patch: Partial<VoiceSnapshot>): void {
    if (this.#disposed) return
    const now = this.#host.now()
    // 큰 글자 칸 안내가 보이는 동안 다른 안내가 오면 차례로 (D-V3-61)
    const shown = this.#snapshot.readout
    if (this.#instantHost() && patch.readout !== undefined && patch.readout !== null && shown !== null && shown.until > now && shown.text !== patch.readout.text && patch.readout !== shown) {
      if (!this.#readoutQueue.some((item) => item.text === patch.readout?.text)) this.#readoutQueue.push({ text: patch.readout.text, discarded: patch.readout.discarded })
      const { readout: _queued, ...rest } = patch
      patch = rest
    }
    let next: VoiceSnapshot = { ...this.#snapshot, ...patch, now }
    if (this.#lostFlushed.length > 0) {
      next = { ...next, flushedClosed: [...next.flushedClosed, ...this.#lostFlushed] }
      this.#lostFlushed = []
    }
    if (patch.cards !== undefined) {
      const front = nextFront(this.#snapshot.front, next.cards, now)
      // 사라진 카드의 칸·문장은 버린다
      const ids = new Set(next.cards.map((card) => card.id))
      const forms = [...next.forms.keys()].some((id) => !ids.has(id)) ? new Map([...next.forms].filter(([id]) => ids.has(id))) : next.forms
      const notes = [...next.notes.keys()].some((id) => !ids.has(id)) ? new Map([...next.notes].filter(([id]) => ids.has(id))) : next.notes
      const info = [...next.info.keys()].some((id) => !ids.has(id)) ? new Map([...next.info].filter(([id]) => ids.has(id))) : next.info
      const paused = [...next.paused.keys()].some((id) => !ids.has(id)) ? new Map([...next.paused].filter(([id]) => ids.has(id))) : next.paused
      const tooSoon = next.tooSoon && front !== null && front.id === this.#snapshot.front?.id
      next = { ...next, front, forms, notes, info, paused, tooSoon }
      // 등록 때 배우려고 들고 있는 창 글은 넉넉히 두되 끝없이 쌓이지 않게
      if (this.#windows.size > 200) for (const id of [...this.#windows.keys()].slice(0, this.#windows.size - 200)) this.#windows.delete(id)
    }
    if (patch.sms !== undefined) next = { ...next, sms: pruneSms(next.sms, now) }
    this.#snapshot = next
    this.#schedule()
    for (const listener of [...this.#listeners]) listener()
  }

  #schedule(): void {
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    if (this.#disposed) return
    const now = this.#snapshot.now
    const later = (at: number | null): number | null => (at === null || at <= now ? null : at - now)
    const offerEnds = this.#snapshot.offers.map((offer) => (offer.stage === 'fixed' ? later(offer.undoUntil) : null))
    const waitingEnd = this.#waiting === null ? null : later(this.#waiting.since + 60_001)
    const wakes = [nextWake(this.#snapshot.cards, this.#snapshot.front, now), this.#smsWake(), later(this.#snapshot.readout?.until ?? null), waitingEnd, ...offerEnds].filter(
      (value): value is number => value !== null,
    )
    const wake = wakes.length === 0 ? null : Math.min(...wakes)
    const ripeCard = this.#ripeAuto()
    const ripeSms = this.#ripeSms()
    const ripe = ripeCard === 'now' || ripeSms === 'now' ? 'now' : ripeCard ?? ripeSms
    // 창이 열려 미룬 바로 등록이 있으면 창이 닫혔는지 자주 본다 (어떤 창이 닫혀도, AC-V3-43 a)
    const deferred = ripe === 'deferred' || this.#dueCards.size > 0 || this.#dueInterim.length > 0
    const delay = ripe === 'now' ? 0 : deferred ? Math.min(wake ?? DEFERRED_POLL_MS, DEFERRED_POLL_MS) : wake
    if (delay === null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.refresh()
    }, delay)
  }
}

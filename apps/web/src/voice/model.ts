// 음성 화면이 쓰는 문장·타입·작은 표시 함수 (SRV1 D-APP-23 ⓐⓒ — 서버가 준 값을 보이는 모양으로 바꾸기·상수·타입).
// 음성 읽기(덩어리·카드·정정·문자찜 판단)는 서버가 돌리는 VoiceController(controller.ts — 서버 전용 자리로 옮김, AC-SRV1-15)에 있고
// 웹·앱 화면은 이 파일만 부른다. 이 파일은 읽기 함수(@livejjim/core 파서·@livejjim/voice 값)를 부르지 않는다 — 타입 import만.
// 브라우저 음성 인식(크롬·사파리) 문장(SENT_NOTICE·STANDALONE_NOTICE)은 SRV1에서 없앴다(D-APP-22·25).
import type * as Voice from '@livejjim/voice'
import type { PriceUnit } from '@livejjim/core'
import type { ArchiveGap } from './archive-model.ts'
import type {
  CardRegistration,
  ChunkFields,
  LearnedAlias,
  RecentRegistration,
  SmsBuyerCandidate,
  SmsCard,
  SmsProductView,
  SmsReadOptions,
  SmsVoiceSettings,
  SmsWrite,
  SpeechEngine,
  SuggestionCard,
  VarietyCandidate,
  VoiceArchiveBroadcast,
  VoiceArchiveChunk,
  VoiceLogEntry,
  VoiceSettings,
} from '@livejjim/voice'
import type { FrontMark, HeardLine } from '../lib/voice.ts'

/** 음성 패키지 모듈 모양 (옛 host.load의 타입 — 기기는 이 모듈을 받지 않는다) */
export type VoiceModule = typeof Voice

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
/** 오류 문장을 줄 목록으로 (D-I5-12 — 문장 표의 \n에서 나눈다. 줄이 하나면 한 줄) */
export function errorLines(message: string): readonly string[] {
  return message.split('\n').filter((line) => line !== '')
}
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
  /**
   * 고칠 가격을 판매자가 적는 묻기 카드 (D-V3-114 (2) — 번호가 붙은 가격): 적은 글(처음엔 빈 칸). 있으면 changes는 비어 있고,
   * [고치기]는 적은 값을 그 방송 가격 단위로 읽어 고친다 — 비었거나 읽지 못하면 쓰지 않는다
   */
  readonly priceEntry?: string
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

/** 서버가 서명한 화면 대기값만 다시 잇는다. 추출 버퍼·자동 작업은 이 모양에 없다. */
export type VoiceResumeView = Pick<VoiceSnapshot, 'cards' | 'sms' | 'smsDropped' | 'forms' | 'notes' | 'info' | 'offers' | 'heard' | 'log' | 'flushedClosed'> & {
  readonly smsRequests: ReadonlyMap<string, readonly string[]>
  readonly smsChoices: ReadonlyMap<string, string>
  readonly recent: readonly RecentRegistration[]
}

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
  /** 읽기 위치가 달라도 같은 deadline을 시험할 수 있는 타이머 포트. */
  readonly timers?: { set(run: () => void, ms: number): unknown; clear(handle: unknown): void }
  /** 브라우저 저장·환경은 기기 포트로만 읽는다. 서버는 이 포트를 제공하지 않는다. */
  archiveDefault?(): boolean
  homeScreenApp?(): boolean
  archiveBroadcasts?(broadcastId?: string): Promise<readonly VoiceArchiveBroadcast[]>
  archiveGaps?(broadcastId?: string, now?: number): Promise<ReadonlyMap<string, { readonly title: string; readonly date: string; readonly gaps: readonly ArchiveGap[] }>>
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

/** 화면에 남기는 결과 카드 수 (넘으면 오래된 것부터 닫는다 — 찜은 그대로) */
export const SMS_RESULTS_SHOWN = 5

/** "확인 필요" 구매자로 넣은 카드인가 — 뒤 4자리도 이름도 말하지 않았다(메모 `확인 필요`, D-V1-21) */
export const smsUnknownBuyer = (entry: SmsEntry): boolean => entry.card.status === 'SENT' && entry.card.reading.last4 === null && entry.card.reading.name === null

/** 화면에 보이는 문자찜 카드 (열림·보내는 중·결과) */
export const smsShown = (entry: SmsEntry): boolean => !entry.hidden && entry.card.status !== 'CLOSED'

/** 보내지 못했을 때 (연결이 끊김 등 — 서버 문장이 없을 때) */
export const SMS_SEND_FAILED = '문자찜을 넣지 못했어요. 인터넷 연결을 확인하고 다시 "넣기"를 눌러 주세요.'

/** 같은 말 막기 시간 (D-V1-06 — 패키지 SMS_REPEAT_WINDOW_MS와 같다): 닫은 카드를 이만큼 들고 있는다 */
export const SMS_KEEP_MS = 10_000
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

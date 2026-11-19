import { statementFile } from './statement-file.ts'
import { PAUSED_MESSAGE, isPausedBroadcast } from './pause.ts'
import { groupOfBroadcast, mergeBroadcasts, readGroups, splitGroup, type BroadcastGroup, type MergeResult, type SplitResult } from './broadcast-groups.ts'
import type { FullView as ClientFullView } from '../../web/src/api/types.ts'
import { readQueue } from './print-store.ts'
// 판매자 작업 (AC-S04-21·27·31·33·50~52, AC-S05-20·35·50~52·60·61·80). 판정은 모두 packages/core가 한다 — 여기서는 이벤트를 만들고 기록 경로에 넘기고 조회 함수를 부른다.
// 범위 = (판매자, 날짜, 리허설인지) (D-081). 날짜로 범위를 고르는 조회·쓰기는 리허설을 명시해야 리허설 범위이고, 적지 않으면 실제 범위다.
// 방송이 있는 입력은 그 방송의 범위로 간다.
import {
  buyerOfRef,
  checkSettings,
  compareChars,
  containsPhoneRun,
  currentBuyerOf,
  getBroadcast,
  getBuyer,
  getProduct,
  isBarePass,
  isValidDate,
  listBlocked,
  listBroadcasts,
  listProducts,
  looksLikePhoneId,
  normalizePhone,
  parseChat,
  parseOptionComment,
  phoneLast4,
  previewMerge,
  resolveSettings,
  type MergePreview,
  type OptionCatalogEntry,
  type EngineState,
  type SaleSettings,
} from '@livejjim/core'
import { endedBroadcastSales } from './broadcast-sales.ts'
import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { API_EVENTS, CHAT_FIELDS, VOICE_LOG_FIELD, hasControlChar, isPlainObject, own, ownKeys } from './api-fields.ts'
import type { ReadProduct } from '@livejjim/voice-session/read'
import { MONEY_SETTING_KEYS, RAW_FIELDS, applyRawInput, checkRawInput, readMoneySetting, readProductOf, smsNumberProblem, type RawInput } from './raw-input.ts'
import type { Db } from './db/database.ts'
import { broadcasts, sellers, youtubeLinks } from './db/schema.ts'
import { readShop } from './shop.ts'
import { VarietyCache, type VarietySuggestions } from './varieties.ts'
import { STATEMENT_MESSAGES, checkStatementInput, readStatementInfo, shippingSettings, writeStatementShop, type StatementInfo } from './statement-info.ts'
import type { FieldProblem } from './errors.ts'
import {
  ChatGenerators,
  GENERATOR_RATE_DEFAULT,
  GENERATOR_RATE_MAX,
  GENERATOR_RATE_MIN,
  GENERATOR_SEED_MAX,
  GENERATOR_TOTAL_DEFAULT,
  GENERATOR_TOTAL_MAX,
  GENERATOR_TOTAL_MIN,
  realTimer,
  type GeneratorStatus,
  type GeneratorTimer,
} from './generator.ts'
import type { IdSource } from './ids.ts'
import { errorKind, type LogSink } from './log.ts'
import type { ScopeRuntime } from './runtime.ts'
import { fieldMessage, phoneIdProblem, safeFieldName, unknownFieldProblems } from './messages.ts'
import { productOwners } from './product-history.ts'
import { reviewsView, type ReviewsView } from './reviews.ts'
import { AssistService } from './assist/service.ts'
import { mergePackingCheck } from './packing.ts'
import { ParcelService } from './parcel/service.ts'
import { mergeAddress } from './parcel/store.ts'
import { openSellerKey, phoneKeyOf } from './secrets.ts'
import {
  ambiguousMessage,
  isLast4,
  last4Candidates,
  last4KeyText,
  LAST4_MESSAGE,
  LAST4_ONE_OF_MESSAGE,
  nameMismatchMessage,
  NEW_BUYER_MESSAGE,
  NEW_BUYER_ONE_OF_MESSAGE,
  newBuyerKeyText,
  sameName,
  spokenName,
  VOICE_MESSAGE,
} from './sms-last4.ts'
import { VOICE_REPEATED_MESSAGE, VoiceRepeats, voiceSignature } from './voice-repeat.ts'
import { insertFailedVoiceLog, insertVoiceLog, listVoiceLog, parseVoiceLogInput, planVoiceLog, settleVoiceLog, voiceLogTypeProblem, VOICE_LOG_MESSAGES, VOICE_LOG_TYPES, type VoiceLogContext, type VoiceLogEntry, type VoiceLogFilter, type VoiceLogPlan } from './voice-log.ts'
import {
  actionRows,
  chatRows,
  chatRowsByIds,
  eventByRequestId,
  findBroadcast,
  findScopeId,
  findSeller,
  findWizard,
  updateWizard,
  historyRows,
  insertBroadcast,
  listBroadcastRows,
  markBroadcastOpened,
  broadcastListExtras,
  type BroadcastPlatform,
  markBroadcastEnded,
  optionScopes,
  previousScopeDate,
  recentChatsOfSource,
  scopeSealInfo,
  scopeSealRows,
  scopeSeqs,
  type BroadcastRow,
  type ChatRow,
  type HistoryRow,
  type ScopeSeqRow,
} from './store.ts'
import type { BillingService } from './billing/service.ts'
import { iso, kstDate, kstTime, type Clock } from './time.ts'
import type { ViewCacheBudget } from './view-budget.ts'
import { changeSet, fullView, messageLookup, type ChangeSet, type FullView, type MessageLookup } from './views.ts'
import { resultOf, scopeKey, WriteAbort, type Actor, type ChatSource, type CommittedRecord, type Draft, type Rejection, type ScopeWriter, type WriteJob, type WriteOutcome, type WriteResult } from './writer.ts'
import { cleanPostText, sanitizeNick } from './youtube/texts.ts'
import { SEALED_CHAT_MESSAGE, sealAtOf, sealedView } from './youtube/seal.ts'

/** 시작 마법사 (UX-02, AC-I3-50): 처음 · 진행 중(단계 1~5) · 마침 · 닫음 */
export type WizardStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED'
export const WIZARD_STATUSES: readonly WizardStatus[] = ['NEW', 'IN_PROGRESS', 'DONE', 'DISMISSED']
export const WIZARD_STEPS = 5
export interface WizardState {
  readonly status: WizardStatus
  readonly step: number | null
}
function wizardOf(row: { status: string; step: number | null }): WizardState {
  const status = WIZARD_STATUSES.includes(row.status as WizardStatus) ? (row.status as WizardStatus) : 'NEW'
  return { status, step: status === 'IN_PROGRESS' ? row.step : null }
}

/** 방송 시작 창의 판매 방식 (OPT-04 "방송마다", D-O2-02): 번호로만 받기 · 상품명·옵션도 받기 */
export type SaleMode = 'NUMBERS' | 'OPTIONS'
export const SALE_MODES: readonly SaleMode[] = ['NUMBERS', 'OPTIONS']
export const SALE_MODE_MESSAGE = '판매 방식은 "번호로만 받기"나 "상품명·옵션도 받기" 중에서 골라 주세요.'

/**
 * 그 방송의 설정 스냅샷에 판매 방식을 넣는다 (D-O2-02 — 판매자 설정은 그대로).
 * OPTIONS면 claim.parseMode=OPTIONS·contention.policy=ARRIVAL(옵션 방송은 접수순만, R-19), NUMBERS면 설정이 OPTIONS일 때만 STRICT(아니면 설정 그대로), 없으면 설정 그대로
 */
export function withSaleMode(settings: SaleSettings, saleMode: SaleMode | undefined): SaleSettings {
  if (saleMode === 'OPTIONS') return { ...settings, 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' }
  if (saleMode === 'NUMBERS' && settings['claim.parseMode'] === 'OPTIONS') return { ...settings, 'claim.parseMode': 'STRICT' }
  return settings
}

/** 차단 이어받기 사유 (AC-S04-27) */
export const INHERITED_BLOCK_REASON = '이전 방송에서 차단한 시청자'

/** 운영 판매자 기본값 — 판매자가 고르지 않은 칸에 엔진 기본값(DEFAULT_SETTINGS)보다 먼저. 감사 채팅은 판매자가 켠 뒤에만 (D-YT-SRV-23). 운영 기동(main.ts)이 넣는다 */
// 등록 전에 들어온 찜은 시간이 지나도 날리지 않는다 — 등록하는 순간 먼저 온 순서대로 판정 (D-PEND-01)
// 감사 채팅은 확정 뒤 10초 기다렸다 보내고(묶음 창 10초, D-RETRO-01), 그사이 고친 품종·찜에 적용한 가격이 아직 올라가지 않은 감사 글에 들어간다(D-RETRO-02).
// 둘 다 새로 시작하는 방송부터다(설정은 방송을 시작할 때 굳는다). 엔진 기본값(묶음 0초·따라가지 않음)은 그대로 — 옛 방송을 다시 재생해도 같다
export const SELLER_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  'thanks.liveChat': false,
  'claim.preOpenExpire': false,
  'thanks.batchWindowSec': 10,
  'thanks.followEdits': true,
})

/**
 * 그만 쓰는 선택지 (D-SUCCESSION-01): "1등이 취소되면 → 내가 골라요"(ASK). 고르면 1등이 빠질 때마다 판매자가 다음 1등을 정해야 해
 * 방송 중 "승계 결정 필요" 알림이 뜬다 — 대기 1순위가 바로 1등이 되는 기본값(AUTO)으로 충분하다. 설정 API는 받지 않고,
 * 이미 저장한 판매자는 AUTO로 읽는다(다음에 시작하는 라이브부터). 판정 엔진은 그대로 ASK를 안다(옛 방송 다시 재생·골든 시험).
 */
export const RETIRED_SUCCESSION_MESSAGE = '이제 고를 수 없어요. 1등이 취소되면 대기 1순위가 바로 1등이 돼요.'
export function withoutRetired(settings: Record<string, unknown>): Record<string, unknown> {
  return settings['cancel.succession'] === 'ASK' ? { ...settings, 'cancel.succession': 'AUTO' } : settings
}

const TITLE_MAX = 100
/** 메시지 조회 개수 기본·상한 (AC-S05-20 — 그날 메시지 전체를 한 번에 주는 길은 없다) */
export const MESSAGES_LIMIT_DEFAULT = 100
export const MESSAGES_LIMIT_MAX = 500
/** 증분 조회에 함께 담는 새 메시지 수 상한 */
export const CHANGES_MESSAGES_LIMIT = 200
/** 시청자로 보내기 닉네임·본문 길이 (AC-S05-52, 글자 수 = 코드 포인트) */
export const VIEWER_NICK_MAX = 30
export const VIEWER_TEXT_MAX = 200
/** 가짜 채널 ID (실제 유튜브 채널 ID `UC…` 24자와 겹치지 않는다, D-082) */
export const FAKE_CHANNEL_RE = /^sim_[A-Za-z0-9_-]{1,40}$/
/** 합치기 미리 보기의 구매자 ID 길이 상한 (AC-S06b-10, 글자 수 = 코드 포인트) */
export const MERGE_PREVIEW_ID_MAX = 128

export interface ServiceOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly masterKey: Buffer
  readonly clock: Clock
  readonly ids: IdSource
  /** 보기 캐시 상한 (판매자마다 4·서버 전체 32·10분, AC-S06b-12) — 보기 캐시를 쓰는 조회마다 알린다 */
  readonly viewCaches: ViewCacheBudget
  /** 리허설 생성기 타이머 (기본 실제 타이머) */
  readonly generatorTimer?: GeneratorTimer
  /** 리허설 생성기 시험 속도 (타이머 간격을 나누는 값, 기본 1) */
  readonly generatorSpeed?: number
  /** 리허설 생성기 상태가 바뀔 때 (SSE generator 알림) */
  readonly onGenerator?: (sellerId: string, payload: Readonly<Record<string, unknown>>) => void
  /** 요금 (N5). 켜져 있으면 새 실제 방송 시작이 이용 방식을 같은 트랜잭션에서 정한다(BL-4) */
  readonly billing?: BillingService
  /** AI 확인 필요 제안 (A1 — 확인 필요 목록의 suggestion. 없으면 키 없는 서비스: 규칙 제안만) */
  readonly assist?: AssistService
  /** 서버 로그 (판매자 채팅 품종 글 결과 코드 — R-23. 없으면 남기지 않는다) */
  readonly log?: LogSink
  /** 판매자가 고르지 않은 설정 칸의 기본값 (D-YT-SRV-23 — 운영은 SELLER_DEFAULTS, 없으면 엔진 기본값 그대로) */
  readonly sellerDefaults?: Readonly<Record<string, unknown>>
}

export type ChatIngestOutcome =
  | { readonly status: 'recorded'; readonly date: string; readonly seq: number; readonly changed: boolean; readonly failed: boolean; readonly effects: readonly string[] }
  | { readonly status: 'duplicate' }
  | { readonly status: 'rejected'; readonly problems: readonly FieldProblem[] }
  | { readonly status: 'not_found' }
  | { readonly status: 'save_failed' }

export type ScopeView = FullView

/** 유튜브 수집기가 한 응답에서 넘기는 채팅 하나 (AC-Y1-21) */
export interface CollectedChat {
  readonly id: string
  readonly ch: string
  /** 정리 전 표시 이름 (수집 경로가 정리한다) */
  readonly nick: string
  readonly text: string
  readonly owner?: boolean
  readonly publishedAt?: number
}

export type ChatBatchOutcome =
  | { readonly status: 'ok'; readonly recorded: number }
  | { readonly status: 'not_found' }
  | { readonly status: 'sealed' }
  /** guard가 거절했다 (그 연결을 그사이 끊음) */
  | { readonly status: 'unlinked' }
  | { readonly status: 'save_failed' }
/** 합치기 미리 보기 (GET /api/days/:date/merge-preview, AC-S06b-10) — preview는 응답 seq까지 적용한 상태의 코어 previewMerge 결과 그대로 */
export interface MergePreviewView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly preview: MergePreview
}

/** 채팅 메시지 한 건 (AC-S05-20) */
export interface MessageItem {
  readonly id: string
  readonly broadcast: string
  readonly channel: string
  readonly nick: string
  readonly text: string
  /** 방송자 본인 메시지 (owner) */
  readonly owner: boolean
  readonly seq: number
  /** 서버 도착 시각 (UTC ISO) */
  readonly at: string
  /** 게시 시각 (UTC ISO — 없었으면 도착 시각) */
  readonly publishedAt: string
  /** 무시한 방송자 메시지 / 주문이었던 메시지 / 취소였던 메시지 (엔진 기록, listMessages) */
  readonly ignored: boolean
  readonly order: boolean
  readonly cancel: boolean
  /** 주문 번호·취소 번호 (주문·취소였던 메시지만 — 그 방송 설정의 parseChat) */
  readonly orders: readonly number[]
  readonly cancels: readonly number[]
  /** 언급 번호 (그 방송 설정의 parseChat mentions) */
  readonly mentions: readonly number[]
  /** 찜으로 바꾼 번호 (엔진 기록) */
  readonly converted: readonly number[]
  /** 그 메시지로 생긴 찜 ID (채팅 찜·메시지 변환 찜), 생성 순서 */
  readonly claims: readonly string[]
  /** 엔진이 처리하지 못한 입력 (확인 필요) */
  readonly failed: boolean
  /**
   * 옵션 방송의 메시지에만 있는 칸 (O2 AC-O2-24 — 번호 방송의 메시지 항목은 지금 모양 그대로):
   * 그 메시지로 생긴 찜(찜 ID·번호·옵션 글·수량)과 그 메시지의 남은 확인 필요 항목(사유·읽은 번호·옵션·수량)
   */
  readonly optionOrders?: readonly { readonly claim: string; readonly no: number; readonly variant: string | null; readonly qty: number }[]
  readonly review?: { readonly reason: string; readonly no: number | null; readonly options: readonly (readonly [string, string])[] | null; readonly qty: number | null } | null
  /**
   * 옵션 방송 메시지의 상품 이름·별칭 언급 번호 (SRV1 약속 5, APP-05 AC13 — 옛 웹 ChatPanel optionLook의 이름 찾기를 서버로):
   * 그 방송 상품(판매 종료 포함) 중 비교 글자(compareChars)가 두 글자 이상인 이름·별칭이 메시지 비교 글자 안에 있는 번호, 상품 순서
   */
  readonly nameMentions?: readonly number[]
  /**
   * 번호 없는 "패스"였던 메시지 (D-RETRO-103·113 — 번호 방송만, 있을 때만 true). 엔진이 취소였던 메시지로 기록했고(cancel),
   * 그 손님의 살아 있는 찜이 하나면 그 찜을 번호 취소처럼, 둘 이상이면 찜마다 같은 seq의 취소 요청으로 띄웠다. 화면이 "패스"라고 보인다
   */
  readonly pass?: true
}

export interface MessagesView {
  readonly date: string
  readonly rehearsal: boolean
  /** 이 조회가 본 범위의 지금 seq */
  readonly seq: number
  readonly messages: readonly MessageItem[]
  /** 그쪽으로 더 있는지 (after면 뒤로, 아니면 앞으로) */
  readonly more: boolean
}

export interface ChangesView extends Omit<ChangeSet, 'touchedMessages'> {
  /**
   * 메시지 (seq 오름차순, 방송·메시지 ID로 덮는다): since 이전에 받았는데 그 뒤 기록이 바뀐 메시지(메시지 변환으로 바꾼 번호·찜이 늘었다)와
   * since 뒤의 새 메시지(최대 200개)
   */
  readonly messages: readonly MessageItem[]
  /** since 뒤의 새 메시지가 200개를 넘어 다 담지 못했다 — 나머지는 /messages?after=(마지막 메시지 seq)로 */
  readonly messagesMore: boolean
}

/** 상품별 조치 기록 거르기: 방송·번호 (AC-S05-35 — 번호 기준) */
export interface ProductFilter {
  readonly b: string
  readonly no: number
}

/** 상품별 조치 기록 거르기: 상품 ID (AC-S06-70, D-095 — 상품 기준, 번호를 바꿔도 같다) */
export interface ProductIdFilter {
  readonly product: string
}

export interface HistoryItem {
  readonly seq: number
  readonly type: string
  readonly at: string
  readonly receivedAt: string
  readonly actor: { readonly kind: string; readonly loginId: string | null }
  readonly reason: string | null
  readonly fields: Readonly<Record<string, unknown>>
  readonly failed: boolean
}

const rejection = (status: number, code: Rejection['code'], message: string, problems: readonly FieldProblem[] = []): Rejection => ({ status, code, message, problems })
const invalidInput = (problems: readonly FieldProblem[]): Rejection => rejection(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)
/** 가격이 빈 확인 중 상품을 가격 없이 확정·공개하려 할 때 (R-2 "가격 없는 확인 중", D-RECOG-22) */
export const PRICE_FIRST_MESSAGE = '가격을 먼저 적어 주세요. 가격을 적어야 판매를 시작할 수 있어요.'

const notFound = { kind: 'not_found' } as const
/** 코드 포인트 수 (이모지 하나 = 1) */
const charCount = (value: string): number => [...value].length

export class Service {
  readonly #options: ServiceOptions
  readonly #assist: AssistService
  readonly #sellerKeys = new Map<string, Buffer>()
  /** 범위마다 최근에 기록한 음성 문자찜 쓰기 (D-V1-13 — 메모리에만, 서버를 다시 켜면 빈다) */
  readonly #voiceRepeats = new VoiceRepeats()
  /** 품종 후보의 지난 날짜 셈 (D-VARIETY-01 — 메모리에만) */
  readonly #varieties = new VarietyCache()
  /** 리허설 가짜 채팅 생성기 (D-082) */
  readonly generators: ChatGenerators
  /** 문자찜 손님 번호 기억 (D-REAL-03 영수증 문자) — 서버 조립이 건다. 실제 범위에서 기록했을 때만 부른다 */
  #phoneMemory: ((sellerId: string, phoneKey: string, phone: string) => Promise<void>) | null = null

  usePhoneMemory(memory: (sellerId: string, phoneKey: string, phone: string) => Promise<void>): void {
    this.#phoneMemory = memory
  }

  async #rememberPhone(sellerId: string, rehearsal: boolean, outcome: WriteOutcome, fields: { phoneKey?: string }, normalized: string | null): Promise<void> {
    if (rehearsal || outcome.kind !== 'ok' || normalized === null || fields.phoneKey === undefined || this.#phoneMemory === null) return
    await this.#phoneMemory(sellerId, fields.phoneKey, normalized)
  }

  constructor(options: ServiceOptions) {
    this.#options = options
    this.#assist = options.assist ?? new AssistService({ db: options.db, writer: options.writer, clock: options.clock, masterKey: options.masterKey, log: () => {}, setup: null })
    this.generators = new ChatGenerators({
      timer: options.generatorTimer ?? realTimer,
      now: () => options.clock.now(),
      read: async (sellerId, date) => {
        const runtime = await options.writer.read(sellerId, date, true)
        return { state: runtime.state, seq: runtime.seq }
      },
      ingest: async (sellerId, chat) => (await this.ingestChat(sellerId, chat)).status,
      publish: (sellerId, date, status) => options.onGenerator?.(sellerId, { date, rehearsal: true, ...status }),
      ...(options.generatorSpeed === undefined ? {} : { speed: options.generatorSpeed }),
    })
  }

  get writer(): ScopeWriter {
    return this.#options.writer
  }

  async #sellerKey(sellerId: string): Promise<Buffer> {
    const cached = this.#sellerKeys.get(sellerId)
    if (cached !== undefined) return cached
    const seller = await findSeller(this.#options.db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const key = openSellerKey(this.#options.masterKey, sellerId, seller.phoneKeyEnc)
    this.#sellerKeys.set(sellerId, key)
    return key
  }

  // ── 설정 (AC-S04-50) ──────────────────────────────────────────────────

  async #settingsOverride(db: Db, sellerId: string): Promise<Record<string, unknown>> {
    const seller = await findSeller(db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const parsed: unknown = JSON.parse(seller.settings)
    // 판매자 기본값 (D-YT-SRV-23): 감사 채팅은 판매자가 켠 뒤에만 — 시험으로 이은 남의 라이브에 감사가 올라가지 않게. 판정 엔진 기본값은 그대로
    return withoutRetired({ ...(this.#options.sellerDefaults ?? {}), ...(isPlainObject(parsed) ? parsed : {}) })
  }

  async settings(sellerId: string): Promise<SaleSettings> {
    return resolveSettings(await this.#settingsOverride(this.#options.db, sellerId))
  }

  /** 설정 일부 바꾸기. 코어 checkSettings로 검사하고, MANUAL은 아직 지원하지 않는다. 바꾼 설정은 다음에 만드는 방송부터 들어간다 */
  async updateSettings(sellerId: string, body: unknown): Promise<{ ok: true; settings: SaleSettings } | { ok: false; rejection: Rejection }> {
    if (!isPlainObject(body)) return { ok: false, rejection: rejection(400, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.') }
    const extra = ownKeys(body).filter((key) => key !== 'settings')
    if (extra.length > 0) return { ok: false, rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const sent = own(body, 'settings')
    // 금액 칸(기본 배송비·무료배송 기준)은 원문도 받는다 (SRV1 D-APP-24): 글이면 원 단위로 읽는다 — 읽지 못한 글은 그대로 두어 코어 설정 검사 문장을 받는다
    const changes = isPlainObject(sent)
      ? Object.fromEntries(ownKeys(sent).map((key) => [key, MONEY_SETTING_KEYS.includes(key) ? readMoneySetting(own(sent, key)) : own(sent, key)]))
      : sent
    const problems = checkSettings(changes).map((problem) => {
      const key = problem.key === null ? null : safeFieldName(problem.key)
      return { field: key === null ? 'settings' : `settings.${key}`, message: problem.message }
    })
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    const record = changes as Record<string, unknown>
    if (own(record, 'cancel.succession') === 'ASK') {
      return { ok: false, rejection: rejection(400, 'NOT_SUPPORTED', '고를 수 없는 설정이에요.', [{ field: 'settings.cancel.succession', message: RETIRED_SUCCESSION_MESSAGE }]) }
    }
    if (own(record, 'settlement.groupBy') === 'MANUAL') {
      return { ok: false, rejection: rejection(400, 'NOT_SUPPORTED', '아직 지원하지 않는 설정이에요.', [{ field: 'settings.settlement.groupBy', message: '아직 지원하지 않아요.' }]) }
    }
    // 잠깐 멈춤(D-PAUSE-01)은 방송 중에만 라이브 화면에서 켜고 끈다 — 판매자 기본값으로 저장하면 새 방송이 멈춘 채 시작한다
    if (Object.hasOwn(record, 'claim.paused')) {
      return { ok: false, rejection: rejection(400, 'NOT_SUPPORTED', '고를 수 없는 설정이에요.', [{ field: 'settings.claim.paused', message: '잠깐 멈춤은 라이브 화면에서만 켜고 끌 수 있어요.' }]) }
    }
    const saved = await this.#options.db.transaction(async (tx) => {
      await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).for('update')
      const next = { ...(await this.#settingsOverride(tx, sellerId)), ...record }
      // 저장된 값과 합친 뒤 함께 둘 수 없는 값(옵션 방식 + 실제 시각순, R-19 "판매 방식", AC-O2-03)이면 그 칸의 문장으로 거절한다
      const merged = checkSettings(next)
      if (merged.length > 0) return { problems: merged.map((problem) => ({ field: problem.key === null ? 'settings' : `settings.${safeFieldName(problem.key) ?? ''}`, message: problem.message })) }
      if (next['settlement.groupBy'] === 'MANUAL') return null
      await tx.update(sellers).set({ settings: JSON.stringify(next) }).where(eq(sellers.id, sellerId))
      return { next }
    })
    if (saved === null) return { ok: false, rejection: invalidInput([{ field: 'settings', message: '판매 규칙 설정을 확인해 주세요.' }]) }
    if (saved.problems !== undefined) return { ok: false, rejection: invalidInput(saved.problems) }
    return { ok: true, settings: resolveSettings(saved.next) }
  }

  // ── 가게 이름·시작 마법사 (AC-I3-47·50) ───────────────────────────────

  // 가게 이름 바꾸기는 I2와 합친 뒤 ClosingService.renameShop(shop.ts 규칙 — 가게 설정과 같은 상한, 가게 설정 알림)으로 옮겼다

  /** 서버 시계 (읽기 입구의 받은 시각 — 쓰기와 같은 시계) */
  now(): number {
    return this.#options.clock.now()
  }

  /**
   * 서버 읽기 입구가 쓰는 그 방송의 설정 스냅샷과 번호 → 상품 (SRV1 약속 1). 다른 판매자의·없는 방송이면 null(404).
   * 아무것도 기록하지 않는다 — 범위 상태를 읽기만 한다
   */
  async readScope(sellerId: string, b: string): Promise<{ readonly rehearsal: boolean; readonly settings: SaleSettings; readonly findProduct: (no: number) => ReadProduct | undefined } | null> {
    const row = await findBroadcast(this.#options.db, sellerId, b)
    if (row === null) return null
    const runtime = await this.#options.writer.read(sellerId, row.date, row.rehearsal)
    const state = runtime.state
    const settings = getBroadcast(state, b)?.settings
    if (settings === undefined) return null
    return { rehearsal: row.rehearsal, settings, findProduct: readProductOf(state, b) }
  }

  /** 시작 마법사 상태 */
  async wizard(sellerId: string): Promise<WizardState> {
    const row = await findWizard(this.#options.db, sellerId)
    if (row === null) throw new Error('판매자가 없다')
    return wizardOf(row)
  }

  /** 시작 마법사 상태 적기 ({ status, step? }). 틀리면 null */
  async setWizard(sellerId: string, body: Record<string, unknown>): Promise<WizardState | null> {
    const status = own(body, 'status')
    const step = own(body, 'step')
    if (typeof status !== 'string' || !WIZARD_STATUSES.includes(status as WizardStatus)) return null
    let next: WizardState
    if (status === 'IN_PROGRESS') {
      if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > WIZARD_STEPS) return null
      next = { status, step }
    } else {
      if (step !== undefined && step !== null) return null
      next = { status: status as WizardStatus, step: null }
    }
    if (!(await updateWizard(this.#options.db, sellerId, next))) throw new Error('판매자가 없다')
    return next
  }

  // ── 요청 번호 (AC-S04-25) ─────────────────────────────────────────────

  /** 그 요청 번호로 이미 기록한 결과 (없으면 null). 같은 요청 번호면 내용이 달라도 처음 결과를 돌려준다 */
  async priorResult(sellerId: string, requestId: string): Promise<WriteResult | null> {
    const record = await eventByRequestId(this.#options.db, sellerId, requestId)
    return record === null ? null : this.#withSmsBuyer(sellerId, await resultOf(this.#options.db, sellerId, record))
  }

  /**
   * 다시 돌려주는 문자찜 결과에 그 문자찜이 정한 구매자를 붙인다 (재전송 응답의 buyer, AC-S06b-11, D-099).
   * 문자찜 ref → 구매자는 그 ref를 처음 받을 때 한 번만 기록되고 바뀌지 않는다(R-11, D-067 — 같은 ref가 다시 오면 아무 일도 없다).
   * 그래서 그 범위의 지금 상태에서 읽어도 처음 응답(그 이벤트를 적용한 뒤 상태)과 같은 값이다. 문자찜이 아니거나 실패 표시면 그대로
   */
  async #withSmsBuyer(sellerId: string, result: WriteResult): Promise<WriteResult> {
    if (result.type !== 'sms' || result.failed) return result
    const ref = result.event.ref
    if (typeof ref !== 'string') return { ...result, smsBuyer: null }
    const runtime = await this.#options.writer.read(sellerId, result.date, result.rehearsal)
    return { ...result, smsBuyer: buyerOfRef(runtime.state, ref) }
  }

  // ── 방송 만들기·끝내기 (AC-S04-21·27) ─────────────────────────────────

  async createBroadcast(sellerId: string, actor: Actor, requestId: string, input: { date?: string; title?: string; rehearsal?: boolean; saleMode?: SaleMode; draft?: boolean }): Promise<WriteOutcome> {
    const { writer, db, ids } = this.#options
    const date = input.date ?? kstDate(this.#options.clock.now())
    const rehearsal = input.rehearsal === true
    const settings = withSaleMode(resolveSettings(await this.#settingsOverride(db, sellerId)), input.saleMode)
    const b = ids.broadcast()
    // 요금 (N5, BL-4): 실제 방송이고 요금 기능이 켜져 있으면 broadcast.start·방송 행과 같은 트랜잭션에서 이용 방식을 정한다 — 없으면 422 NO_PASS로 전체를 되돌린다
    const billing = !rehearsal && this.#options.billing?.enabled === true ? this.#options.billing : null
    let billed = false
    const outcome = await writer.write({
      sellerId,
      date,
      rehearsal,
      createScope: true,
      requestId,
      // 차단 이어받기는 실제 범위에서 실제 범위로만 (리허설 범위는 이어받지도 넘겨주지도 않는다, D-081)
      ...(rehearsal
        ? {}
        : {
            prepare: async () => {
              const previous = await previousScopeDate(db, sellerId, date)
              if (previous === null) return []
              const state = (await writer.read(sellerId, previous, false)).state
              // 코어 조회 함수만 쓴다 (D-086). 문자 구매자는 날짜를 넘지 않고, 휴대폰 번호인 ID(D-079 전 로그에 남은 값)는 새 범위에 다시 쓰지 않는다 (AC-S04-27, TD-S04-004)
              return listBlocked(state).filter((id) => !id.startsWith('sms:') && !looksLikePhoneId(id))
            },
          }),
      build: (ctx, prepared) => {
        // 기본 제목: 그 범위(날짜·리허설인지)의 방송 수 + 1 — 실제 방송 "N부", 리허설 방송 "리허설 N" (AC-S06-66 014, D-094). 범위가 따로라 서로 세지 않는다
        const n = String(listBroadcasts(ctx.state).length + 1)
        const title = input.title ?? (rehearsal ? `리허설 ${n}` : `${n}부`)
        const drafts: Draft[] = [{ fields: { type: 'broadcast.start', b, date, title, settings: { ...settings } }, actor, requestId }]
        if (ctx.isNewScope && !rehearsal) {
          for (const buyer of (prepared as string[] | undefined) ?? []) {
            // 이어받는 차단도 checkEvent를 통과해야 기록한다 — 통과하지 못하면 그 차단만 빼고 방송은 만든다
            drafts.push({ fields: { type: 'host.blockBuyer', buyer, reason: INHERITED_BLOCK_REASON }, actor: { kind: 'server' }, skipIfInvalid: true })
          }
        }
        return drafts
      },
      afterInsert: async (tx, scopeId, records, now) => {
        const first = records[0]
        if (first === undefined || !first.changed) return
        const event = first.event as unknown as { b: string; date: string; title: string }
        await insertBroadcast(tx, { id: event.b, sellerId, scopeId, date: event.date, title: event.title, startSeq: first.seq, now, draft: input.draft === true })
        if (billing !== null) {
          await billing.decideStart(tx, { sellerId, scopeId, broadcastId: event.b, date: event.date, now })
          billed = true
        }
      },
    })
    if (outcome.kind === 'ok' && billed) billing?.started(sellerId)
    return outcome
  }

  /** 방송 만들기 요청 본문 검사 (날짜·제목·리허설인지) */
  static broadcastInput(body: Record<string, unknown>): { ok: true; date?: string; title?: string; rehearsal?: boolean; saleMode?: SaleMode; draft?: boolean } | { ok: false; rejection: Rejection } {
    const problems: FieldProblem[] = []
    const date = own(body, 'date')
    const title = own(body, 'title')
    const rehearsal = own(body, 'rehearsal')
    const saleMode = own(body, 'saleMode')
    const draft = own(body, 'draft')
    if (draft !== undefined && typeof draft !== 'boolean') problems.push({ field: 'draft', message: '만드는 중인지는 예나 아니오로만 정할 수 있어요.' })
    if (saleMode !== undefined && !SALE_MODES.includes(saleMode as SaleMode)) problems.push({ field: 'saleMode', message: SALE_MODE_MESSAGE })
    if (date !== undefined && !isValidDate(date)) problems.push({ field: 'date', message: fieldMessage('date') })
    if (title !== undefined && (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_MAX || hasControlChar(title))) {
      problems.push({ field: 'title', message: `제목은 ${String(TITLE_MAX)}자 이하의 글자로 적어 주세요.` })
    }
    if (rehearsal !== undefined && typeof rehearsal !== 'boolean') problems.push({ field: 'rehearsal', message: '리허설인지는 예나 아니오로만 정할 수 있어요.' })
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    return {
      ok: true,
      ...(date === undefined ? {} : { date: date as string }),
      ...(title === undefined ? {} : { title: (title as string).trim() }),
      ...(rehearsal === undefined ? {} : { rehearsal: rehearsal as boolean }),
      ...(saleMode === undefined ? {} : { saleMode: saleMode as SaleMode }),
      ...(draft === undefined ? {} : { draft: draft as boolean }),
    }
  }

  /** 방송 화면에 들어왔다 (D-UX3-25) — 그때부터 방송 목록에 보인다. 몇 번 불러도 처음 한 번만 적는다 */
  async openBroadcast(sellerId: string, broadcastId: string): Promise<boolean> {
    return markBroadcastOpened(this.#options.db, sellerId, broadcastId, new Date(this.#options.clock.now()))
  }

  async endBroadcast(sellerId: string, actor: Actor, requestId: string, broadcastId: string): Promise<WriteOutcome> {
    const row = await findBroadcast(this.#options.db, sellerId, broadcastId)
    if (row === null) return { kind: 'not_found' }
    // 리허설 생성기는 끝내기를 기록하기 전에 멈춘다 — 보내던 메시지가 끝나기를 기다린 뒤 (끝낸 방송에 생성기가 더 쓰지 않는다, D-082)
    if (row.rehearsal) await this.generators.stop(sellerId, broadcastId, 'ended')
    return this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId,
      build: () => [{ fields: { type: 'broadcast.end', b: broadcastId }, actor, requestId }],
      afterInsert: async (tx, _scopeId, records) => {
        const first = records[0]
        if (first !== undefined && first.changed) await markBroadcastEnded(tx, sellerId, broadcastId, new Date(first.event.at))
      },
    })
  }

  // ── 이벤트 쓰기 (AC-S04-31·51) ────────────────────────────────────────

  /**
   * 화면이 보낸 이벤트 쓰기. body = { requestId, type, ...그 종류의 필드 }, queryDate = 방송이 없는 종류의 범위 날짜.
   * 요청 번호는 호출하는 쪽(API)이 이미 확인했다.
   */
  async writeEvent(
    sellerId: string,
    actor: Actor,
    requestId: string,
    body: Record<string, unknown>,
    queryDate: string | undefined,
    queryRehearsal?: boolean,
    /**
     * 서버 안쪽에서만 넣는 엔진 필드 (화면 API는 받지 않는다 — API_EVENTS 허용 목록 밖). 지금은 화면 일꾼 입구가 임시 등록의
     * 확인 중 칸(product.register의 tentative)을 넣을 때만 쓴다 (D-RETRO-82)
     */
    serverFields?: Readonly<Record<string, unknown>>,
  ): Promise<WriteOutcome | { kind: 'phone'; outcome: WriteOutcome; phoneLast4: string | null }> {
    const type = own(body, 'type')
    const spec = typeof type === 'string' && Object.hasOwn(API_EVENTS, type) ? API_EVENTS[type] : undefined
    if (spec === undefined || typeof type !== 'string') return { kind: 'rejected', rejection: invalidInput([{ field: 'type', message: fieldMessage('type') }]) }
    // 원문 필드 (SRV1 D-APP-24 — 빠른 입력 한 줄·고치기 칸·문자찜 번호/받은 시각·정산 금액): 엔진 필드가 아니고 기록 경로 안에서 읽어 엔진 필드로 바꾼다
    const allowed = new Set(['requestId', 'type', ...spec.fields, ...(RAW_FIELDS[type] ?? [])])
    const unknown = ownKeys(body).filter((key) => !allowed.has(key))
    if (unknown.length > 0) return { kind: 'rejected', rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(unknown)) }
    const rawChecked = checkRawInput(type, body)
    if (!rawChecked.ok) return { kind: 'rejected', rejection: rawChecked.rejection }
    const raw = rawChecked.raw
    // 음성 쓰기는 서버 음성 읽기가 읽은 값을 보낸다 — 원문 필드와 함께 받지 않는다
    if (raw !== null && own(body, VOICE_LOG_FIELD) !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: VOICE_LOG_FIELD, message: '받을 수 없는 항목이에요.' }]) }
    const fields: Record<string, unknown> = { type }
    for (const field of spec.fields) {
      const value = own(body, field)
      if (value !== undefined && field !== 'phone' && field !== 'last4' && field !== 'newBuyer' && field !== 'voice' && field !== VOICE_LOG_FIELD) Object.defineProperty(fields, field, { value, enumerable: true, writable: true, configurable: true })
    }
    for (const [field, value] of Object.entries(serverFields ?? {})) Object.defineProperty(fields, field, { value, enumerable: true, writable: true, configurable: true })

    // 범위 정하기: 방송이 있는 종류는 그 방송의 범위(날짜·리허설인지), 없는 종류는 요청에 적은 날짜와 리허설인지(적지 않으면 실제) (D-069, D-081)
    let date: string
    let rehearsal: boolean
    if (spec.broadcast) {
      if (queryDate !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: '방송이 있는 입력에는 날짜를 따로 적지 않아요.' }]) }
      if (queryRehearsal !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'rehearsal', message: '방송이 있는 입력에는 리허설인지를 따로 적지 않아요.' }]) }
      const b = own(body, 'b')
      if (typeof b !== 'string' || b === '') return { kind: 'rejected', rejection: invalidInput([{ field: 'b', message: fieldMessage('b') }]) }
      const row = await findBroadcast(this.#options.db, sellerId, b)
      if (row === null) return { kind: 'not_found' }
      date = row.date
      rehearsal = row.rehearsal
    } else {
      if (queryDate === undefined || !isValidDate(queryDate)) return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: "어느 날짜의 입력인지 '2026-10-18'처럼 적어 주세요." }]) }
      date = queryDate
      rehearsal = queryRehearsal === true
      const eventDate = own(body, 'date')
      if (type.startsWith('settlement.') && isValidDate(eventDate) && eventDate !== date) {
        return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: '고른 날짜와 같은 날짜만 적을 수 있어요.' }]) }
      }
    }

    if (type === 'sms') return this.#writeSms(sellerId, actor, requestId, date, rehearsal, body, fields, raw)
    // 음성 기록 칸 (V3 R-25, D-V3-65): 있으면 같은 기록 트랜잭션에서 상품 명령보다 먼저 음성 기록 줄을 남긴다. 없으면 손 입력(기록 없음)
    const voiceLogRaw = own(body, VOICE_LOG_FIELD)
    if (voiceLogRaw !== undefined && VOICE_LOG_TYPES.includes(type)) {
      const parsed = parseVoiceLogInput(voiceLogRaw)
      if (!parsed.ok) return { kind: 'rejected', rejection: invalidInput(parsed.problems) }
      const typeProblems = voiceLogTypeProblem(type, parsed.value)
      if (typeProblems.length > 0) return { kind: 'rejected', rejection: invalidInput(typeProblems) }
      const ctx: VoiceLogContext = { sellerId, requestId, date, rehearsal, b: String(own(body, 'b')), actor, input: parsed.value }
      return this.#writeWithVoiceLog(
        { sellerId, date, rehearsal, createScope: false, requestId, build: () => [{ fields, actor, requestId }] },
        ctx,
        fields,
      )
    }
    // 포장·배송을 적은 구매자의 합치기·떼어 내기 제한 (D-I2-20 — 실제 범위만, 엔진 이벤트를 기록하기 전에 같은 범위 줄·락 안에서)
    // 택배 (T1 PC-3·D-T1-07): 떼어 낼 구매자가 붙은 묶음에 접수 결과를 기다리는 시도가 있으면 막고, 합치면 같은 트랜잭션에서 그 날짜 배송지를 옮긴다(합칠 대상에 없을 때)
    let mergeTarget: { from: string; into: string } | null = null
    const packingGuard =
      !rehearsal && (type === 'buyer.merge' || type === 'buyer.unmerge')
        ? {
            guard: async (tx: Db, runtime: Pick<ScopeRuntime, 'scopeId' | 'state'>) => {
              const refused = (await mergePackingCheck(tx, sellerId, runtime.scopeId, runtime.state, fields)) ?? (await ParcelService.mergeGuard(tx, sellerId, date, runtime.state, fields, this.#options.clock.now()))
              if (refused !== null) return refused
              const from = fields['from']
              const into = fields['into']
              if (type === 'buyer.merge' && typeof from === 'string' && typeof into === 'string' && getBuyer(runtime.state, into) !== null) mergeTarget = { from, into: currentBuyerOf(runtime.state, into) ?? into }
              return null
            },
            afterInsert: async (tx: Db, _scopeId: string, records: readonly CommittedRecord[], now: Date) => {
              const target = mergeTarget as { from: string; into: string } | null
              if (target === null || records[0] === undefined || records[0].failed || !records[0].changed) return
              await mergeAddress(tx, this.#options.masterKey, sellerId, date, target.from, target.into, now)
            },
          }
        : {}
    return this.#options.writer.write({
      sellerId,
      date,
      rehearsal,
      createScope: false,
      requestId,
      ...packingGuard,
      // 보조자의 방송자 취소: 그 범위의 지금 상태(기록 트랜잭션 안)에서 문자찜으로 생긴 찜인지 코어 조회로 본다
      // 원문 필드는 같은 상태(그 방송 스냅샷의 가격 단위·번호 한도, 그때의 상품)로 읽는다 — 읽지 못하면 기록하지 않는다
      build: (ctx) => {
        const resolved = raw === null ? { fields } : applyRawInput(type, raw, fields, ctx.state, ctx.at)
        if ('rejection' in resolved) return resolved.rejection
        // 구조화된 번호(no)로 등록할 때도 그 방송의 번호 한도(claim.maxNumber) 안만 — 빠른 입력(D-030)·문자찜(D-089)과 같다
        if (type === 'product.register' && raw?.text === undefined && raw?.noText === undefined) {
          const outOfRange = smsNumberProblem(ctx.state, resolved.fields.b, resolved.fields.no, 'no')
          if (outOfRange !== null) return outOfRange
        }
        // 가격이 빈 확인 중 상품은 가격 없이 판매 중이 되지 않는다 — 엔진은 아무 일도 하지 않으므로, 기록하지 않고 쉬운 말로 알린다 (D-RECOG-22)
        if ((type === 'product.open' || type === 'product.confirm') && resolved.fields.price === undefined && typeof resolved.fields.b === 'string' && typeof resolved.fields.no === 'number') {
          if (getProduct(ctx.state, resolved.fields.b, resolved.fields.no)?.price === null) return invalidInput([{ field: 'price', message: PRICE_FIRST_MESSAGE }])
        }
        return [{ fields: resolved.fields, actor, requestId }]
      },
    })
  }

  /** 문자찜: 허용 필드로 새 이벤트를 만든다. ref는 서버가 만들고, 전화번호는 판매자 키의 HMAC과 뒤 4자리로만 담는다 (AC-S04-31) */
  async #writeSms(
    sellerId: string,
    actor: Actor,
    requestId: string,
    date: string,
    rehearsal: boolean,
    body: Record<string, unknown>,
    fields: Record<string, unknown>,
    raw: RawInput | null = null,
  ): Promise<WriteOutcome | { kind: 'phone'; outcome: WriteOutcome; phoneLast4: string | null }> {
    const phone = own(body, 'phone')
    if (phone !== undefined && typeof phone !== 'string') return { kind: 'rejected', rejection: invalidInput([{ field: 'phone', message: fieldMessage('phone') }]) }
    // 음성 문자찜의 뒤 4자리 (V1, AC-V1-10): 숫자 4개 글만, 전화번호·지정 구매자와 함께 보내지 않는다. 값은 로그·오류 문장에 넣지 않는다
    const last4 = own(body, 'last4')
    if (last4 !== undefined) {
      if (!isLast4(last4)) return { kind: 'rejected', rejection: invalidInput([{ field: 'last4', message: LAST4_MESSAGE }]) }
      if (phone !== undefined || own(body, 'buyer') !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'last4', message: LAST4_ONE_OF_MESSAGE }]) }
    }
    // 새 손님으로 넣기 (D-V1-14, AC-V1-13): true만, 뒤 4자리와 함께만, 전화번호·지정 구매자와 함께 보내지 않는다
    const newBuyer = own(body, 'newBuyer')
    if (newBuyer !== undefined) {
      if (newBuyer !== true || last4 === undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'newBuyer', message: NEW_BUYER_MESSAGE }]) }
      if (phone !== undefined || own(body, 'buyer') !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'newBuyer', message: NEW_BUYER_ONE_OF_MESSAGE }]) }
    }
    // 음성으로 넣는 쓰기 (D-V1-13, AC-V1-14): true만. 서버 도착 시각은 여기서 읽는다
    const voice = own(body, 'voice')
    if (voice !== undefined && voice !== true) return { kind: 'rejected', rejection: invalidInput([{ field: 'voice', message: VOICE_MESSAGE }]) }
    const arrivedAt = this.#options.clock.now()
    const voiceScope = scopeKey(sellerId, date, rehearsal)
    const signature = voice === true ? voiceSignature(body) : null
    let remembered = false
    const normalized = typeof phone === 'string' ? normalizePhone(phone) : null
    const sellerKey = normalized !== null || last4 !== undefined ? await this.#sellerKey(sellerId) : null
    const phoneFields = normalized === null || sellerKey === null ? {} : { phoneKey: phoneKeyOf(sellerKey, normalized), phoneLast4: phoneLast4(normalized) }
    // 뒤 4자리로 정한 구매자: 그 범위 상태(기록 경로의 범위 줄 안)에서 찾는다 — 한 사람이면 지정 구매자, 없으면 범위·뒤 4자리 키의 새 문자 구매자, 둘 이상이면 409 (D-V1-03)
    // 이름과 뒤 4자리를 함께 말했고 후보가 한 사람인데 그 사람의 표시 이름이 `문자찜(<이름>)`이 아니면 409 — 고르기 (D-V1-14).
    // 새 손님으로 넣기면 후보를 찾지 않고 그 문자찜 ref까지 담은 키로 새 문자 구매자를 만든다
    const ref = this.#smsRef()
    const name = spokenName(own(body, 'memo'))
    const last4Fields = (state: EngineState): { fields: Record<string, unknown> } | { rejection: Rejection } => {
      if (!isLast4(last4) || sellerKey === null) return { fields: {} }
      if (newBuyer === true) return { fields: { phoneKey: phoneKeyOf(sellerKey, newBuyerKeyText(date, rehearsal, last4, ref)), phoneLast4: last4 } }
      const candidates = last4Candidates(state, last4)
      const [only] = candidates
      if (candidates.length === 1 && only !== undefined) {
        if (name === null || sameName(only, name)) return { fields: { buyer: only.buyer } }
        return { rejection: { ...rejection(409, 'BUYER_AMBIGUOUS', nameMismatchMessage(last4)), extra: { candidates } } }
      }
      if (candidates.length === 0) return { fields: { phoneKey: phoneKeyOf(sellerKey, last4KeyText(date, rehearsal, last4)), phoneLast4: last4 } }
      return { rejection: { ...rejection(409, 'BUYER_AMBIGUOUS', ambiguousMessage(last4)), extra: { candidates } } }
    }
    const outcome = await this.#options.writer.write({
      sellerId,
      date,
      rehearsal,
      createScope: false,
      requestId,
      build: (ctx) => {
        // 여러 기기의 같은 음성 쓰기 (D-V1-13): 같은 요청 번호 다시 보내기는 기록 경로가 이 검사보다 먼저 처음 응답으로 돌려준다
        if (signature !== null && this.#voiceRepeats.repeated(voiceScope, signature, arrivedAt, requestId)) return rejection(409, 'VOICE_REPEATED', VOICE_REPEATED_MESSAGE)
        const byLast4 = last4Fields(ctx.state)
        if ('rejection' in byLast4) return byLast4.rejection
        // 원문 칸(번호·받은 시각)은 그 방송 스냅샷의 번호 한도·서버 시계로 읽는다 (SRV1 D-APP-24)
        const resolved = raw === null ? { fields } : applyRawInput('sms', raw, fields, ctx.state, ctx.at)
        if ('rejection' in resolved) return resolved.rejection
        const smsFields = resolved.fields
        // 번호 한도 (claim.maxNumber): 코어 입력 검사는 1 이상만 본다 — 전화번호가 붙은 긴 숫자 같은 범위 밖 번호로 보류 찜을 만들지 않는다
        const outOfRange = smsNumberProblem(ctx.state, smsFields.b, smsFields.no, raw?.noText === undefined ? 'no' : 'noText')
        if (outOfRange !== null) return outOfRange
        const received = own(smsFields, 'received')
        return [
        {
          // 받은 시각이 없으면 서버 도착 시각(이 이벤트의 at)의 KST. null 같은 값은 그대로 넘겨 엔진이 입력 오류로 거른다
          fields: { ...smsFields, ref, received: received === undefined ? kstTime(ctx.at) : received, ...phoneFields, ...byLast4.fields },
          actor,
          requestId,
          smsRef: ref,
          validate: (state, event) => {
            const buyer = (event as unknown as { buyer?: string }).buyer
            if (buyer !== undefined && getBuyer(state, buyer) === null) {
              return rejection(400, 'BUYER_NOT_FOUND', '고른 구매자를 찾지 못했어요.', [{ field: 'buyer', message: '고른 구매자를 찾지 못했어요.' }])
            }
            return null
          },
        },
        ]
      },
      // 기록한 음성 쓰기만 둔다 (같은 범위 줄·트랜잭션 안 — 뒤 요청의 build가 본다). 400·409로 기록하지 않은 쓰기는 두지 않는다
      ...(signature === null
        ? {}
        : {
            afterInsert: async () => {
              this.#voiceRepeats.remember(voiceScope, signature, arrivedAt, requestId)
              remembered = true
            },
          }),
    })
    // 이 요청이 등록했는데 커밋되지 않았으면 뺀다 (같은 요청 번호의 처음 응답(duplicate)은 이 요청이 등록하지 않았으니 그대로 둔다)
    if (remembered && outcome.kind !== 'ok') this.#voiceRepeats.forget(voiceScope, requestId)
    await this.#rememberPhone(sellerId, rehearsal, outcome, phoneFields, normalized)
    return { kind: 'phone', outcome: await this.#smsOutcome(sellerId, outcome, ref), phoneLast4: normalized === null ? null : phoneLast4(normalized) }
  }

  /** 판매자 키로 만든 전화번호 키 (SMS3 문자 확인 카드의 취소 승인 — 그 번호의 문자 구매자를 찾는다). 값은 로그에 남기지 않는다 */
  async phoneKeyFor(sellerId: string, normalizedPhone: string): Promise<string> {
    return phoneKeyOf(await this.#sellerKey(sellerId), normalizedPhone)
  }

  /**
   * 휴대폰에서 받은 문자찜 넣기 (SMS3 ORD-13 "문자찜 넣기", D-SMS3-12): 지금의 `sms` 이벤트를 같은 기록 경로로 넣는다.
   * - ref는 `ibx_`로 시작한다(화면의 "문자로 받음" 표시). 전화번호는 판매자 키의 HMAC과 뒤 4자리로만(AC-S04-31과 같음), 없으면 새 문자 구매자.
   * - checkOnSale이면 기록 직전(범위 줄 안 최신 상태)에 그 번호의 상품이 없거나 판매 중이 아니면(READY·HOLD·CLOSED) 409 NOT_ON_SALE로 넣지 않는다.
   * - actor: 바로 넣기는 서버, 카드에서 넣기는 판매자 계정
   */
  async writeInboxSms(
    sellerId: string,
    actor: Actor,
    input: {
      readonly b: string
      readonly requestId: string
      readonly no: number
      readonly receivedMs: number
      readonly memo: string | null
      readonly phone: string | null
      readonly checkOnSale: boolean
      readonly extra?: Readonly<Record<string, unknown>>
    },
  ): Promise<WriteOutcome> {
    const row = await findBroadcast(this.#options.db, sellerId, input.b)
    if (row === null) return { kind: 'not_found' }
    const normalized = input.phone === null ? null : normalizePhone(input.phone)
    const sellerKey = normalized === null ? null : await this.#sellerKey(sellerId)
    const phoneFields = normalized === null || sellerKey === null ? {} : { phoneKey: phoneKeyOf(sellerKey, normalized), phoneLast4: phoneLast4(normalized) }
    const ref = `ibx_${this.#smsRef()}`.slice(0, 64)
    const outcome = await this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId: input.requestId,
      build: (ctx) => {
        if (input.checkOnSale) {
          const product = getProduct(ctx.state, input.b, input.no)
          if (product === null || product.status === 'READY' || product.status === 'HOLD' || product.status === 'CLOSED') {
            return rejection(409, 'NOT_ON_SALE', `${String(input.no)}번은 지금 판매 중이 아니에요`)
          }
        }
        return [
          {
            fields: {
              ...(input.extra ?? {}),
              type: 'sms',
              b: input.b,
              no: input.no,
              ref,
              received: kstTime(input.receivedMs),
              ...(input.memo === null || input.memo === '' ? {} : { memo: input.memo }),
              ...phoneFields,
            },
            actor,
            requestId: input.requestId,
            smsRef: ref,
          },
        ]
      },
    })
    await this.#rememberPhone(sellerId, row.rehearsal, outcome, phoneFields, normalized)
    return this.#smsOutcome(sellerId, outcome, ref)
  }

  /**
   * 문자찜 쓰기 결과에 그 문자찜이 정한 구매자를 붙인다 (응답 buyer, AC-S06b-11, D-099).
   * 기록했으면 그 이벤트를 적용한 뒤 상태의 코어 buyerOfRef(ref), 같은 요청 번호의 처음 결과면 그 결과의 ref로 같은 값을 읽는다
   */
  async #smsOutcome(sellerId: string, outcome: WriteOutcome, ref: string): Promise<WriteOutcome> {
    if (outcome.kind === 'ok') {
      const after = outcome.states[0]
      return { ...outcome, result: { ...outcome.result, smsBuyer: after === undefined ? null : buyerOfRef(after, ref) } }
    }
    if (outcome.kind === 'duplicate' && outcome.result !== null) return { kind: 'duplicate', result: await this.#withSmsBuyer(sellerId, outcome.result) }
    return outcome
  }

  /** 문자찜 ref (영문만이라 휴대폰 번호가 들어갈 수 없다. 바꿔 끼운 ID 생성기가 숫자를 섞어도 번호가 들어 있으면 — 코어 입력 오류와 같은 판단 containsPhoneRun — 다시 만든다) */
  #smsRef(): string {
    for (let i = 0; i < 10; i++) {
      const ref = this.#options.ids.smsRef()
      if (/^[A-Za-z0-9_-]{1,64}$/.test(ref) && !containsPhoneRun(ref)) return ref
    }
    throw new Error('문자찜 ref를 만들지 못했다')
  }

  // ── 채팅 수집 함수 (AC-S04-33, AC-S05-51·52) ─────────────────────────

  /**
   * 채팅 한 건을 받는다 (S05 리허설 생성기·시청자로 보내기, S10 수집기가 쓴다 — 화면 이벤트 쓰기 API는 chat을 받지 않는다).
   * 허용 필드로 새 엔진 이벤트를 만들어 같은 기록 경로를 탄다. 같은 (판매자, 방송, 메시지 ID)는 한 번만 기록한다. 조치자는 수집기다.
   * 그 방송의 범위(실제·리허설)로 간다
   */
  async ingestChat(sellerId: string, input: unknown): Promise<ChatIngestOutcome> {
    const checked = await this.#chatInput(sellerId, input)
    if ('status' in checked) return checked
    return ingestOutcome(await this.#recordChat(sellerId, checked.row, checked.fields, null))
  }

  /**
   * 인스타그램 댓글 수집 (N2, AC-N2-24·32): ingestChat과 같은 기록(허용 필드·같은 기록 경로·조치자 collector·같은 (판매자, 방송, 메시지 ID)는 한 번만)이고,
   * 그 방송이 이미 끝났으면(broadcast.end가 기록됨) 기록하지 않고 'ended' — 끝내기와 같은 범위 줄 안에서 판단한다(끝낸 뒤 도착한 댓글은 그 방송에 들어가지 않는다).
   * guard가 있으면 그 chat을 넣은 같은 트랜잭션에서 부른다(라이브 연결 옮기기, AC-N2-25). false면 기록을 취소하고 'retry' — 회차를 다시 정한다
   */
  async ingestOpenChat(
    sellerId: string,
    input: unknown,
    options: { readonly guard?: (tx: Db, scopeId: string, now: Date) => Promise<boolean> } = {},
  ): Promise<ChatIngestOutcome | { readonly status: 'ended' } | { readonly status: 'retry' }> {
    const checked = await this.#chatInput(sellerId, input)
    if ('status' in checked) return checked
    const { row, fields } = checked
    if (row.endedAt !== null) return { status: 'ended' }
    const chat = { b: row.id, id: fields.id as string }
    const guard = options.guard
    let ended = false
    let retry = false
    const outcome = await this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId: null,
      chat,
      build: (ctx) => {
        if (getBroadcast(ctx.state, row.id)?.ended === true) {
          ended = true
          return rejection(409, 'BROADCAST_ENDED', '끝난 방송이에요.')
        }
        return [{ fields, actor: { kind: 'collector' }, chat, source: 'other' }]
      },
      ...(guard === undefined
        ? {}
        : {
            afterInsert: async (tx: Db, scopeId: string, _records: unknown, now: Date) => {
              if (await guard(tx, scopeId, now)) return
              retry = true
              throw new WriteAbort({ kind: 'not_found' })
            },
          }),
    })
    if (ended) return { status: 'ended' }
    if (retry) return { status: 'retry' }
    return ingestOutcome(outcome)
  }

  /** 수집 함수 입력 검사 (필드·방송) */
  async #chatInput(sellerId: string, input: unknown): Promise<ChatIngestOutcome | { row: BroadcastRow; fields: Record<string, unknown> }> {
    if (!isPlainObject(input)) return { status: 'rejected', problems: [{ field: null, message: '채팅은 객체여야 해요.' }] }
    const unknown = ownKeys(input).filter((key) => !CHAT_FIELDS.includes(key))
    if (unknown.length > 0) return { status: 'rejected', problems: unknownFieldProblems(unknown) }
    const b = own(input, 'b')
    const id = own(input, 'id')
    if (typeof b !== 'string' || b === '') return { status: 'rejected', problems: [{ field: 'b', message: fieldMessage('b') }] }
    if (typeof id !== 'string' || id === '' || id.length > 256 || hasControlChar(id)) return { status: 'rejected', problems: [{ field: 'id', message: '메시지 ID를 확인해 주세요.' }] }
    const row = await findBroadcast(this.#options.db, sellerId, b)
    if (row === null) return { status: 'not_found' }
    const fields: Record<string, unknown> = { type: 'chat' }
    for (const field of CHAT_FIELDS) {
      const value = own(input, field)
      if (value !== undefined) fields[field] = value
    }
    return { row, fields }
  }

  /**
   * 채팅 이벤트 기록 (조치자 수집기). 요청 번호가 있으면(시청자로 보내기) 그 요청 번호로도 한 번만.
   * 이름은 수집 경로가 정리해 기록한다(AC-Y1-22, D-Y05 — 유튜브 수집기·리허설 생성기·시청자로 보내기 모두). 본문은 그대로(파서가 읽는다).
   * 실제 범위의 채팅은 유튜브 채팅이다(봉인 대상, AC-Y1-61)
   */
  #recordChat(sellerId: string, row: BroadcastRow, fields: Record<string, unknown>, requestId: string | null): Promise<WriteOutcome> {
    const chat = { b: row.id, id: fields.id as string }
    const named = typeof fields.nick === 'string' ? { ...fields, nick: sanitizeNick(fields.nick) } : fields
    const source: ChatSource = row.rehearsal ? 'rehearsal' : 'youtube'
    return this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId,
      chat,
      build: () => [{ fields: named, actor: { kind: 'collector' }, chat, source, ...(requestId === null ? {} : { requestId }) }],
    })
  }

  /**
   * 유튜브 수집기의 한 응답을 한 번에 기록한다 (AC-Y1-21·23). 실제 방송만. 이미 기록된 메시지 ID·응답 안에서 겹친 ID는 빼고,
   * 엔진 입력 검사를 통과하지 못한 채팅은 그것만 기록하지 않는다. 모두 커밋되면 ok(기록한 수) — 그 뒤에야 수집기가 이어받기 지점을 저장한다
   */
  /**
   * 유튜브 수집기의 한 응답 (AC-Y1-21·25). 범위 락 안의 지금 상태로 거른다: 회차를 끝냈으면(어느 서버에서든) 게시 시각이 끝낸 시각보다 늦은 메시지는
   * 기록하지 않는다. guard는 같은 트랜잭션에서 그 연결이 아직 이어져 있는지 본다(거절이면 unlinked)
   */
  async ingestYoutubeBatch(
    sellerId: string,
    b: string,
    chats: readonly CollectedChat[],
    guard?: (tx: Db) => Promise<boolean>,
    source: 'youtube' | 'extension' = 'youtube',
  ): Promise<ChatBatchOutcome> {
    const row = await findBroadcast(this.#options.db, sellerId, b)
    if (row === null || row.rehearsal) return { status: 'not_found' }
    if (chats.length === 0) return { status: 'ok', recorded: 0 }
    // 다른 경로(공식 ↔ 확장)에서 이미 받은 같은 메시지 (D-X1-06): 같은 작성자·같은 정리 본문·게시 시각 3초 이내. 범위 락 안에서 본다
    const other = source === 'youtube' ? 'extension' : 'youtube'
    const since = new Date(this.#options.clock.now() - SAME_CHAT_LOOKBACK_MS)
    const alsoSeen = async (tx: Db): Promise<string[]> => {
      const earlier = await recentChatsOfSource(tx, sellerId, b, other, since)
      if (earlier.length === 0) return []
      // 서버 도착 시각 차 10초 이하만 (D-X1-28 — 거짓 게시 시각으로 다른 경로의 채팅을 지우지 못하게). 이 묶음의 도착 시각 = 지금
      const arrived = this.#options.clock.now()
      return chats
        .filter((chat) => chat.publishedAt !== undefined && earlier.some((seen) => Math.abs(seen.receivedAt - arrived) <= SAME_CHAT_ARRIVAL_MS && sameChat(seen, chat)))
        .map((chat) => chat.id)
    }
    const outcome = await this.#options.writer.write({
      sellerId,
      date: row.date,
      rehearsal: false,
      createScope: false,
      requestId: null,
      chatBatch: { b, ids: chats.map((chat) => chat.id), alsoSeen },
      ...(guard === undefined ? {} : { guard: async (tx: Db) => ((await guard(tx)) ? null : rejection(409, 'NOT_LINKED', '이어진 유튜브 방송이 없어요.')) }),
      build: (ctx) => {
        const seen = new Set(ctx.existingChats)
        const drafts: Draft[] = []
        const endedAt = getBroadcast(ctx.state, b)?.endedAt ?? null
        for (const chat of chats) {
          if (seen.has(chat.id)) continue
          if (endedAt !== null && chat.publishedAt !== undefined && chat.publishedAt > endedAt) continue
          seen.add(chat.id)
          const fields: Record<string, unknown> = { type: 'chat', b, id: chat.id, ch: chat.ch, nick: sanitizeNick(chat.nick), text: chat.text }
          if (chat.owner === true) fields.owner = true
          if (chat.publishedAt !== undefined) fields.publishedAt = chat.publishedAt
          drafts.push({ fields, actor: { kind: 'collector' }, chat: { b, id: chat.id }, source, skipIfInvalid: true })
        }
        return drafts
      },
    })
    switch (outcome.kind) {
      case 'ok':
        return { status: 'ok', recorded: outcome.records.length }
      case 'empty':
        return { status: 'ok', recorded: 0 }
      case 'not_found':
        return { status: 'not_found' }
      case 'rejected':
        return outcome.rejection.code === 'SEALED' ? { status: 'sealed' } : outcome.rejection.code === 'NOT_LINKED' ? { status: 'unlinked' } : { status: 'save_failed' }
      case 'duplicate':
        // 다른 쪽이 그사이 같은 메시지를 기록했다(락 밖 경합) — 지점을 저장하지 않고 다시 받는다(그때는 이미 기록된 것으로 빠진다)
        return { status: 'save_failed' }
      case 'save_failed':
        return { status: 'save_failed' }
    }
  }

  // ── 음성 등록·고침 기록 (R-25, D-V3-65, AC-V3-70) ─────────────────────

  /**
   * 기록 경로에 음성 기록을 끼운다: 범위 락을 잡은 트랜잭션 안에서(guard) 지금 상태로 줄을 만들어 상품 명령보다 먼저 넣고,
   * 이벤트를 넣은 뒤(afterInsert) 실패로 기록됐으면 실패 표시·등록이면 상품 ID·되돌리기면 되돌린 줄에 표시.
   * 명령이 기록되지 못하면(거절·저장 실패 — 트랜잭션이 롤백돼 줄도 없다) 실패 줄을 따로 남긴다. 같은 요청 번호의 두 번째 결과(duplicate)는 줄을 늘리지 않는다
   */
  async #writeWithVoiceLog(job: WriteJob, ctx: VoiceLogContext, fields: Readonly<Record<string, unknown>>): Promise<WriteOutcome> {
    const undo = ctx.input.undo !== null
    const planned: { plans: VoiceLogPlan[] | null } = { plans: null }
    const outerGuard = job.guard
    const outerAfter = job.afterInsert
    const outcome = await this.#options.writer.write({
      ...job,
      guard: async (tx, runtime) => {
        const refused = outerGuard === undefined ? null : await outerGuard(tx, runtime)
        if (refused !== null) return refused
        // 잠깐 멈춤 (D-PAUSE-01): 음성·화면 일꾼이 읽은 상품 등록·고침은 멈춘 방송에 넣지 않는다(실패 줄로 남는다). 판매자의 손 입력은 막지 않는다
        if (isPausedBroadcast(runtime.state, fields['b'])) return rejection(409, 'PAUSED', PAUSED_MESSAGE)
        planned.plans = planVoiceLog(runtime.state, fields, undo)
        // 음성 번호 옮기기(되돌리기 포함): 옮길 상품에 살아 있는 찜이 있으면 옮기지 않는다 (R-24, RA-V3-001 — R-10 번호 바꾸기는 그 찜을 RENUMBERED로 끝낸다).
        // 같은 범위 락 안의 지금 상태로 본다. 거절하면 트랜잭션이 롤백되고 아래에서 실패 줄을 남긴다
        if (fields['type'] === 'product.renumber' && planned.plans.some((plan) => plan.claims > 0)) return rejection(409, 'VOICE_RENUMBER_CLAIMED', VOICE_LOG_MESSAGES.renumberClaimed)
        await insertVoiceLog(tx, ctx, planned.plans, new Date(this.#options.clock.now()))
        return null
      },
      afterInsert: async (tx, scopeId, records, now, states) => {
        await outerAfter?.(tx, scopeId, records, now, states)
        await settleVoiceLog(tx, ctx, records[0], states[0])
      },
    })
    if (outcome.kind === 'rejected' || outcome.kind === 'save_failed') {
      try {
        const plans = planned.plans ?? planVoiceLog((await this.#options.writer.read(ctx.sellerId, ctx.date, ctx.rehearsal)).state, fields, undo)
        await insertFailedVoiceLog(this.#options.db, ctx, plans, new Date(this.#options.clock.now()))
      } catch (error) {
        this.#options.log?.({ level: 'warn', code: 'VOICE_LOG_FAILED', seller: ctx.sellerId, date: ctx.date, errorKind: errorKind(error) })
      }
    }
    return outcome
  }

  /** 음성 등록·고침 기록 조회 (GET /api/voice/log — 판매자 자기 것만, 시각순) */
  async voiceLog(sellerId: string, filter: VoiceLogFilter): Promise<VoiceLogEntry[]> {
    return listVoiceLog(this.#options.db, sellerId, filter)
  }

  // ── 리허설: 시청자로 보내기·가짜 채팅 생성기 (AC-S05-51·52, D-082) ────────

  /** 판매자의 리허설 방송 (실제 방송·다른 판매자·없는 방송이면 null — 404, 아무것도 기록하지 않는다) */
  async #rehearsalBroadcast(sellerId: string, b: string): Promise<BroadcastRow | null> {
    const row = await findBroadcast(this.#options.db, sellerId, b)
    return row !== null && row.rehearsal ? row : null
  }

  /** 시청자로 보내기 요청 검사: { nick, text, channel? } (요청 번호는 API가 확인했다) */
  static viewerChatInput(body: Record<string, unknown>): { ok: true; nick: string; text: string; channel?: string } | { ok: false; rejection: Rejection } {
    const extra = ownKeys(body).filter((key) => !['requestId', 'nick', 'text', 'channel'].includes(key))
    if (extra.length > 0) return { ok: false, rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const nick = own(body, 'nick')
    const text = own(body, 'text')
    const channel = own(body, 'channel')
    const problems: FieldProblem[] = []
    if (typeof nick !== 'string' || nick.trim() === '' || charCount(nick) > VIEWER_NICK_MAX || hasControlChar(nick)) {
      problems.push({ field: 'nick', message: `닉네임은 1~${String(VIEWER_NICK_MAX)}자로 적어 주세요.` })
    }
    if (typeof text !== 'string' || text.trim() === '' || charCount(text) > VIEWER_TEXT_MAX) problems.push({ field: 'text', message: `채팅은 1~${String(VIEWER_TEXT_MAX)}자로 적어 주세요.` })
    if (channel !== undefined && (typeof channel !== 'string' || (channel !== 'new' && !FAKE_CHANNEL_RE.test(channel)))) {
      problems.push({ field: 'channel', message: "채널은 가짜 채널(sim_로 시작)이나 'new'로 골라 주세요." })
    }
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    return { ok: true, nick: nick as string, text: text as string, ...(channel === undefined ? {} : { channel: channel as string }) }
  }

  /**
   * 리허설 방송에 가짜 시청자로 한 줄 보내기 (AC-S05-52). 메시지 ID는 서버가 만들고 수집 함수 경로로 기록한다(조치자 collector).
   * 채널: 생성기가 쓴 가짜 채널·다른 가짜 채널(sim_…)이면 그대로, 'new'면 새 가짜 채널, 없으면 닉네임마다 같은 가짜 채널.
   * 본문·닉네임은 시청자 쪽 값이라 휴대폰 번호 검사를 하지 않는다(R-1). 같은 요청 번호는 한 번만 기록한다
   */
  async viewerChat(sellerId: string, b: string, requestId: string, input: { nick: string; text: string; channel?: string }): Promise<WriteOutcome> {
    const row = await this.#rehearsalBroadcast(sellerId, b)
    if (row === null) return notFound
    const channel = input.channel === undefined ? viewerChannel(input.nick) : input.channel === 'new' ? `sim_v_${randomBytes(9).toString('base64url')}` : input.channel
    const fields = { type: 'chat', b, id: `simv-${randomBytes(12).toString('base64url')}`, ch: channel, nick: input.nick, text: input.text }
    return this.#recordChat(sellerId, row, fields, requestId)
  }

  /** 생성기 시작 요청 검사: { requestId?, total?, perSecond?, seed? } */
  static generatorInput(body: Record<string, unknown>): { ok: true; total: number; perSecond: number; seed: number | null; requestId: string | null } | { ok: false; rejection: Rejection } {
    const extra = ownKeys(body).filter((key) => !['requestId', 'total', 'perSecond', 'seed'].includes(key))
    if (extra.length > 0) return { ok: false, rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const total = own(body, 'total') ?? GENERATOR_TOTAL_DEFAULT
    const perSecond = own(body, 'perSecond') ?? GENERATOR_RATE_DEFAULT
    const seed = own(body, 'seed')
    const requestId = own(body, 'requestId')
    const isInt = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    const problems: FieldProblem[] = []
    if (!isInt(total, GENERATOR_TOTAL_MIN, GENERATOR_TOTAL_MAX)) problems.push({ field: 'total', message: '총 개수는 1부터 10,000까지의 정수로 적어 주세요.' })
    if (!isInt(perSecond, GENERATOR_RATE_MIN, GENERATOR_RATE_MAX)) problems.push({ field: 'perSecond', message: '초당 개수는 1부터 50까지의 정수로 적어 주세요.' })
    if (seed !== undefined && seed !== null && !isInt(seed, 0, GENERATOR_SEED_MAX)) problems.push({ field: 'seed', message: '시드는 0부터 2,147,483,647까지의 정수로 적어 주세요.' })
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(requestId))) {
      problems.push({ field: 'requestId', message: '화면을 새로고침한 뒤 다시 해 주세요.' })
    }
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    return { ok: true, total: total as number, perSecond: perSecond as number, seed: typeof seed === 'number' ? seed : null, requestId: typeof requestId === 'string' ? requestId : null }
  }

  /**
   * 생성기 시작 (AC-S05-51, AC-S06-71). 실제 방송·다른 판매자·없는 방송은 404, 끝난 방송·그 방송에서 이미 도는 생성기는 409,
   * 그 판매자의 다른 리허설 방송에서 도는 생성기가 있으면 409 GENERATOR_RUNNING_ELSEWHERE(그 방송 ID를 함께 — 아무것도 시작하지 않는다, D-096).
   * 같은 요청 번호로 다시 보낸 시작은 그 생성기 상태(200)다
   */
  async startGenerator(
    sellerId: string,
    b: string,
    input: { total: number; perSecond: number; seed: number | null; requestId: string | null },
  ): Promise<{ kind: 'ok'; status: GeneratorStatus } | { kind: 'not_found' } | { kind: 'rejected'; rejection: Rejection; extra?: Readonly<Record<string, unknown>> }> {
    const row = await this.#rehearsalBroadcast(sellerId, b)
    if (row === null) return notFound
    if (row.endedAt !== null) return { kind: 'rejected', rejection: rejection(409, 'BROADCAST_ENDED', '끝난 방송이라 가짜 채팅을 보낼 수 없어요.') }
    const seed = input.seed ?? randomBytes(4).readUInt32BE(0) % (GENERATOR_SEED_MAX + 1)
    const started = await this.generators.start(sellerId, b, row.date, { total: input.total, perSecond: input.perSecond, seed }, input.requestId)
    if (started.kind === 'elsewhere') {
      return {
        kind: 'rejected',
        rejection: rejection(409, 'GENERATOR_RUNNING_ELSEWHERE', '다른 리허설 방송에서 가짜 채팅이 돌고 있어요. 그 방송에서 먼저 멈춰 주세요.'),
        extra: { broadcast: started.b },
      }
    }
    if (started.kind === 'running' && !started.same) {
      return { kind: 'rejected', rejection: rejection(409, 'GENERATOR_RUNNING', '이미 가짜 채팅을 보내는 중이에요. 멈춘 뒤 다시 시작해 주세요.') }
    }
    return { kind: 'ok', status: started.status }
  }

  async stopGenerator(sellerId: string, b: string): Promise<GeneratorStatus | null> {
    if ((await this.#rehearsalBroadcast(sellerId, b)) === null) return null
    return this.generators.stop(sellerId, b, 'stopped')
  }

  async generatorStatus(sellerId: string, b: string): Promise<GeneratorStatus | null> {
    if ((await this.#rehearsalBroadcast(sellerId, b)) === null) return null
    return this.generators.status(sellerId, b)
  }

  // ── 조회 (AC-S04-52, AC-S05-20·35·50·60·61) ───────────────────────────

  /** 확인 필요 목록 (O2 AC-O2-30, D-O2-14). 방송을 주면 그 방송만 — 다른 판매자의 방송·없는 방송·리허설인지가 다른 방송이면 null */
  reviews(sellerId: string, query: { readonly rehearsal: boolean; readonly broadcast?: string }): Promise<ReviewsView | null> {
    return reviewsView({ db: this.#options.db, writer: this.#options.writer, assist: this.#assist }, sellerId, query)
  }

  /** 옵션 방송(설정 스냅샷 claim.parseMode=OPTIONS)이 실제·리허설 중 하나라도 있나 (D-O4-13) — 그 판매자 것만, 참/거짓만 */
  async hasOptionBroadcasts(sellerId: string): Promise<boolean> {
    return (await optionScopes(this.#options.db, sellerId)).length > 0
  }

  /**
   * 품종 후보 (D-VARIETY-01): 그 방송에서 최근 등록한 품종과 이 판매자가 최근 방송들에서 많이 쓴 품종. 없는 방송·다른 판매자 방송이면 null.
   * 봉인한 범위는 상태를 읽지 않는다(이번 방송 후보 없음). 지난 날짜는 실제 범위만 센다
   */
  async varieties(sellerId: string, broadcastId: string): Promise<VarietySuggestions | null> {
    const row = await findBroadcast(this.#options.db, sellerId, broadcastId)
    if (row === null) return null
    const sealed = await this.sealed(sellerId, row.date, row.rehearsal)
    const state = sealed === null ? (await this.#options.writer.read(sellerId, row.date, row.rehearsal)).state : null
    return this.#varieties.suggestions(this.#options.db, sellerId, row.date, state, broadcastId)
  }


  /**
   * 정산서 내려받기. 합친 라이브(D-MERGE-LIVE-01)면 묶음의 라이브를 모두 담고, 가게 이름은 묶음 첫 라이브(1차)의 것 —
   * 화면 정산서와 같은 범위라 1차만 담긴 파일이 따로 나가지 않는다
   */
  async statementFile(sellerId: string, id: string, tab: 'buyers' | 'products', format: 'csv' | 'xlsx') {
    const row = await findBroadcast(this.#options.db, sellerId, id)
    if (!row) return null
    const group = row.rehearsal ? null : await groupOfBroadcast(this.#options.db, sellerId, id)
    const members = group?.broadcasts ?? [id]
    const lead = members[0] ?? id
    const [view, shop, queue] = await Promise.all([this.scopeView(sellerId, row.date, row.rehearsal), this.orderShop(sellerId, lead), readQueue(this.#options.db, sellerId)])
    if (!view || shop === null) return null
    return { date: row.date, bytes: await statementFile(view as unknown as ClientFullView, members, shop, tab, format, queue?.hideNicknameSuffix === true) }
  }

  /** 지금 합친 라이브 묶음 (D-MERGE-LIVE-01) */
  broadcastGroups(sellerId: string): Promise<BroadcastGroup[]> {
    return readGroups(this.#options.db, sellerId)
  }

  /** 라이브 합치기 (D-MERGE-LIVE-01) — 같은 날 끝난 실제 라이브만, 기록은 덧붙이기만 */
  mergeBroadcasts(sellerId: string, actor: Actor, requestId: string, broadcastIds: readonly string[]): Promise<MergeResult> {
    return mergeBroadcasts(this.#options.db, sellerId, actor.kind === 'account' ? actor.accountId : null, requestId, broadcastIds, new Date(this.#options.clock.now()))
  }

  /** 합친 라이브 나누기 (D-MERGE-LIVE-02) */
  splitBroadcastGroup(sellerId: string, actor: Actor, requestId: string, groupId: string): Promise<SplitResult> {
    return splitGroup(this.#options.db, sellerId, actor.kind === 'account' ? actor.accountId : null, requestId, groupId, new Date(this.#options.clock.now()))
  }

  async orderShop(sellerId: string, id: string): Promise<string | null> {
    const db = this.#options.db
    const [row] = await db.select({ name: broadcasts.orderShopName }).from(broadcasts)
      .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, id)))
    if (!row) return null
    if (row.name) return row.name
    const [video] = await db.select({ title: youtubeLinks.broadcastTitle }).from(youtubeLinks)
      .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, id)))
      .orderBy(desc(youtubeLinks.linkedAt)).limit(1)
    const first = video?.title?.trim().match(/^([가-힣a-zA-Z0-9· ]{1,24}(?:다육|농원|농장|화원|공방|상점))(?=\s*#|$)/u)
    return first?.[1]?.trim() || (await readShop(db, sellerId)).name
  }

  async setOrderShop(sellerId: string, id: string, name: string): Promise<boolean> {
    const rows = await this.#options.db.update(broadcasts).set({ orderShopName: name })
      .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, id))).returning({ id: broadcasts.id })
    return rows.length > 0
  }

  /** 정산 정보 (D-RETRO-60): 정산서에 찍는 계좌·전화번호·방송 이름과 배송비 규칙. 없는 판매자면 null */
  statementInfo(sellerId: string): Promise<StatementInfo | null> {
    return readStatementInfo(this.#options.db, this.#options.masterKey, sellerId)
  }

  /**
   * 정산 정보 저장 (D-RETRO-60): 검사 → 배송비를 판매 규칙(shipping.baseFee·shipping.freeThreshold)에 → 계좌·전화번호·방송 이름을 가게 설정에.
   * 배송비 진실은 판매 규칙 하나다 — 날짜별 정산은 다음에 시작하는 라이브 날부터, 정산서는 바로 이 값을 쓴다
   */
  async updateStatementInfo(sellerId: string, body: unknown): Promise<{ ok: true; info: StatementInfo } | { ok: false; rejection: Rejection }> {
    const shop = await readShop(this.#options.db, sellerId)
    const checked = checkStatementInput(body, shop)
    if (!checked.ok) return checked
    const saved = await this.updateSettings(sellerId, { settings: shippingSettings(checked.value.shipping) })
    if (!saved.ok) return { ok: false, rejection: rejection(400, 'INVALID_INPUT', STATEMENT_MESSAGES.shipping, [{ field: 'shipping', message: STATEMENT_MESSAGES.shipping }]) }
    await writeStatementShop(this.#options.db, this.#options.masterKey, sellerId, checked.value)
    const info = await this.statementInfo(sellerId)
    if (info === null) throw new Error('판매자가 없다')
    return { ok: true, info }
  }

  async broadcasts(sellerId: string): Promise<{ id: string; date: string; title: string; rehearsal: boolean; ended: boolean; endedAt: string | null; createdAt: string | null; platforms: BroadcastPlatform[]; channelName?: string; salesTotal?: number; salesQty?: number; buyerCount?: number | null }[]> {
    const [rows, extras] = await Promise.all([listBroadcastRows(this.#options.db, sellerId), broadcastListExtras(this.#options.db, sellerId)])
    const totals = await endedBroadcastSales(this.#options.db, this.#options.writer, sellerId, rows)
    // 방송 화면에 아직 들어오지 않은(앱에서 만드는 중인) 방송은 목록에 넣지 않는다 (D-UX3-25)
    return rows.filter((row) => row.openedAt !== null).map((row) => ({
      id: row.id,
      date: row.date,
      title: row.title,
      rehearsal: row.rehearsal,
      ended: row.endedAt !== null,
      endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
      // 홈 '내 방송' 줄의 "2시간 전"과 플랫폼 아이콘 (D-UX3-18)
      createdAt: extras.createdAt.get(row.id)?.toISOString() ?? null,
      platforms: extras.platforms.get(row.id) ?? [],
      ...(extras.channels.has(row.id) ? { channelName: extras.channels.get(row.id)! } : {}),
      ...(row.endedAt !== null ? totals.get(row.id) : {}),
    }))
  }

  /** 범위별 지금 seq (범위 행의 seq 칸 — 이벤트 표를 모으지 않는다). rehearsal을 주면 그쪽 범위만 */
  scopes(sellerId: string, rehearsal?: boolean): Promise<ScopeSeqRow[]> {
    return scopeSeqs(this.#options.db, sellerId, rehearsal)
  }

  /**
   * 범위 목록 (GET /api/days): 범위별 지금 seq와 봉인 예정 시각(sealAt — 유튜브 채팅이 있는 실제 범위만, 아니면 null)·봉인 여부 (AC-Y1-62)
   */
  async days(sellerId: string, rehearsal: boolean): Promise<(ScopeSeqRow & { sealAt: string | null; sealed: boolean })[]> {
    const rows = await scopeSeqs(this.#options.db, sellerId, rehearsal)
    const seals = new Map((await scopeSealRows(this.#options.db, sellerId)).map((row) => [`${row.date}|${String(row.rehearsal)}`, row]))
    return rows.map((row) => {
      const seal = seals.get(`${row.date}|${String(row.rehearsal)}`)
      const youtube = seal !== undefined && seal.youtubeChat && !row.rehearsal
      return { ...row, sealAt: youtube ? iso(sealAtOf(row.date)) : null, sealed: seal?.sealedAt !== null && seal?.sealedAt !== undefined }
    })
  }

  /** 실제 범위 ID (없으면 null) */
  scopeId(sellerId: string, date: string): Promise<string | null> {
    return findScopeId(this.#options.db, sellerId, date, false)
  }

  /** 봉인한 범위면 그 장부 정보 (AC-Y1-62) */
  async sealed(sellerId: string, date: string, rehearsal = false): Promise<{ scopeId: string; ledger: string | null } | null> {
    if (rehearsal) return null
    const info = await scopeSealInfo(this.#options.db, sellerId, date, false)
    return info === null || info.sealedAt === null ? null : { scopeId: info.scopeId, ledger: info.ledger }
  }

  /** 범위 조회. 값은 코어 조회 함수의 결과(시각은 ISO). 없는 범위면 null. 봉인한 범위는 봉인한 장부로 같은 모양 + 봉인 표시 */
  async scopeView(sellerId: string, date: string, rehearsal = false): Promise<ScopeView | Record<string, unknown> | null> {
    const sealed = await this.sealed(sellerId, date, rehearsal)
    if (sealed !== null) {
      const seq = (await scopeSeqs(this.#options.db, sellerId, false)).find((row) => row.date === date)?.seq ?? 0
      return sealedView(date, seq, sealed.ledger)
    }
    const runtime = await this.#options.writer.read(sellerId, date, rehearsal)
    if (runtime.seq === 0) return null
    this.#options.viewCaches.use(runtime)
    return fullView(runtime)
  }

  /** 합치기 미리 보기 검색값 검사 (구매자 ID 두 개 — 형식만 본다. 범위에 없는 ID는 코어가 UNKNOWN_BUYER로 답한다) */
  static mergePreviewInput(from: string | undefined, into: string | undefined): { ok: true; from: string; into: string } | { ok: false; rejection: Rejection } {
    const problems: FieldProblem[] = []
    const check = (field: 'from' | 'into', value: string | undefined, message: string): void => {
      if (value === undefined || value === '' || charCount(value) > MERGE_PREVIEW_ID_MAX || hasControlChar(value)) problems.push({ field, message })
      // 휴대폰 번호처럼 보이는 ID는 D-079 ⑥ 문장 (값은 되돌려 보내지 않는다)
      else if (looksLikePhoneId(value)) problems.push(phoneIdProblem(field))
    }
    check('from', from, '옮길 구매자를 골라 주세요.')
    check('into', into, fieldMessage('into'))
    if (problems.length > 0 || from === undefined || into === undefined) return { ok: false, rejection: invalidInput(problems) }
    return { ok: true, from, into }
  }

  /**
   * 합치기 미리 보기 (AC-S06b-10, D-100): 그 범위의 지금 상태로 코어 previewMerge를 부른 결과 그대로와 그 상태의 seq.
   * 없는 범위(다른 판매자의 범위 포함)면 null(404). 아무것도 기록하지 않는다
   */
  async mergePreview(sellerId: string, date: string, rehearsal: boolean, from: string, into: string): Promise<MergePreviewView | null> {
    const runtime = await this.#options.writer.read(sellerId, date, rehearsal)
    // runtime은 쓰기와 같이 쓰는 객체다 — seq와 상태를 함께 잡아 그 상태로 계산한다(previewMerge는 동기라 그 사이 바뀌지 않는다)
    const { seq, state } = runtime
    if (seq === 0) return null
    return { date, rehearsal, seq, preview: previewMerge(state, from, into) }
  }

  /**
   * 증분 조회 (AC-S05-61, D-085): since 뒤로 값이 달라진 항목과 사라진 키, 그리고 메시지 —
   * since 뒤의 새 채팅 메시지(최대 CHANGES_MESSAGES_LIMIT개, 넘으면 messagesMore — 나머지는 메시지 이어 받기로)와
   * since 이전 메시지 중 기록이 바뀐 것(메시지 변환). 없는 범위면 null(404), since가 지금보다 크거나 서버가 둔 기준점 밖이면 'resync'
   */
  async changes(sellerId: string, date: string, rehearsal: boolean, since: number): Promise<ChangesView | 'resync' | null> {
    // 봉인한 범위는 증분이 없다 — 전체(봉인한 장부)를 다시 받는다
    if ((await this.sealed(sellerId, date, rehearsal)) !== null) return 'resync'
    const runtime = await this.#options.writer.read(sellerId, date, rehearsal)
    if (runtime.seq === 0 || runtime.scopeId === null) return null
    this.#options.viewCaches.use(runtime)
    const set = changeSet(runtime, since)
    if (set === null) return 'resync'
    const { touchedMessages, ...rest } = set
    const { db } = this.#options
    // 조회를 기다리는 사이 쓰기가 runtime을 고치므로, 변경 묶음을 만든 그 시점의 seq·상태로 메시지를 고르고 기록을 붙인다
    const { seq, state, scopeId } = runtime
    const fresh = since === seq ? { rows: [], more: false } : await chatRows(db, sellerId, scopeId, { after: since, before: seq + 1, limit: CHANGES_MESSAGES_LIMIT })
    const touched = touchedMessages.length === 0 ? [] : (await chatRowsByIds(db, sellerId, scopeId, touchedMessages)).filter((row) => row.seq <= since)
    return { ...rest, messages: this.#messageItems(runtime, state, [...touched, ...fresh.rows]), messagesMore: fresh.more }
  }

  /**
   * 채팅 메시지 이어 받기 (AC-S05-20). b를 주면 그 방송만(그 범위의 방송이 아니면 null — 리허설 방송은 리허설을 명시해야 보인다).
   * after: 그 seq 뒤 limit개 / before: 그 seq 앞의 가장 최근 limit개 / 둘 다 없으면 가장 최근 limit개. 늘 seq 오름차순.
   * 조회가 본 범위 상태(seq)까지의 메시지만 준다 — 응답 seq는 채팅 행을 읽기 전에 잡은 값이라, 응답 seq까지의 메시지는 모두 담긴다
   * (조회를 기다리는 사이 들어온 채팅은 응답 seq 뒤에 있어 증분으로 받는다, TD-S05-005)
   */
  async messages(
    sellerId: string,
    date: string,
    rehearsal: boolean,
    query: { readonly b?: string; readonly after?: number; readonly before?: number; readonly limit: number },
  ): Promise<MessagesView | (MessagesView & { sealed: true; sealedMessage: string }) | null> {
    // 봉인한 범위: 채팅 목록은 비고 문장을 준다 (AC-Y1-62)
    if ((await this.sealed(sellerId, date, rehearsal)) !== null) {
      const seq = (await scopeSeqs(this.#options.db, sellerId, false)).find((row) => row.date === date)?.seq ?? 0
      return { date, rehearsal: false, seq, messages: [], more: false, sealed: true, sealedMessage: SEALED_CHAT_MESSAGE }
    }
    const runtime = await this.#options.writer.read(sellerId, date, rehearsal)
    // runtime은 쓰기와 같이 쓰는 객체다. 채팅 행을 기다리는 사이 들어온 채팅이 seq·상태를 올려 두므로 지금 값을 잡아 두고
    // 조회 범위(before)·응답 seq·메시지 기록 모두 이 값으로 정한다 (TD-S05-005, AC-S05-20·21·62)
    const { seq, state, scopeId } = runtime
    if (seq === 0 || scopeId === null) return null
    if (query.b !== undefined && getBroadcast(state, query.b) === null) return null
    const before = Math.min(query.before ?? seq + 1, seq + 1)
    const { rows, more } = await chatRows(this.#options.db, sellerId, scopeId, {
      ...(query.b === undefined ? {} : { b: query.b }),
      ...(query.after === undefined ? {} : { after: query.after }),
      before,
      limit: query.limit,
    })
    return { date, rehearsal, seq, messages: this.#messageItems(runtime, state, rows), more }
  }

  /** 채팅 이벤트 행 → 메시지 항목 (주문·취소·무시·바꾼 번호는 엔진 기록, 언급은 그 방송 설정의 parseChat) */
  #messageItems(runtime: ScopeRuntime, state: ScopeStateLike, rows: readonly ChatRow[]): MessageItem[] {
    // 채팅 행을 기다리는 사이 다른 조회가 이 범위의 캐시를 비웠을 수 있다 — 쓰기 직전에 다시 알린다
    this.#options.viewCaches.use(runtime)
    const lookup: MessageLookup = messageLookup(runtime, state)
    const settingsOf = new Map<string, SaleSettings | null>()
    const settings = (b: string): SaleSettings | null => {
      let found = settingsOf.get(b)
      if (found === undefined) {
        found = getBroadcast(state, b)?.settings ?? null
        settingsOf.set(b, found)
      }
      return found
    }
    // 옵션 방송의 인식 상품 목록 (언급·취소 번호 — 판매 종료가 아닌 상품, R-20 머리말). 방송마다 한 번
    const catalogs = new Map<string, OptionCatalogEntry[]>()
    const catalog = (b: string): OptionCatalogEntry[] => {
      let found = catalogs.get(b)
      if (found === undefined) {
        found = listProducts(state)
          .filter((product) => product.broadcast === b && product.status !== 'CLOSED')
          .map((product) => ({ no: product.no, name: product.name, aliases: product.aliases, options: product.options }))
        catalogs.set(b, found)
      }
      return found
    }
    // 상품 이름·별칭 언급 (SRV1 약속 5, APP-05 AC13 — 옛 웹 ChatPanel optionLook과 같은 비교): 그 방송의 상품(판매 종료 포함) 중
    // 비교 글자(compareChars)가 두 글자 이상인 이름·별칭이 메시지 비교 글자 안에 있으면 그 번호. 방송마다 한 번
    const namedWords = new Map<string, { no: number; words: string[] }[]>()
    const named = (b: string, text: string): number[] => {
      let found = namedWords.get(b)
      if (found === undefined) {
        found = listProducts(state)
          .filter((product) => product.broadcast === b)
          .map((product) => ({ no: product.no, words: [product.name, ...product.aliases].map(compareChars).filter((word) => word.length >= 2) }))
        namedWords.set(b, found)
      }
      const compared = compareChars(text)
      return found.filter((product) => product.words.some((word) => compared.includes(word))).map((product) => product.no)
    }
    return rows.map((row) => {
      const event = JSON.parse(row.body) as { b: string; id: string; ch: string; nick: string; text: string; owner?: boolean; at: number; publishedAt?: number }
      const key = JSON.stringify([event.b, event.id])
      const info = row.failed ? undefined : lookup.byKey.get(key)
      const order = info?.order ?? false
      const cancel = info?.cancel ?? false
      const snapshot = settings(event.b)
      if (snapshot !== null && snapshot['claim.parseMode'] === 'OPTIONS') {
        // 옵션 방송 (O2 AC-O2-24, D-O2-12): 주문은 그 메시지로 생긴 찜(번호·옵션 글·수량 — 받을 때 엔진이 정한 것), 확인 필요는 남은 항목,
        // 언급·취소 번호는 지금 상품 목록으로 다시 읽은 것(표시만 — 판정은 받을 때 끝났다)
        const claims = info === undefined ? [] : [...(lookup.claimsBySeq.get(row.seq) ?? [])]
        const optionOrders = claims.flatMap((id) => {
          const claim = lookup.claimById.get(id)
          return claim === undefined ? [] : [{ claim: id, no: claim.no, variant: claim.variant, qty: claim.qty }]
        })
        const review = row.failed ? undefined : lookup.reviewByKey.get(key)
        const reread = parseOptionComment(event.text, catalog(event.b), null, snapshot)
        // 주문 여부는 그 메시지로 생긴 찜이 있는지로 본다 (SA-O2-03, D-076) — 받을 때 확인 필요였다가 바로잡아 찜이 생긴 메시지도
        // 주문 메시지다. 그래야 채팅 패널이 '찜으로 바꾸기'를 다시 보이지 않아 같은 메시지로 두 번째 찜이 생기지 않는다.
        const optionOrder = order || optionOrders.length > 0
        return {
          id: event.id,
          broadcast: event.b,
          channel: event.ch,
          nick: event.nick,
          text: event.text,
          owner: event.owner === true,
          seq: row.seq,
          at: iso(event.at),
          publishedAt: iso(info?.publishedAt ?? event.publishedAt ?? event.at),
          ignored: info?.ignored ?? false,
          order: optionOrder,
          cancel,
          orders: [...new Set(optionOrders.map((item) => item.no))],
          cancels: cancel ? [...reread.cancels] : [],
          mentions: [...reread.mentions],
          // 상품 이름·별칭 언급 번호 (SRV1 약속 5) — 번호 언급(mentions, 코어 parseOptionComment)과 따로 둔다
          nameMentions: named(event.b, event.text),
          converted: info === undefined ? [] : [...info.converted],
          claims,
          failed: row.failed,
          optionOrders,
          review: review === undefined ? null : { reason: review.reason, no: review.no, options: review.options, qty: review.qty },
        }
      }
      const parsed = snapshot === null ? null : parseChat(event.text, snapshot)
      // 번호 없는 "패스" (D-RETRO-113): 엔진이 취소였던 메시지로 기록했는데 읽은 취소 번호가 없고 메시지 전체가 패스 말
      const pass = cancel && parsed !== null && parsed.cancels.length === 0 && isBarePass(event.text)
      return {
        id: event.id,
        broadcast: event.b,
        channel: event.ch,
        nick: event.nick,
        text: event.text,
        owner: event.owner === true,
        seq: row.seq,
        at: iso(event.at),
        publishedAt: iso(info?.publishedAt ?? event.publishedAt ?? event.at),
        ignored: info?.ignored ?? false,
        order,
        cancel,
        orders: order && parsed !== null ? parsed.claims : [],
        cancels: cancel && parsed !== null ? parsed.cancels : [],
        mentions: parsed?.mentions ?? [],
        converted: info === undefined ? [] : [...info.converted],
        claims: info === undefined ? [] : [...(lookup.claimsBySeq.get(row.seq) ?? [])],
        failed: row.failed,
        ...(pass ? { pass: true as const } : {}),
      }
    })
  }

  /**
   * 상품 ID로 거른 조치 행 (AC-S06-70). 범위 상태를 먼저 잡고(그 seq까지만 본다), after 뒤의 product.*·host.* 행을 모두 읽어
   * 코어 listProducts의 지금 번호에서 뒤로 되짚으며 행마다 그때 그 번호의 상품을 정한다(productOwners)
   */
  async #productIdRows(sellerId: string, date: string, rehearsal: boolean, productId: string, after: number, limit: number): Promise<HistoryRow[]> {
    const runtime = await this.#options.writer.read(sellerId, date, rehearsal)
    // runtime은 쓰기와 같이 쓰는 객체다 — 지금 값을 잡아 두고 행도 그 seq까지만 읽는다
    const { state, seq, scopeId } = runtime
    if (scopeId === null) return []
    const current = listProducts(state)
    if (!current.some((item) => item.id === productId)) return []
    const all: HistoryRow[] = []
    for (let cursor = after; ; ) {
      const batch = await actionRows(this.#options.db, sellerId, scopeId, cursor, ACTION_BATCH, seq)
      all.push(...batch)
      if (batch.length < ACTION_BATCH) break
      cursor = (batch.at(-1) as HistoryRow).seq
    }
    const owners = productOwners(
      all.map((row) => ({ type: row.type, event: JSON.parse(row.body) as Record<string, unknown>, changed: row.changed, failed: row.failed })),
      current,
    )
    const rows: HistoryRow[] = []
    for (const [index, row] of all.entries()) {
      if (owners[index] !== productId) continue
      rows.push(row)
      if (rows.length >= limit) break
    }
    return rows
  }

  /**
   * 이력 조회: seq 순, after 뒤부터 limit개. 전화번호 키는 빼고 낸다. 없는 범위면 null.
   * 거르기:
   * - { b, no }: 그 방송·번호를 대상으로 한 product.*·host.* 이벤트만(번호 변경은 이전·새 번호 모두, AC-S05-35)
   * - { product }: 그 상품(ID)을 대상으로 한 product.*·host.* 이벤트만 — 이벤트마다 그때 그 번호에 있던 상품으로 돌린다(AC-S06-70, D-095).
   *   그 범위에 없는 상품 ID면 빈 목록(있는지 알리지 않는다)
   */
  async history(
    sellerId: string,
    date: string,
    after: number,
    limit: number,
    rehearsal = false,
    product?: ProductFilter | ProductIdFilter,
  ): Promise<HistoryItem[] | null> {
    const scopeId = await findScopeId(this.#options.db, sellerId, date, rehearsal)
    if (scopeId === null) return null
    let rows: HistoryRow[]
    if (product === undefined) {
      rows = await historyRows(this.#options.db, sellerId, scopeId, after, limit)
      if (rows.length === 0 && after === 0) return null
    } else if ('product' in product) {
      rows = await this.#productIdRows(sellerId, date, rehearsal, product.product, after, limit)
    } else {
      rows = []
      // 조치 이벤트를 차례로 읽으며 그 상품을 대상으로 한 것만 모은다 (본문은 JSON 문자열이라 DB에서 거르지 않는다)
      for (let cursor = after; rows.length < limit; ) {
        const batch = await actionRows(this.#options.db, sellerId, scopeId, cursor, 1000)
        for (const row of batch) {
          if (targetsProduct(JSON.parse(row.body) as Record<string, unknown>, product)) rows.push(row)
          if (rows.length >= limit) break
        }
        if (batch.length < 1000) break
        cursor = (batch.at(-1) as HistoryRow).seq
      }
    }
    return rows.map((row) => {
      const event = JSON.parse(row.body) as Record<string, unknown>
      const fields: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(event)) {
        if (key === 'type' || key === 'seq' || key === 'at' || key === 'reason' || key === 'phoneKey') continue
        Object.defineProperty(fields, key, { value, enumerable: true, writable: true, configurable: true })
      }
      const reason = event.reason
      return {
        seq: row.seq,
        type: row.type,
        at: iso(Number(event.at)),
        receivedAt: row.receivedAt.toISOString(),
        actor: { kind: row.actor, loginId: row.actor === 'account' ? row.loginId : null },
        reason: typeof reason === 'string' ? reason : null,
        fields,
        failed: row.failed,
      }
    })
  }
}

type ScopeStateLike = Parameters<typeof messageLookup>[1]

/** 상품 ID 거르기에서 한 번에 읽는 조치 행 수 */
const ACTION_BATCH = 1000

/** 그 방송·번호를 대상으로 한 이벤트인지 (번호 변경은 이전·새 번호 모두) */
function targetsProduct(event: Record<string, unknown>, product: ProductFilter): boolean {
  if (event.b !== product.b) return false
  if (event.type === 'product.renumber') return event.from === product.no || event.to === product.no
  // 확인 중 상품을 다른 번호로 확정 (R-2 "확인 중") — 처음 번호·최종 번호 모두
  if (event.type === 'product.confirm') return event.no === product.no || event.to === product.no
  return event.no === product.no
}

/** 닉네임마다 같은 가짜 채널 (FNV-1a — 숫자 덩어리가 짧아 번호 모양이 될 수 없다) */
function viewerChannel(nick: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < nick.length; i++) {
    h ^= nick.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `sim_n_${(h >>> 0).toString(36)}`
}

function ingestOutcome(outcome: WriteOutcome): ChatIngestOutcome {
  switch (outcome.kind) {
    case 'ok':
      return { status: 'recorded', date: outcome.result.date, seq: outcome.result.seq, changed: outcome.result.changed, failed: outcome.result.failed, effects: outcome.result.effects }
    case 'duplicate':
    case 'empty':
      return { status: 'duplicate' }
    case 'rejected':
      return { status: 'rejected', problems: outcome.rejection.problems }
    case 'not_found':
      return { status: 'not_found' }
    case 'save_failed':
      return { status: 'save_failed' }
  }
}

/** 다른 경로 중복을 찾을 때 볼 기간 (받은 시각 기준 — 확장이 다시 보내기까지 기다린 시간보다 넉넉히) */
export const SAME_CHAT_LOOKBACK_MS = 30 * 60 * 1000
/** 다른 경로에서 온 같은 메시지로 볼 게시 시각 차 (D-X1-06) */
export const SAME_CHAT_GAP_MS = 3000
/** 다른 경로에서 온 같은 메시지로 볼 서버 도착 시각 차 (D-X1-28) */
export const SAME_CHAT_ARRIVAL_MS = 10_000

/** 같은지 견줄 본문: NFC, 공백 문자 한 칸·보이지 않는 글자 삭제·앞뒤 공백 삭제 (게시 문구 정리와 같다) */
export function sameChatText(text: string): string {
  return cleanPostText(text.normalize('NFC'))
}

/** 다른 경로의 두 채팅이 같은 메시지인지 (D-X1-06): 같은 작성자 채널·같은 정리 본문·게시 시각 차 3초 이하 */
export function sameChat(
  seen: { readonly ch: string | null; readonly publishedAt: number | null; readonly text: string | null },
  chat: { readonly ch: string; readonly publishedAt?: number; readonly text: string },
): boolean {
  if (seen.ch === null || seen.publishedAt === null || seen.text === null || chat.publishedAt === undefined) return false
  return seen.ch === chat.ch && Math.abs(seen.publishedAt - chat.publishedAt) <= SAME_CHAT_GAP_MS && sameChatText(seen.text) === sameChatText(chat.text)
}

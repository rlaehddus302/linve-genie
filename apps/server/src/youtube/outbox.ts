// 감사 메시지 발송함 실행기 (AC-Y1-30~46, R-13, D-Y01·D-Y06~D-Y08·D-Y12).
// - 행은 outbox-store.ts의 함수로만 고르고 바꾼다(rehearsal = false 고정, RA-S05-002). 감사(POST_THANKS)와 방송 후 요약 댓글만 다룬다.
// - 처음 볼 때: 효과가 나온 때(행이 생긴 시각) 그 대상의 동의가 없었으면 보내지 못함(NO_CONSENT). 실시간 채팅은 묶음 창(설정, 할당량 묶음 모드·초대 방송이면 ≥ 60초 — D-YT-SRV-18)에 넣는다.
// - 보내기 직전: 기한(실시간 채팅 10분·영상 댓글 24시간·요약 24시간) → 그 범위의 지금 엔진 상태(취소 → 건너뜀, 완료 → 게시됨) → 연결·
//   그 방송을 이은 채널 = 지금 연결한 채널(아니면 NOT_MY_CHANNEL, D-Y1-02)·권한·이은 방송·채팅 끝남·할당량 → 문구(묶음·200자 분할) →
//   한 문장으로 SENDING을 잡고(실행기 둘이 같은 행을 잡지 않는다) 게시한다.
// - 게시가 성공하면 메시지(댓글) ID·시각을 적고 SENT, 그 메시지에 든 효과마다 effect.thanksSent를 조치자 server로 기록한다(요청 번호 = 행에서 정함 — 한 번만).
//   보고 기록이 실패하면 보고만 다시 한다(다시 게시하지 않는다).
// - 서버로 이은 회차 (YT-SRV, D-YT-SRV-15·16): 게시 검사를 지난 뒤 올리기 바로 전에, 글 올리는 계정이 비어 있으면 그때 연결한 채널을 적고(한 번만),
//   실시간 채팅이면 공식 채팅 ID가 비어 있을 때만 글 올리는 계정의 토큰으로 videos.list 한 번 → activeLiveChatId를 회차에 적는다(비어 있을 때만).
//   받기 실패는 아무것도 올리지 않았으므로 확인 없이 게시 실패와 같은 이유·같은 다시 시도로, 영상·채팅 ID가 없으면 REJECTED(저장 없음).
// - 타임아웃·연결 끊김(응답을 모름)은 바로 다시 보내지 않고 SENDING인 채 확인한다: 그 시도를 시작한 시각 − 5초 뒤 우리 채널이 같은 글을 올렸는지.
//   실시간 채팅은 공식 조회를 부르지 않고 서버 수집기가 그 회차에서 본 우리 글(작성자 = 글 올리는 계정)로만 확인한다 — 확인 시간(30초) 안에 보면 SENT,
//   못 보면 다시 게시하지 않고 FAILED(UNCONFIRMED) (D-YT-SRV-17, DOMAIN_RULES R-13 YT-SRV 세부).
//   영상·요약 댓글은 최근 댓글 이른 조회 한 번, 다시 게시(실패 한 번)는 확인 시간이 끝난 뒤 그 시도 뒤의 글을 모두 본 조회(끝 조회)로도 못 찾았을 때만 한다.
//   조회 실패·다 보지 못한 조회는 "조회함"이 아니다 — 끝 조회가 3번 실패하면 다시 게시하지 않고 FAILED(UNCONFIRMED), 게시 보고 없음,
//   판매자가 수동 재전송으로 고른다 (D-Y1-06).
//   찾은 메시지는 이미 다른 묶음이 가진 것이면 고르지 않고, 같은 글을 확인하는 묶음끼리는 효과 순서대로 짝짓는다 (D-Y1-03, outbox-store claimRemote).
//   서버가 SENDING 행을 남긴 채 죽었다 살아나면 그 행은 임대가 지난 뒤 확인부터 한다(확인 시간이 이미 지났으면 바로 끝 조회부터).
// - 다시 시도: 2·4·8·16·32초 뒤 최대 5번, 그래도 안 되면 GAVE_UP. 다시 시도해도 소용없는 오류는 바로 보내지 못함.
// - 실패·재시도·건너뜀은 엔진 이벤트로 기록하지 않는다(effect.failed 없음, D-Y01).
// - 게시 뒤 감사 정정 (D-RETRO-105): 바퀴마다 이미 올라간 실시간 채팅 감사의 값이 고쳐졌는지 보고, 고쳐졌으면 그 글을 지우고 고친 글을 새로 올린다(thanks-fix.ts).
import { formatWon, getBroadcast, getBuyer, listClaims, listEffects, listProducts, type ClaimInfo, type EngineEffect, type EngineState } from '@livejjim/core'
import { MissingAmountError, requireAmount } from '../amount.ts'
import type { Db } from '../db/database.ts'
import { INSTAGRAM_PREFIX, TIKTOK_PREFIX } from '../platform.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { Actor, ScopeWriter } from '../writer.ts'
import { ChatSendError, type ChatSender, type ChatSendRoute } from './chat-send/sender.ts'
import { ChannelMismatchError, YoutubeAccessError, googleFields, type ConsentTarget, type YoutubeConnections } from './connect.ts'
import { batchWindowOf } from './collector.ts'
import { GoogleError, POST_TIMEOUT_MS, type GoogleClient } from './google.ts'
import {
  claimRemote,
  confirmPostedRows,
  dismissRow,
  dueRows,
  failWaiting,
  findRow,
  groupRows,
  EXT_VIA,
  TT_VIA,
  handToExtension,
  insertSummaryRows,
  newThanksRows,
  openWindowAt,
  otherSellersThanksOnVideo,
  rowByConfirmRequest,
  rowByResendRequest,
  scopeDates,
  scopeRows,
  sendingRows,
  unreportedRows,
  updateRows,
  type RemoteCandidate,
  type RowChange,
  type RunnerRow,
} from './outbox-store.ts'
import type { QuotaMeter } from './quota.ts'
import { activeLink, fillLinkLiveChatId, fillLinkPoster, insertOwnMessage, isInvitedLink, latestLink, markChatEnded, markSummaryDone, summaryCandidates, type LinkRow } from './store.ts'
import { SUMMARY_KIND, batchMessages, commentText, currentThanksTexts, liveChatText, summaryComments, type SummaryLine } from './texts.ts'
import { ThanksFixer } from './thanks-fix.ts'
import type { Timer } from './timer.ts'
import { winnerClaimsOf } from '../winners.ts'

export type OutboxState = 'WAITING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED'
export type OutboxTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT' | 'SUMMARY'

export const OUTBOX_STATE_MESSAGES: Readonly<Record<OutboxState, string>> = {
  WAITING: '기다림',
  SENDING: '보내는 중',
  SENT: '게시됨',
  SKIPPED: '건너뜀',
  FAILED: '보내지 못함',
}

/** 이유 코드와 판매자에게 보이는 문장 (AC-Y1-32) */
export const OUTBOX_REASON_MESSAGES = {
  // 보내지 못함
  NO_CONSENT: '자동 게시에 동의하기 전의 감사예요.',
  NO_LINK: '이어진 유튜브 방송이 없어요.',
  NOT_MY_CHANNEL: '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.',
  CHAT_ENDED: '유튜브 채팅이 끝났어요.',
  NO_PERMISSION: '게시 권한이 없어요.',
  EXPIRED: '너무 늦어 보내지 않았어요.',
  GAVE_UP: '여러 번 보내지 못했어요.',
  REJECTED: '유튜브가 받지 않았어요.',
  UNCONFIRMED: '올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.',
  SEALED: '30일이 지나 보내지 않았어요.',
  // 보내지 못함 — 크롬 확장 (X1 D-X1-18·24)
  EXT_OFF: '확장으로 감사 올리기를 꺼서 보내지 않았어요.',
  // 건너뜀
  CANCELLED: '확정이 풀린 판매라 보내지 않아요.',
  // 건너뜀 — 한 방송 한 감사 (D-YT-SRV-22): 같은 유튜브 방송에 다른 계정이 같은 감사를 올림 · 문자로 찜한 손님(유튜브 이름이 없다)
  SHARED_SENT: '같은 유튜브 방송에 다른 계정이 같은 감사를 올려 보내지 않았어요.',
  SMS_BUYER: '문자로 찜한 손님이라 유튜브 감사를 올리지 않았어요.',
  // 건너뜀 — 여러 플랫폼 회차의 감사 경로 (D-N2b-2-09): 틱톡 구매자 · 유튜브를 이은 적 없는 회차의 유튜브·문자 구매자
  NOT_SUPPORTED: '틱톡에는 감사 메시지를 보내지 않아요.',
  NO_RECIPIENT: '이 방송에는 유튜브가 이어진 적이 없어 감사를 보내지 않았어요.',
  // 기다림
  WINDOW: '묶어서 보내려고 기다리는 중이에요.',
  // 기다림 — 크롬 확장에 맡김 (X1 D-X1-19)
  EXTENSION: '크롬 확장으로 올리려고 기다리는 중이에요.',
  RETRY: '다시 보내려고 기다리는 중이에요.',
  RECONNECT: '유튜브 연결을 다시 해 주세요.',
  QUOTA: '오늘 유튜브 사용량이 얼마 남지 않아 기다리는 중이에요.',
  // 보내는 중 (타임아웃 확인): CONFIRM 이른 조회 전 · CONFIRM_LISTED 이른 조회로 못 찾음 · CONFIRM_LIST_FAILED 이른 조회 실패 — 모두 확인 시간 끝의 조회를 기다린다
  CONFIRM: '올라갔는지 확인하는 중이에요.',
  CONFIRM_LISTED: '올라갔는지 확인하는 중이에요.',
  CONFIRM_LIST_FAILED: '올라갔는지 확인하는 중이에요.',
} as const
export type OutboxReason = keyof typeof OUTBOX_REASON_MESSAGES

/**
 * 틱톡 감사 행(via = TIKTOK, D-TT-SEND-01~)의 이유 문장 — 같은 이유 코드(화면의 다시 보내기·"올라가 있어요" 단추가 코드로 정한다)를
 * 쓰되 유튜브 낱말이 든 문장만 틱톡으로 바꾼다. 없는 코드는 OUTBOX_REASON_MESSAGES 그대로
 */
export const TIKTOK_REASON_MESSAGES: Readonly<Record<string, string>> = {
  NO_LINK: '이어진 틱톡 방송이 없어요.',
  CHAT_ENDED: '틱톡 방송이 끝났어요.',
  REJECTED: '틱톡 채팅에 글을 넣지 못했어요.',
  GAVE_UP: '여러 번 틱톡에 보내지 못했어요.',
  UNCONFIRMED: '틱톡에 올라갔는지 확인하지 못했어요. 틱톡 방송에서 확인하고 없으면 다시 보내 주세요.',
  BOT_LOGIN: '라이브지니 틱톡 계정을 지금 쓸 수 없어 보내지 못했어요.',
  TIKTOK: '틱톡 채팅에 올리려고 기다리는 중이에요.',
  RETRY: '틱톡에 다시 보내려고 기다리는 중이에요.',
}

const reasonMessageOf = (row: RunnerRow, reason: string | null): string | null => {
  if (reason === null) return null
  if (row.via === TT_VIA && reason in TIKTOK_REASON_MESSAGES) return TIKTOK_REASON_MESSAGES[reason] ?? null
  return reason in OUTBOX_REASON_MESSAGES ? OUTBOX_REASON_MESSAGES[reason as OutboxReason] : null
}

/** 수동 재전송 문장 (AC-Y1-38) */
export const RESEND_MESSAGES = {
  CANCELLED: '확정이 풀린 판매라 보내지 않아요.',
  ALREADY_SENT: '이미 게시된 감사예요.',
  QUOTA_PAUSED: '오늘 유튜브 사용량이 얼마 남지 않아 채팅 수집에 남겨 둬요.',
  NOT_ALLOWED: '다시 보낼 수 없는 감사예요.',
  NO_ROUTE: '유튜브를 연결하거나 크롬 확장으로 감사 채팅 올리기를 켜 주세요.',
} as const

/** 자동 게시 기한 (AC-Y1-37) */
export const LIVE_CHAT_DEADLINE_MS = 10 * 60 * 1000
export const COMMENT_DEADLINE_MS = 24 * 60 * 60 * 1000
/** 다시 시도 (AC-Y1-35): 2·4·8·16·32초, 최대 5번 */
export const MAX_RETRIES = 5
/** 타임아웃 확인 (AC-Y1-36) */
export const CONFIRM_WINDOW_MS = 30_000
export const CONFIRM_SLACK_MS = 5000
/** 확인 시간이 끝난 뒤의 조회가 이만큼 실패하면 확인하지 못함(UNCONFIRMED) — 다시 게시하지 않는다 (AC-Y1-96) */
export const MAX_CONFIRM_TRIES = 3
/** 보내는 중 임대 (서버가 죽으면 이 시간이 지난 뒤 확인부터) */
export const SENDING_LEASE_MS = 60_000
/** 같은 유튜브 방송의 같은 감사를 한 번만 올리는 시간 (D-YT-SRV-22) — 실시간 채팅 감사 기한(10분)보다 넉넉히 */
export const SHARED_THANKS_MS = 30 * 60 * 1000
/** 할당량 묶음 모드의 실시간 채팅 최소 창 (AC-Y1-40·52) */
export const BATCH_MODE_WINDOW_SEC = 60
/**
 * 초대 방송(방송 채널 ≠ 글 올리는 계정, INV1)의 실시간 채팅 최소 창 (D-YT-SRV-18) — 남의 채팅창을 도배하지 않게 판매자 설정이 0이어도 60초로 묶는다.
 * 판매자 설정 값은 바꾸지 않는다. 할당량 묶음 모드와 겹치면 그대로 60초
 */
export const INVITED_WINDOW_SEC = 60

/**
 * 실시간 채팅 감사 묶음 창(초): 판매자 설정, 할당량 묶음 모드면 ≥ 60초(AC-Y1-40), 초대 방송이면 ≥ 60초(D-YT-SRV-18). 0이면 한 건씩 바로
 */
export function liveChatWindowSec(setting: number, quotaMode: string, invited: boolean): number {
  let windowSec = setting
  if (quotaMode !== 'NORMAL') windowSec = Math.max(windowSec, BATCH_MODE_WINDOW_SEC)
  if (invited) windowSec = Math.max(windowSec, INVITED_WINDOW_SEC)
  return windowSec
}
/** 방송 후 요약은 끝낸 뒤 이만큼 (AC-Y1-46) */
export const SUMMARY_DELAY_MS = 10 * 60 * 1000
/** 기다림을 다시 볼 간격 (연결·할당량) */
const RECHECK_MS = 5000
/** 한 시도의 확인 조회: 이른 조회 1번 + 끝 조회 3번까지, 같은 행의 조회 사이는 10초 이상 (D-I3-17 (3), AC-I3-87) */
export const LOOKUP_INTERVAL_MS = 10_000
/** 조회 한 번이 따라가는 쪽 수 상한 — 이만큼 보고도 그 시도 뒤의 글을 다 보지 못하면 실패한 조회 (D-I3-17 (2), AC-I3-86) */
export const LOOKUP_MAX_PAGES = 5
/** 조회 한 쪽의 최대 수: 댓글(최신순). 실시간 채팅 값은 옛 공식 확인 조회의 것 — 실시간 채팅은 공식 조회를 부르지 않아 쓰지 않는다 (D-YT-SRV-17) */
export const LIVE_CHAT_LOOKUP_PAGE = 2000
export const COMMENT_LOOKUP_PAGE = 50

/** 발송함 시간 (운영 기본값 — E2E 기동만 줄인다, AC-I3-93) */
export interface OutboxTiming {
  /** 게시 응답 기다림 (기본 10초) */
  readonly postTimeoutMs?: number
  /** 타임아웃 확인 시간 (기본 30초) */
  readonly confirmWindowMs?: number
  /** 같은 행의 조회 사이 최소 간격 (기본 10초) */
  readonly lookupIntervalMs?: number
  /** 다시 시도 간격의 바탕 (기본 1000 — 2·4·8·16·32초) */
  readonly retryBaseMs?: number
  /** 실시간 채팅 조회 한 쪽의 최대 수 — 실시간 채팅은 공식 조회를 부르지 않아 쓰지 않는다(옛 설정 자리, D-YT-SRV-17) */
  readonly liveChatLookupPage?: number
}

export interface OutboxHooks {
  /** 게시 응답을 받은 직후·SENT로 적기 전 (시험: 던지면 서버가 죽은 것처럼 그 행을 SENDING인 채 둔다) */
  readonly afterPost?: (rowIds: readonly number[]) => void | Promise<void>
  /** 직전 확인(연결·채널·동의)을 지나 SENDING을 잡은 뒤·토큰을 꺼내기 전 (시험: 여기서 연결을 끊고 다른 채널을 잇는다, AC-I3-85) */
  readonly beforePost?: (rowIds: readonly number[]) => void | Promise<void>
  /** 게시가 401을 받아 토큰을 새로 고치기 직전 (시험: 그사이 채널을 바꾼다, AC-I3-85) */
  readonly beforeRetryToken?: () => void | Promise<void>
}

/** 크롬 확장 감사 올리기 (X1 YT-10 AC13, D-X1-19) */
export interface OutboxExtension {
  /**
   * 그 회차를 확장으로 올릴 수 있으면 확장 스위치를 켠 시각(그 뒤에 생긴 감사만 맡긴다), 아니면 null.
   * 공식 경로로 올릴 수 없을 때(이은 방송 없음·연결이 살아 있지 않음·게시 권한 없음)만 묻는다
   */
  readonly route: (sellerId: string, broadcastId: string) => Promise<Date | null>
  /** 기한이 지난 맡김·결과 없이 60초가 지난 맡김을 정리한다 (바퀴마다) */
  readonly sweep: () => Promise<void>
  /** 확장에 맡겼다 (확장에 알림) */
  readonly handed?: (sellerId: string, broadcastId: string) => void
}

export interface OutboxOptions {
  readonly db: Db
  readonly timer: Timer
  readonly log: LogSink
  readonly google: GoogleClient
  readonly connections: YoutubeConnections
  readonly quota: QuotaMeter
  readonly writer: ScopeWriter
  /** 이 서버(인스턴스)의 이름 (보내는 중 임대 주인) */
  readonly owner: string
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 그 연결의 수집기가 지금 도는지 (서버 어디서든). 실시간 채팅 게시 확인은 공식 조회를 부르지 않으므로 지금은 쓰지 않는다 (D-YT-SRV-17) */
  readonly collectorRunning: (sellerId: string, linkId: string) => Promise<boolean>
  readonly hooks?: OutboxHooks
  /** 기본 순회 간격 (밀리초, 기본 1000) */
  readonly tickMs?: number
  /** 바퀴마다 성공·실패 (워커 건강 — 연속 3번 실패면 경보, AC-I3-82) */
  readonly onPass?: (ok: boolean) => void
  /** 시간 (E2E 기동만 줄인다) */
  readonly timing?: OutboxTiming
  /** 크롬 확장 감사 올리기 (X1) — 없으면 공식 경로만 */
  readonly extension?: OutboxExtension
  /**
   * 실시간 채팅 감사 다른 길 (D-YT-SEND-01~08): 고른 판매자의 "올리기" 한 번만 innertube·browser·nightbot으로 바꾼다(liveChatMessages.insert 20단위를 쓰지 않는다).
   * 동의·채널·기한·엔진 상태·묶음·게시 확인은 공식과 같다. 없으면 공식만
   */
  readonly chatSend?: ChatSendRoute
}

/**
 * 다른 길 실패 → 공식 게시 실패와 같은 처리로 (D-YT-SEND-05). 응답을 모르는 것(timeout·network·unverified)은 다시 올리지 않고 수집기가 본 글로 확인,
 * 5xx·429·로그인 문제는 다시 시도(2·4·8·16·32초, 5번 넘으면 GAVE_UP — 판매자 구글 다시 연결로 고칠 수 없어 RECONNECT로 두지 않는다),
 * 채팅 끝남·꺼짐은 CHAT_ENDED(채팅 끝 표시는 수집기가 정한다), 그 밖은 REJECTED
 */
function chatSendAsGoogle(error: ChatSendError): GoogleError {
  switch (error.kind) {
    case 'timeout':
    case 'unverified':
      return new GoogleError('timeout', null, null)
    case 'network':
      return new GoogleError('network', null, null)
    case 'server':
      return new GoogleError('http', error.status ?? 500, null)
    case 'rate':
    case 'blocked':
      return new GoogleError('http', 429, 'rateLimitExceeded')
    case 'auth':
      return new GoogleError('http', 401, null)
    case 'ended':
      return new GoogleError('http', 403, 'liveChatDisabled')
    case 'rejected':
      return new GoogleError('http', error.status ?? 400, null)
  }
}

export interface OutboxRowView {
  readonly id: number
  readonly target: OutboxTarget
  readonly broadcast: string | null
  readonly product: string | null
  readonly buyer: string | null
  readonly text: string
  readonly state: OutboxState
  readonly stateMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  readonly attempts: number
  readonly nextAt: string | null
  readonly postedAt: string | null
  readonly messageId: string | null
  readonly manual: boolean
  /** 같은 메시지로 함께 보낸(보낼) 다른 행 */
  readonly groupWith: readonly number[]
  /** 판매자가 "유튜브에 올라가 있어요"로 게시됨을 적은 행 (메시지 ID 없음, AC-I3-36) */
  readonly confirmedBySeller: boolean
  /** 알림에서 뺀 행 (알림 띠 "감사 실패"에서 세지 않는다, AC-I3-36) */
  readonly dismissed: boolean
  readonly dismissedAt: string | null
  /** 크롬 확장에 맡긴 행 (X1 D-X1-19) */
  readonly viaExtension: boolean
}

class Killed extends Error {
  constructor() {
    super('killed')
    this.name = 'Killed'
  }
}

const effectOf = (row: RunnerRow): EngineEffect | null => {
  try {
    return JSON.parse(row.body) as EngineEffect
  } catch {
    return null
  }
}

const targetOf = (row: RunnerRow): OutboxTarget => {
  if (row.kind === SUMMARY_KIND) return 'SUMMARY'
  const target = (row.target ?? effectOf(row)?.target) as OutboxTarget | null
  return target === 'VIDEO_COMMENT' ? 'VIDEO_COMMENT' : 'LIVE_CHAT'
}

export function outboxRowView(row: RunnerRow, all: readonly RunnerRow[] = []): OutboxRowView {
  const effect = row.kind === SUMMARY_KIND ? null : effectOf(row)
  const target = targetOf(row)
  const state = (row.state ?? 'WAITING') as OutboxState
  const reason = row.reason
  const text = row.postText ?? (effect?.text === null || effect?.text === undefined ? '' : target === 'LIVE_CHAT' ? liveChatText(effect.text) : commentText(effect.text))
  return {
    id: row.id,
    target,
    broadcast: row.broadcastId ?? effect?.broadcast ?? null,
    product: effect?.product ?? null,
    buyer: effect?.buyer ?? null,
    text,
    state,
    stateMessage: OUTBOX_STATE_MESSAGES[state],
    reason,
    reasonMessage: reasonMessageOf(row, reason),
    attempts: row.attempts,
    nextAt: state === 'WAITING' ? (row.nextAt?.toISOString() ?? null) : null,
    postedAt: row.postedAt?.toISOString() ?? null,
    messageId: row.remoteId,
    manual: row.manual,
    groupWith: row.groupId === null ? [] : all.filter((other) => other.groupId === row.groupId && other.id !== row.id).map((other) => other.id),
    confirmedBySeller: row.confirmedBy !== null,
    dismissed: row.dismissedAt !== null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    viaExtension: row.via === EXT_VIA,
  }
}

/** 게시됨 확인·알림에서 빼기 문장 (AC-I3-36) */
export const SELLER_OUTBOX_MESSAGES = {
  CONFIRM_NOT_ALLOWED: '확인하지 못한 감사만 올라가 있다고 적을 수 있어요.',
  DISMISS_NOT_ALLOWED: '보내지 못한 감사만 알림에서 뺄 수 있어요.',
  REHEARSAL_OUTBOX: '리허설 감사 메시지는 유튜브에 올리지 않아요.',
} as const

export class OutboxRunner {
  readonly #options: OutboxOptions
  /** 같은 유튜브 영상의 같은 감사를 누가 먼저 맡았는지 (영상 + 문구 → 판매자·시각, D-YT-SRV-22). 같은 서버 안에서 동시에 두 계정이 올리지 않게 */
  readonly #videoThanks = new Map<string, { readonly sellerId: string; readonly at: number }>()
  #loop: Promise<void> | null = null
  #stopped = false
  #killed = false
  #wake = new AbortController()
  #inflight = new AbortController()
  #running: Promise<void> | null = null
  /** 이번 바퀴에 오류가 있었는지 */
  #passFailed = false
  /** 이미 올라간 감사의 값이 고쳐지면 지우고 고친 글을 새로 올린다 (D-RETRO-105) */
  readonly #fixer: ThanksFixer

  constructor(options: OutboxOptions) {
    this.#options = options
    this.#fixer = new ThanksFixer({
      db: options.db,
      timer: options.timer,
      log: options.log,
      writer: options.writer,
      connections: options.connections,
      google: options.google,
      quota: options.quota,
      owner: options.owner,
      ...(options.chatSend === undefined ? {} : { chatSend: options.chatSend }),
      postTimeoutMs: options.timing?.postTimeoutMs ?? POST_TIMEOUT_MS,
      signal: () => this.#inflight.signal,
      check: () => this.#check(),
      killed: () => this.#killed,
    })
  }

  get owner(): string {
    return this.#options.owner
  }

  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        await this.runOnce()
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#options.timer.sleep(this.#options.tickMs ?? 1000, this.#wake.signal)
      }
    })()
  }

  /** 곧 한 바퀴 돌게 한다 (새 효과·연결·동의가 바뀜) */
  notify(): void {
    this.#wake.abort()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    await this.#running
    this.#loop = null
  }

  /** 서버가 죽은 것처럼 멈춘다 (보내던 요청을 끊고 더 쓰지 않는다 — 시험용) */
  async kill(): Promise<void> {
    this.#killed = true
    this.#stopped = true
    this.#inflight.abort()
    this.#wake.abort()
    await this.#loop?.catch(() => {})
    await this.#running?.catch(() => {})
    this.#loop = null
  }

  #check(): void {
    if (this.#killed) throw new Killed()
  }

  /** 한 바퀴: 처음 보는 행 → 서버가 죽은 뒤 남은 행 → 타임아웃 확인 → 때가 된 행 보내기 → 게시 보고 → 게시 뒤 감사 정정(D-RETRO-105) → 방송 후 요약 */
  async runOnce(): Promise<void> {
    if (this.#running !== null) return this.#running
    this.#running = (async () => {
      this.#passFailed = false
      const steps = [
        () => this.#options.quota.tick(),
        () => this.#intake(),
        () => this.#confirmAll(),
        () => this.#sendDue(),
        () => this.#options.extension?.sweep(),
        () => this.#reportAll(),
        () => this.#fixer.run(),
        () => this.#summaries(),
      ]
      for (const step of steps) {
        if (this.#killed) return
        try {
          await step()
        } catch (error) {
          if (error instanceof Killed || this.#killed) return
          this.#passFailed = true
          this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', errorKind: errorKind(error) })
        }
      }
      if (!this.#killed) this.#options.onPass?.(!this.#passFailed)
    })().finally(() => {
      this.#running = null
    })
    return this.#running
  }

  #now(): Date {
    return new Date(this.#options.timer.now())
  }

  get #postTimeoutMs(): number {
    return this.#options.timing?.postTimeoutMs ?? POST_TIMEOUT_MS
  }

  get #confirmWindowMs(): number {
    return this.#options.timing?.confirmWindowMs ?? CONFIRM_WINDOW_MS
  }

  get #lookupIntervalMs(): number {
    return this.#options.timing?.lookupIntervalMs ?? LOOKUP_INTERVAL_MS
  }

  /**
   * 같은 행의 다음 조회를 해도 되는 시각 — 확인 조회(#lookup)가 **돌아온 직후**의 시계부터 잰다 (AC-I3-87, SA-I3-009).
   * 확인을 시작할 때 읽은 시각부터 재면, 그 뒤 임대 늘리기·수집기 확인·할당량·토큰(DB)과 요청이 도는 사이 시계가 간 만큼
   * 유튜브가 실제로 받은 두 조회 사이가 10초보다 짧아진다. 돌아온 시각은 그 조회의 마지막 요청을 유튜브가 받은 시각보다 늦으므로
   * 다음 조회(그 시각 이후에 시작)까지는 늘 간격 이상이다
   */
  #nextLookup(): Date {
    return new Date(this.#options.timer.now() + this.#lookupIntervalMs)
  }

  async #update(row: Pick<RunnerRow, 'sellerId'>, ids: readonly number[], change: RowChange, expect?: Parameters<typeof updateRows>[5]): Promise<number[]> {
    this.#check()
    return updateRows(this.#options.db, row.sellerId, ids, change, this.#now(), expect)
  }

  #publishRows(sellerId: string, date: string | null, ids: readonly number[], state: string, reason: string | null): void {
    if (ids.length === 0) return
    this.#options.publish(sellerId, { kind: 'outbox', ...(date === null ? {} : { date }), ids: [...ids], state, reason })
  }

  /** 범위 상태 (한 바퀴 안에서 범위마다 한 번) */
  async #state(cache: Map<string, EngineState>, sellerId: string, date: string): Promise<EngineState> {
    const key = `${sellerId}|${date}`
    let state = cache.get(key)
    if (state === undefined) {
      state = (await this.#options.writer.read(sellerId, date, false)).state
      cache.set(key, state)
    }
    return state
  }

  // ── 처음 보는 행 (AC-Y1-31·37·40) ─────────────────────────────────────

  async #intake(): Promise<void> {
    const rows = await newThanksRows(this.#options.db)
    if (rows.length === 0) return
    const states = new Map<string, EngineState>()
    const modes = new Map<string, string>()
    for (const row of rows) {
      const effect = effectOf(row)
      if (effect === null || effect.text === null) {
        await this.#update(row, [row.id], { state: 'FAILED', reason: 'REJECTED' }, { state: null })
        continue
      }
      const target: ConsentTarget = effect.target === 'VIDEO_COMMENT' ? 'VIDEO_COMMENT' : 'LIVE_CHAT'
      const created = row.createdAt.getTime()
      const connection = await this.#options.connections.row(row.sellerId)
      const consentAt = connection === null ? null : target === 'LIVE_CHAT' ? connection.consentLiveChatAt : connection.consentVideoCommentAt
      const base: RowChange = {
        target,
        broadcastId: effect.broadcast,
        deadlineAt: new Date(created + (target === 'LIVE_CHAT' ? LIVE_CHAT_DEADLINE_MS : COMMENT_DEADLINE_MS)),
        postText: target === 'LIVE_CHAT' ? liveChatText(effect.text) : commentText(effect.text),
      }
      // 효과가 나온 때 그 대상의 동의가 없었으면 나중에 켜도 자동으로 보내지 않는다 (D-Y12)
      // 유튜브 공식 연결이 아예 없으면(YT-04 동의를 켤 수 없다) 확장 감사 스위치 동의(D-X1-17~19)를 그 회차 실시간 채팅 감사의 동의로 본다 — 맡길지는 #gate가 정한다.
      // 공식 연결이 있으면 AC11대로 YT-04 동의와 스위치가 둘 다 있어야 한다
      const officialOk = consentAt !== null && consentAt.getTime() <= created
      const extensionOk =
        connection === null && target === 'LIVE_CHAT' && this.#options.extension !== undefined && effect.broadcast !== null
          ? ((await this.#options.extension.route(row.sellerId, effect.broadcast))?.getTime() ?? Infinity) <= created
          : false
      // 봇 길(D-YT-SEND-11·18): 운영자가 고른 판매자면, 감사 효과가 생겼다는 것(앱의 실시간 채팅 감사 스위치가 켜져 있었다)을 동의로 본다.
      // 구글 연결·게시 동의와 상관없다 — 봇 판매자 화면에는 그 스위치 하나만 있다(구글 동의 칸을 숨긴다)
      const botOk = target === 'LIVE_CHAT' && effect.broadcast !== null && this.#sender(row.sellerId) !== null
      if (!officialOk && !extensionOk && !botOk) {
        await this.#update(row, [row.id], { ...base, state: 'FAILED', reason: 'NO_CONSENT' }, { state: null })
        this.#publishRows(row.sellerId, row.date, [row.id], 'FAILED', 'NO_CONSENT')
        continue
      }
      if (target === 'VIDEO_COMMENT') {
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: null, nextAt: row.createdAt, groupId: `g${String(row.id)}` }, { state: null })
        this.#publishRows(row.sellerId, row.date, [row.id], 'WAITING', null)
        continue
      }
      const state = await this.#state(states, row.sellerId, row.date)
      let mode = modes.get(row.sellerId)
      if (mode === undefined) {
        // 다른 길은 할당량을 쓰지 않는다 — 할당량 묶음 창(≥ 60초)을 두지 않는다 (D-YT-SEND-05). 초대 방송 창은 그대로
        mode = this.#sender(row.sellerId) !== null ? 'NORMAL' : await this.#options.quota.mode(row.sellerId)
        modes.set(row.sellerId, mode)
      }
      // 초대 방송인지는 행을 처음 볼 때 그 회차 이은 기록으로 (글 올리는 계정이 비면 초대 방송 아님 — D-YT-SRV-16·18)
      const link = await latestLink(this.#options.db, row.sellerId, effect.broadcast)
      const windowSec = liveChatWindowSec(batchWindowOf(state, effect.broadcast), mode, link !== null && isInvitedLink(link))
      if (windowSec <= 0) {
        // 묶지 않고 한 건씩 바로
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: null, nextAt: row.createdAt, groupId: `g${String(row.id)}` }, { state: null })
      } else {
        const open = await openWindowAt(this.#options.db, row.sellerId, row.scopeId, effect.broadcast, row.createdAt)
        await this.#update(row, [row.id], { ...base, state: 'WAITING', reason: 'WINDOW', nextAt: open ?? new Date(created + windowSec * 1000) }, { state: null })
      }
      this.#publishRows(row.sellerId, row.date, [row.id], 'WAITING', windowSec <= 0 ? null : 'WINDOW')
    }
  }

  // ── 때가 된 행 보내기 ─────────────────────────────────────────────────

  async #sendDue(): Promise<void> {
    const rows = await dueRows(this.#options.db, this.#now())
    if (rows.length === 0) return
    const units = new Map<string, RunnerRow[]>()
    for (const row of rows) {
      // 묶이기를 기다리는 실시간 채팅 감사(묶음 없음)는 그 방송끼리, 나머지는 묶음(메시지)마다
      const key = row.groupId === null ? (targetOf(row) === 'LIVE_CHAT' ? `w|${row.sellerId}|${row.scopeId}|${row.broadcastId ?? ''}` : `s|${String(row.id)}`) : `g|${row.sellerId}|${row.groupId}`
      const list = units.get(key) ?? []
      list.push(row)
      units.set(key, list)
    }
    // 같은 방송·대상의 메시지는 효과가 나온 순서대로 하나씩(채팅에 순서대로 보이게), 서로 다른 방송·대상끼리는 함께
    const lanes = new Map<string, RunnerRow[][]>()
    for (const unit of units.values()) {
      const first = unit[0] as RunnerRow
      const lane = `${first.sellerId}|${first.broadcastId ?? ''}|${targetOf(first)}`
      lanes.set(lane, [...(lanes.get(lane) ?? []), unit])
    }
    await Promise.all(
      [...lanes.values()].map(async (list) => {
        for (const unit of list.sort((a, b) => Math.min(...a.map((row) => row.id)) - Math.min(...b.map((row) => row.id)))) {
          try {
            await this.#sendUnit(unit)
          } catch (error) {
            if (error instanceof Killed || this.#killed) return
            this.#passFailed = true
            this.#options.log({ level: 'error', code: 'OUTBOX_ERROR', seller: unit[0]?.sellerId ?? '', errorKind: errorKind(error) })
          }
        }
      }),
    )
  }

  /**
   * 행 묶음 하나(같은 방송의 창, 또는 한 메시지)를 확인하고 보낸다. 메시지(200자 분할 포함)를 하나 보낼 때마다 그 직전에
   * 그 범위의 지금 엔진 상태와 연결·동의·이은 방송·할당량을 다시 본다 — 앞 메시지가 응답 없이 10초 걸리는 동안 취소된 판매·꺼진 동의를 놓치지 않는다
   * (R-13 "실행 직전", AC-Y1-32·42, D-Y12)
   */
  async #sendUnit(unit: RunnerRow[]): Promise<void> {
    const first = unit[0] as RunnerRow
    const { sellerId, date } = first
    const now = this.#now()
    const target = targetOf(first)
    let rows = [...unit].sort((a, b) => a.id - b.id)
    // 1. 기한 (수동 재전송은 기한 없음)
    const expired = rows.filter((row) => !row.manual && row.deadlineAt !== null && row.deadlineAt.getTime() <= now.getTime())
    if (expired.length > 0) {
      const ids = await this.#update(first, expired.map((row) => row.id), { state: 'FAILED', reason: 'EXPIRED', nextAt: null }, { state: 'WAITING' })
      this.#publishRows(sellerId, date, ids, 'FAILED', 'EXPIRED')
      rows = rows.filter((row) => !expired.includes(row))
    }
    while (rows.length > 0) {
      this.#check()
      // 2. 지금 엔진 상태 (R-13 실행 직전 — 메시지마다 새로 읽는다): 취소 → 건너뜀, 완료 → 게시됨.
      //    같은 상태에서 게시 직전의 문구도 읽는다 — 기다리는 동안 판매자가 고친 품종·가격이 글에 들어간다 (D-RETRO-02)
      let current: ReadonlyMap<string, string> = new Map()
      if (first.kind === 'POST_THANKS') {
        const state = (await this.#options.writer.read(sellerId, date, false)).state
        rows = await this.#engineCheck(rows, state)
        if (rows.length === 0) return
        current = currentThanksTexts(listEffects(state))
      }
      // 3. 연결·동의·권한·이은 방송·채팅·할당량
      const open = await this.#gate(rows, target)
      if (open === null || open.length === 0) return
      rows = open
      const found = await activeLink(this.#options.db, sellerId, rows[0]?.broadcastId ?? '')
      if (found === null) return
      // 글 올리는 계정·공식 채팅 ID 채우기 (서버로 이은 회차, D-YT-SRV-15·16)
      const link = await this.#prepare(rows, found, target)
      if (link === null) return
      // 한 방송 한 감사 (D-YT-SRV-22): 같은 영상에 다른 계정이 이미 같은 감사를 올렸거나 맡았으면 건너뛴다
      if (first.kind === 'POST_THANKS' && target === 'LIVE_CHAT') {
        rows = await this.#sharedSkip(rows, link)
        if (rows.length === 0) return
      }
      // 4. 문구와 메시지 — 남은 항목으로 다시 만들고(AC-Y1-42) 첫 메시지 하나만 보낸다. 나머지는 위의 직전 확인부터 다시.
      //    문구는 방금 읽은 엔진 상태의 것(고친 품종·가격, D-RETRO-02), 상태에 없으면 행에 적힌 나온 때의 문구
      const textOf = (row: RunnerRow): string => current.get(row.effectId) ?? effectOf(row)?.text ?? row.postText ?? ''
      let members: RunnerRow[]
      let text: string
      if (target === 'LIVE_CHAT') {
        const [message] = batchMessages(rows.map((row) => ({ id: row.id, text: textOf(row) })))
        if (message === undefined) return
        members = rows.filter((row) => message.ids.includes(row.id))
        if (members.length === 0) return
        text = message.text
      } else {
        const head = rows[0] as RunnerRow
        members = [head]
        text = target === 'SUMMARY' ? (head.postText ?? '') : commentText(textOf(head))
      }
      await this.#attempt(members, text, link, target)
      rows = rows.filter((row) => !members.includes(row))
    }
  }

  /**
   * 같은 유튜브 영상에 다른 계정이 같은 감사를 올렸거나(DB — SENT·보내는 중, 30분 안) 이 서버에서 먼저 맡았으면 SKIPPED(SHARED_SENT). 남은 행은 이 계정이 맡는다.
   * DB를 읽은 뒤 맡기 확인·적기는 한 번에(기다림 없이) 해서, 같은 서버의 두 계정이 같은 순간에 올려도 하나만 지난다 (D-YT-SRV-22)
   */
  async #sharedSkip(rows: RunnerRow[], link: LinkRow): Promise<RunnerRow[]> {
    const first = rows[0] as RunnerRow
    const nowMs = this.#now().getTime()
    const others = await otherSellersThanksOnVideo(this.#options.db, link.videoId, first.sellerId, new Date(nowMs - SHARED_THANKS_MS))
    const sent = new Set(others.map((body) => {
      try {
        return (JSON.parse(body) as EngineEffect).text ?? ''
      } catch {
        return ''
      }
    }))
    for (const [key, held] of this.#videoThanks) if (nowMs - held.at > SHARED_THANKS_MS) this.#videoThanks.delete(key)
    const skip: RunnerRow[] = []
    const keep: RunnerRow[] = []
    for (const row of rows) {
      // 견주는 값은 효과가 나온 때의 문구다(행에 적힌 것) — 계정마다 같은 찜에서 같은 글이 나온다. 게시 직전에 고친 문구(D-RETRO-02)로 견주면
      // 한 계정에서만 고친 감사가 다른 글로 보여 두 번 올라간다
      const text = effectOf(row)?.text ?? row.postText ?? ''
      const key = `${link.videoId}\n${text}`
      const held = this.#videoThanks.get(key)
      if (text !== '' && (sent.has(text) || (held !== undefined && held.sellerId !== row.sellerId))) {
        skip.push(row)
        continue
      }
      if (text !== '' && held === undefined) this.#videoThanks.set(key, { sellerId: row.sellerId, at: nowMs })
      keep.push(row)
    }
    if (skip.length > 0) {
      const ids = await this.#update(first, skip.map((row) => row.id), { state: 'SKIPPED', reason: 'SHARED_SENT', nextAt: null, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SKIPPED', 'SHARED_SENT')
    }
    return keep
  }

  /** 엔진 상태로 거른다: 취소된 효과는 SKIPPED, 이미 완료면 SENT(게시 없음), 문자로 찜한 손님은 SKIPPED(SMS_BUYER, D-YT-SRV-22). 남은 행 */
  async #engineCheck(rows: RunnerRow[], state: EngineState): Promise<RunnerRow[]> {
    const statuses = new Map(listEffects(state).map((effect) => [effect.id, effect.status]))
    const claimOrigin = new Map(listClaims(state).map((claim) => [claim.id, claim.origin]))
    const cancelled = rows.filter((row) => statuses.get(row.effectId) === 'CANCELLED')
    const done = rows.filter((row) => statuses.get(row.effectId) === 'DONE')
    // 문자로 찜한 손님은 유튜브 이름이 없어 "문자찜님"으로 올라갔다 — 유튜브 감사를 올리지 않는다
    const sms = rows.filter((row) => !cancelled.includes(row) && !done.includes(row) && !row.manual && claimOrigin.get(effectOf(row)?.claim ?? '') === 'sms')
    const first = rows[0] as RunnerRow
    // 기다리는 행만 바꾼다 (다른 실행기가 그사이 잡은 행은 건드리지 않고 이번엔 넘긴다)
    let taken: number[] = []
    if (sms.length > 0) {
      const ids = await this.#update(first, sms.map((row) => row.id), { state: 'SKIPPED', reason: 'SMS_BUYER', nextAt: null, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SKIPPED', 'SMS_BUYER')
      taken = [...taken, ...sms.map((row) => row.id).filter((id) => !ids.includes(id))]
    }
    if (cancelled.length > 0) {
      const ids = await this.#update(first, cancelled.map((row) => row.id), { state: 'SKIPPED', reason: 'CANCELLED', nextAt: null, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SKIPPED', 'CANCELLED')
      taken = [...taken, ...cancelled.map((row) => row.id).filter((id) => !ids.includes(id))]
    }
    if (done.length > 0) {
      const ids = await this.#update(first, done.map((row) => row.id), { state: 'SENT', reason: null, nextAt: null, reported: true, groupId: null }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, ids, 'SENT', null)
      taken = [...taken, ...done.map((row) => row.id).filter((id) => !ids.includes(id))]
    }
    if (taken.length > 0) return []
    return rows.filter((row) => !cancelled.includes(row) && !done.includes(row) && !sms.includes(row))
  }

  /**
   * 보낼 수 있는 행만 남긴다. 보낼 수 없는 행은 기다림·보내지 못함으로 바꾼다(모두 막히면 null).
   * 채널: 그 방송을 이은 채널 ID = 지금 연결한 채널 ID일 때만 — 아니면 모두 NOT_MY_CHANNEL(동의보다 먼저 본다 — 다른 채널의 채팅·영상에는
   * 어떤 행도 게시하지 않는다, AC-Y1-92·D-Y1-02). 자동 첫 시도·다시 시도·묶음의 메시지마다·영상 댓글·요약 댓글·수동 재전송 뒤의 시도 모두 여기를 지난다.
   * 동의: 수동 재전송이 아니면 지금 그 대상의 동의가 켜져 있고 그 행이 생기기 전에 켠 것이어야 한다 — 확인 중(SENDING)에 동의를 끈 행이
   * 확인 실패 뒤 다시 시도로 돌아와도 게시하지 않는다(AC-Y1-31, D-Y12). 요약 댓글은 영상 댓글 동의를 본다
   */
  async #gate(rows: RunnerRow[], target: OutboxTarget): Promise<RunnerRow[] | null> {
    const first = rows[0] as RunnerRow
    const { sellerId, date } = first
    const now = this.#now()
    const failRows = async (list: readonly RunnerRow[], reason: OutboxReason) => {
      const changed = await this.#update(first, list.map((row) => row.id), { state: 'FAILED', reason, nextAt: null }, { state: 'WAITING' })
      this.#publishRows(sellerId, date, changed, 'FAILED', reason)
    }
    const fail = async (reason: OutboxReason) => {
      await failRows(rows, reason)
      return null
    }
    const wait = async (reason: OutboxReason) => {
      const changed = await this.#update(first, rows.map((row) => row.id), { reason, nextAt: new Date(now.getTime() + RECHECK_MS) }, { state: 'WAITING' })
      if (rows.some((row) => row.reason !== reason)) this.#publishRows(sellerId, date, changed, 'WAITING', reason)
      return null
    }
    const connection = await this.#options.connections.row(sellerId)
    const link = connection === null && !(target === 'LIVE_CHAT' && this.#sender(sellerId) !== null) ? null : await activeLink(this.#options.db, sellerId, first.broadcastId ?? '')
    // 글 올리는 계정이 비어 있으면(구글 연결 없이 이음) 채널 다름이 아니다 — 올리기 바로 전에 그때 연결한 채널을 적는다 (D-YT-SRV-16)
    if (connection !== null && link !== null && link.channelId !== null && link.channelId !== connection.channelId) return fail('NOT_MY_CHANNEL')
    const consentAt = connection === null ? null : target === 'LIVE_CHAT' ? connection.consentLiveChatAt : connection.consentVideoCommentAt
    const consented = (row: RunnerRow) => row.manual || (consentAt !== null && consentAt.getTime() <= row.createdAt.getTime())
    // 공식 경로로 올릴 수 없으면(연결 없음·살아 있지 않음·게시 권한 없음·이은 방송 없음) '동의 전'으로 끝내기 전에 확장에 맡길 수 있는지 먼저 본다 (X1 D-X1-17~19).
    // 확장 스위치를 켠 뒤에 생긴 자동 감사만 맡기고, 맡긴 행은 공식 실행기가 다시 집지 않는다. 공식 연결이 있으면 YT-04 동의도 있어야 한다(AC11).
    // 공식으로 올릴 수 있으면 공식만(이중 게시 금지)
    // 봇 길(D-YT-SEND-11): 판매자 구글 토큰·게시 권한·할당량을 쓰지 않는다 — 연결이 있으면 그 동의만 보고, 없으면 감사 효과가 곧 동의다.
    // 이은 방송·채팅 끝은 공식과 같다. 확장에는 맡기지 않는다(같은 감사를 두 길로 올리지 않는다)
    // 동의는 감사 스위치 하나 (D-YT-SEND-18 — 효과가 있으면 켜져 있었다)
    if (target === 'LIVE_CHAT' && this.#sender(sellerId) !== null) {
      if (link === null) return fail('NO_LINK')
      if (link.chatEndedAt !== null) return fail('CHAT_ENDED')
      return rows
    }
    const official = connection !== null && connection.status === 'CONNECTED' && connection.canPublish && link !== null
    if (!official && target === 'LIVE_CHAT' && this.#options.extension !== undefined && first.broadcastId !== null) {
      const enabledAt = await this.#options.extension.route(sellerId, first.broadcastId)
      if (enabledAt !== null) {
        const handed = rows.filter((row) => !row.manual && row.createdAt.getTime() >= enabledAt.getTime() && (connection === null || consented(row)))
        if (handed.length > 0) {
          this.#check()
          const ids = await handToExtension(this.#options.db, sellerId, handed.map((row) => row.id), now)
          this.#publishRows(sellerId, date, ids, 'WAITING', 'EXTENSION')
          if (ids.length > 0) this.#options.extension.handed?.(sellerId, first.broadcastId)
          rows = rows.filter((row) => !handed.includes(row))
          if (rows.length === 0) return null
        }
      }
    }
    if (connection === null) return fail('NO_CONSENT')
    const noConsent = rows.filter((row) => !consented(row))
    if (noConsent.length > 0) {
      await failRows(noConsent, 'NO_CONSENT')
      rows = rows.filter((row) => !noConsent.includes(row))
      if (rows.length === 0) return null
    }
    if (connection.status !== 'CONNECTED') return wait('RECONNECT')
    if (!connection.canPublish) return fail('NO_PERMISSION')
    if (link === null) return fail('NO_LINK')
    if (target === 'LIVE_CHAT' && link.chatEndedAt !== null) return fail('CHAT_ENDED')
    const mode = await this.#options.quota.mode(sellerId)
    if (mode === 'PAUSED') return wait('QUOTA')
    if (mode === 'BATCH' && target !== 'LIVE_CHAT' && rows.some((row) => !row.manual)) return wait('QUOTA')
    return rows
  }

  /**
   * 서버로 이은 회차의 올리기 준비 (게시 검사를 지난 뒤·올리기 바로 전, D-YT-SRV-15·16). 행은 아직 WAITING이다.
   * 1. 글 올리는 계정이 비어 있으면 그때 연결한 채널을 적는다(비어 있을 때만 — 한 번 적으면 바뀌지 않는다). 공식 경로 무엇이든(실시간 채팅·영상 댓글·요약).
   * 2. 실시간 채팅이고 공식 채팅 ID가 비어 있으면 글 올리는 계정의 토큰으로 videos.list(liveStreamingDetails) 한 번 → activeLiveChatId를 적는다
   *    (비어 있을 때만 — 둘이 함께 받아도 먼저 적은 값). 서버 API 키는 쓰지 않는다. 이 조회로 채팅 끝을 적지 않는다(채팅 끝은 서버 수집기가 정한다).
   * 올릴 수 있으면 채운 회차, 아니면 null(행은 이유와 함께 기다림·보내지 못함으로 바꿨다)
   */
  async #prepare(rows: RunnerRow[], link: LinkRow, target: OutboxTarget): Promise<LinkRow | null> {
    const first = rows[0] as RunnerRow
    const { db, connections, google } = this.#options
    let current = link
    // 봇 길은 글 올리는 계정이 봇이다 — 판매자 채널을 적지 않는다. 공식 채팅 ID가 필요 없는 길(innertube·browser)은 그대로 올린다 (D-YT-SEND-11)
    const botSender = target === 'LIVE_CHAT' ? this.#sender(first.sellerId) : null
    // 공식 채팅 ID를 받을 토큰의 채널: 글 올리는 계정, 봇 길이면 지금 연결한 채널 (nightbot — 받기만 하고 적지 않는다)
    let tokenChannel = current.channelId
    if (botSender !== null) {
      if (!botSender.needsLiveChatId || current.liveChatId !== '') return current
      const connection = await connections.row(first.sellerId)
      if (connection === null) {
        await this.#failWaiting(rows, 'REJECTED')
        return null
      }
      tokenChannel = connection.channelId
    }
    if (current.channelId === null && botSender === null) {
      const connection = await connections.row(first.sellerId)
      // #gate가 연결·권한을 막 봤다 — 그사이 끊겼으면 다음 바퀴에 #gate가 다시 정한다
      if (connection === null) return null
      this.#check()
      const poster = await fillLinkPoster(db, first.sellerId, current.id, connection.channelId)
      current = { ...current, channelId: poster }
      if (poster !== connection.channelId) {
        await this.#failWaiting(rows, 'NOT_MY_CHANNEL')
        return null
      }
    }
    if (target !== 'LIVE_CHAT' || current.liveChatId !== '') return current
    // 공식 채팅 ID가 필요 없는 다른 길(innertube·browser — 영상 ID로 올린다)은 받지 않는다 (D-YT-SEND-05)
    if (this.#sender(first.sellerId)?.needsLiveChatId === false) return current
    const videoId = current.videoId
    let body: Record<string, unknown>
    try {
      // 글 올리는 계정의 토큰으로만 — 꺼내는 순간 연결 채널이 다르면 부르지 않는다 (D-I3-17 (1))
      body = await connections.withChannelToken(first.sellerId, (botSender === null ? current.channelId : tokenChannel) ?? '', (token) =>
        google.api({
          sellerId: first.sellerId,
          method: 'videos.list',
          accessToken: token,
          path: '/videos',
          query: { part: 'liveStreamingDetails', id: videoId },
          timeoutMs: this.#postTimeoutMs,
          signal: this.#inflight.signal,
        }),
      )
    } catch (error) {
      this.#check()
      await this.#chatIdFailed(rows, error)
      return null
    }
    this.#check()
    const items = (Array.isArray(body.items) ? body.items : []) as unknown[]
    const item = items.find((candidate): candidate is Record<string, unknown> => typeof candidate === 'object' && candidate !== null && (candidate as Record<string, unknown>).id === videoId)
    const details = (item?.liveStreamingDetails ?? {}) as Record<string, unknown>
    const chatId = typeof details.activeLiveChatId === 'string' ? details.activeLiveChatId : ''
    if (chatId === '') {
      // 영상이 없거나 채팅 ID가 없다(끝남·채팅 꺼짐·사장님 계정에 보이지 않음 — 이유를 가리지 않는다). 아무것도 적지 않는다 — 다음 감사가 다시 묻는다
      await this.#failWaiting(rows, 'REJECTED')
      return null
    }
    const saved = await fillLinkLiveChatId(db, first.sellerId, current.id, chatId)
    return { ...current, liveChatId: saved === '' ? chatId : saved }
  }

  /** 기다리는 행 → 보내지 못함 (올리기 준비에서) */
  async #failWaiting(rows: readonly RunnerRow[], reason: OutboxReason): Promise<void> {
    const first = rows[0] as RunnerRow
    const changed = await this.#update(first, rows.map((row) => row.id), { state: 'FAILED', reason, nextAt: null }, { state: 'WAITING' })
    this.#publishRows(first.sellerId, first.date, changed, 'FAILED', reason)
  }

  /**
   * 채팅 ID 받기 실패 (D-YT-SRV-15): 아직 아무것도 올리지 않았으므로 확인 없이 게시 실패와 같은 이유·같은 다시 시도로 다룬다.
   * 연결 오류·시간 초과·5xx·429·속도 제한 → 다시 시도(2·4·8·16·32초, 5번 넘으면 GAVE_UP) · 토큰을 쓸 수 없음 → RECONNECT 기다림 ·
   * 할당량 초과 → QUOTA 기다림 · 권한 없음 → NO_PERMISSION · 채널이 다름 → NOT_MY_CHANNEL · 그 밖의 거절 → REJECTED
   */
  async #chatIdFailed(rows: RunnerRow[], error: unknown): Promise<void> {
    const first = rows[0] as RunnerRow
    const { log, quota } = this.#options
    const back = async (reason: OutboxReason) => {
      const changed = await this.#update(first, rows.map((row) => row.id), { reason, nextAt: new Date(this.#now().getTime() + RECHECK_MS) }, { state: 'WAITING' })
      this.#publishRows(first.sellerId, first.date, changed, 'WAITING', reason)
    }
    if (error instanceof ChannelMismatchError) return this.#failWaiting(rows, 'NOT_MY_CHANNEL')
    if (error instanceof YoutubeAccessError) return back('RECONNECT')
    if (!(error instanceof GoogleError)) {
      log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: first.sellerId, errorKind: errorKind(error) })
      return this.#failAttempt(rows, 'WAITING')
    }
    log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: first.sellerId, ...googleFields(error) })
    if (error.kind === 'timeout' || error.kind === 'network') return this.#failAttempt(rows, 'WAITING')
    const reason = error.reason
    if (reason === 'quotaExceeded') {
      await quota.markExceeded(first.sellerId)
      return back('QUOTA')
    }
    if (reason === 'forbidden' || reason === 'insufficientPermissions') return this.#failWaiting(rows, 'NO_PERMISSION')
    const status = error.status ?? 0
    if (status >= 500 || status === 429 || status === 401 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return this.#failAttempt(rows, 'WAITING')
    return this.#failWaiting(rows, 'REJECTED')
  }

  /** 한 메시지 시도: SENDING을 잡고 → (지난 시도의 글이 올라가 있으면 SENT) → 게시 */
  async #attempt(rows: RunnerRow[], text: string, link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const groupId = first.groupId ?? `g${String(Math.min(...ids))}`
    // 지난 시도(5xx·확인 실패 등)의 글이 수집기에 보였으면 다시 보내지 않는다 — 이미 다른 묶음이 가진 메시지는 고르지 않는다 (AC-Y1-36·93).
    // 같은 글을 지금 게시하는 중인 다른 묶음이 있으면 그 응답을 본 뒤로 미룬다(다음 바퀴)
    if (first.attempts > 0 && first.sentText !== null && first.attemptAt !== null && target === 'LIVE_CHAT') {
      const outcome = await this.#claim(rows, link, target, [], 'WAITING')
      if (outcome !== 'none') return
    }
    const claimed = await this.#update(
      first,
      ids,
      {
        state: 'SENDING',
        reason: null,
        groupId,
        sentText: text,
        postText: text,
        attemptAt: now,
        confirmUntil: null,
        confirmTries: 0,
        nextAt: null,
        leaseOwner: this.#options.owner,
        leaseUntil: new Date(now.getTime() + SENDING_LEASE_MS),
      },
      { state: 'WAITING' },
    )
    if (claimed.length !== ids.length) {
      // 다른 실행기가 일부를 먼저 잡았다 — 잡은 것을 되돌리고 이번엔 넘긴다
      if (claimed.length > 0) await this.#update(first, claimed, { state: 'WAITING', leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      return
    }
    this.#publishRows(first.sellerId, first.date, ids, 'SENDING', null)
    const sending = rows.map((row) => ({ ...row, groupId, sentText: text, attemptAt: now, state: 'SENDING', reason: null, confirmTries: 0 }))
    await this.#options.hooks?.beforePost?.(ids)
    this.#check()
    let remoteId: string
    const sender = target === 'LIVE_CHAT' ? this.#sender(first.sellerId) : null
    let author = sender?.authorChannelId ?? link.channelId
    try {
      if (sender !== null) {
        const other = await this.#sendOther(sender, link, text, first.sellerId)
        remoteId = other.id
        author = other.author
        this.#check()
      } else {
      // 그 방송을 이은 채널의 토큰으로만 — 꺼내는 순간 채널이 다르면 보내지 않는다 (D-I3-17 (1), AC-I3-85)
      const body = await this.#options.connections.withChannelToken(first.sellerId, link.channelId ?? '', (token) =>
        target === 'LIVE_CHAT'
          ? this.#options.google.api({
              sellerId: first.sellerId,
              method: 'liveChatMessages.insert',
              accessToken: token,
              httpMethod: 'POST',
              path: '/liveChat/messages',
              query: { part: 'snippet' },
              body: { snippet: { liveChatId: link.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
              timeoutMs: this.#postTimeoutMs,
              signal: this.#inflight.signal,
            })
          : this.#options.google.api({
              sellerId: first.sellerId,
              method: 'commentThreads.insert',
              accessToken: token,
              httpMethod: 'POST',
              path: '/commentThreads',
              query: { part: 'snippet' },
              body: { snippet: { videoId: link.videoId, topLevelComment: { snippet: { textOriginal: text } } } },
              timeoutMs: this.#postTimeoutMs,
              signal: this.#inflight.signal,
            }),
        () => this.#options.hooks?.beforeRetryToken?.(),
      )
      this.#check()
      remoteId = typeof body.id === 'string' ? body.id : ''
      }
    } catch (error) {
      this.#check()
      await this.#postFailed(sending, error, link, target)
      return
    }
    await this.#options.hooks?.afterPost?.(ids)
    this.#check()
    if (target === 'LIVE_CHAT' && remoteId !== '') {
      await insertOwnMessage(this.#options.db, {
        sellerId: first.sellerId,
        scopeId: first.scopeId,
        linkId: link.id,
        liveChatId: link.liveChatId,
        authorChannelId: author,
        messageId: remoteId,
        text,
        publishedAt: now,
      })
    }
    await this.#sent(sending, remoteId === '' ? null : remoteId)
  }

  /** 그 판매자의 실시간 채팅 감사 다른 길 (없으면 공식) */
  #sender(sellerId: string): ChatSender | null {
    return this.#options.chatSend?.senderFor(sellerId) ?? null
  }

  /**
   * 다른 길로 한 번 올린다 (D-YT-SEND-05). 판매자 구글 토큰·할당량을 쓰지 않는다. 메시지 ID를 모르면 ''.
   * 실패는 종류만 로그에 남기고(쿠키·토큰·본문 없음) 공식 게시 실패와 같은 GoogleError로 바꿔 던진다
   */
  async #sendOther(sender: ChatSender, link: LinkRow, text: string, sellerId: string): Promise<{ id: string; author: string }> {
    try {
      const result = await sender.send({ videoId: link.videoId, channelId: link.broadcastChannelId, liveChatId: link.liveChatId }, text, this.#inflight.signal)
      // 실제로 올린 계정 (봇 계정 여럿·공식 넘김) — 게시 확인·우리 글 거르기에 쓴다
      return { id: result.messageId ?? '', author: result.authorChannelId ?? sender.authorChannelId }
    } catch (error) {
      if (!(error instanceof ChatSendError)) throw error
      // 로그인·토큰 문제는 운영자가 봇 계정을 다시 이어야 한다 — 경보로 남긴다
      this.#options.log({ level: error.kind === 'auth' ? 'error' : 'warn', code: error.kind === 'auth' ? 'CHAT_SEND_AUTH' : 'CHAT_SEND_FAILED', seller: sellerId, route: sender.route, errorKind: error.kind, ...(error.status === null ? {} : { status: error.status }) })
      throw chatSendAsGoogle(error)
    }
  }

  /** 게시 실패 처리 (AC-Y1-35·36) */
  async #postFailed(rows: RunnerRow[], error: unknown, link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const now = this.#now()
    const { log, quota } = this.#options
    const back = async (reason: OutboxReason, delayMs: number) => {
      const changed = await this.#update(first, ids, { state: 'WAITING', reason, nextAt: new Date(now.getTime() + delayMs), leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      this.#publishRows(first.sellerId, first.date, changed, 'WAITING', reason)
    }
    const fail = async (reason: OutboxReason) => {
      const changed = await this.#update(first, ids, { state: 'FAILED', reason, nextAt: null, leaseOwner: null, leaseUntil: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      this.#publishRows(first.sellerId, first.date, changed, 'FAILED', reason)
    }
    // 토큰을 꺼내는 순간 연결의 채널이 그 방송을 이은 채널과 달랐다 — 보내지 않았다 (묶음이면 함께, AC-I3-85)
    if (error instanceof ChannelMismatchError) return fail('NOT_MY_CHANNEL')
    if (error instanceof YoutubeAccessError) return back('RECONNECT', RECHECK_MS)
    if (!(error instanceof GoogleError)) {
      log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, errorKind: errorKind(error) })
      return this.#failAttempt(rows)
    }
    log({ level: 'warn', code: 'OUTBOX_POST_FAILED', seller: first.sellerId, ...googleFields(error) })
    // 응답을 모른다(타임아웃·연결 끊김): 바로 다시 보내지 않고 올라갔는지 확인한다
    if (error.kind === 'timeout' || error.kind === 'network') {
      const confirmUntil = new Date(now.getTime() + this.#confirmWindowMs)
      await this.#update(first, ids, { reason: 'CONFIRM', confirmUntil, nextAt: null }, { state: 'SENDING', leaseOwner: this.#options.owner })
      await this.#confirm(rows.map((row) => ({ ...row, reason: 'CONFIRM', confirmUntil, nextAt: null })), link, target)
      return
    }
    const reason = error.reason
    if (reason === 'quotaExceeded') {
      await quota.markExceeded(first.sellerId)
      return back('QUOTA', RECHECK_MS)
    }
    if (reason === 'liveChatEnded' || reason === 'liveChatDisabled') {
      if (reason === 'liveChatEnded') await markChatEnded(this.#options.db, first.sellerId, link.id, now)
      return fail('CHAT_ENDED')
    }
    if (reason === 'forbidden' || reason === 'insufficientPermissions') return fail('NO_PERMISSION')
    const status = error.status ?? 0
    if (status >= 500 || status === 429 || status === 401 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return this.#failAttempt(rows)
    return fail('REJECTED')
  }

  /** 실패 한 번: 2·4·8·16·32초 뒤 다시, 5번을 넘으면 GAVE_UP. expect = 지금 행 상태(보내는 중, 채팅 ID 받기 실패는 기다림) */
  async #failAttempt(rows: RunnerRow[], expect: 'SENDING' | 'WAITING' = 'SENDING'): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const attempts = first.attempts + 1
    const now = this.#now()
    if (attempts > MAX_RETRIES) {
      const changed = await this.#update(first, ids, { state: 'FAILED', reason: 'GAVE_UP', attempts, nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 }, { state: expect })
      this.#publishRows(first.sellerId, first.date, changed, 'FAILED', 'GAVE_UP')
      if (changed.length > 0) this.#options.log({ level: 'warn', code: 'OUTBOX_GAVE_UP', seller: first.sellerId, date: first.date })
      return
    }
    const changed = await this.#update(
      first,
      ids,
      { state: 'WAITING', reason: 'RETRY', attempts, nextAt: new Date(now.getTime() + 2 ** attempts * (this.#options.timing?.retryBaseMs ?? 1000)), leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 },
      { state: expect },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'WAITING', 'RETRY')
  }

  /** 게시됨: ID·시각을 적고 효과마다 게시 보고 */
  async #sent(rows: RunnerRow[], remoteId: string | null): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    const changed = await this.#update(
      first,
      ids,
      { state: 'SENT', reason: null, remoteId, postedAt: this.#now(), nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null, confirmTries: 0 },
      { state: 'SENDING' },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'SENT', null)
    await this.#report(rows.filter((row) => changed.includes(row.id)))
  }

  // ── 게시 보고 (AC-Y1-34) ──────────────────────────────────────────────

  async #report(rows: readonly RunnerRow[]): Promise<void> {
    for (const row of rows) {
      if (row.kind !== 'POST_THANKS') continue
      this.#check()
      const requestId = `ytsent-${String(row.id)}`
      // 판매자가 "유튜브에 올라가 있어요"로 적은 행은 그 계정이 조치자다 (AC-I3-36·DAT-05) — 요청 번호는 같아 누가 먼저 써도 한 번만
      const actor: Actor = row.confirmedBy === null ? { kind: 'server' } : { kind: 'account', accountId: row.confirmedBy }
      const outcome = await this.#options.writer.write({
        sellerId: row.sellerId,
        date: row.date,
        rehearsal: false,
        createScope: false,
        requestId,
        build: () => [{ fields: { type: 'effect.thanksSent', effectId: row.effectId }, actor, requestId }],
      })
      // 기록됐거나(같은 요청 번호면 처음 것) 더 쓸 수 없는 범위(봉인)면 보고를 마친다. 저장 실패면 다음 바퀴에 보고만 다시
      if (outcome.kind === 'ok' || outcome.kind === 'duplicate' || outcome.kind === 'empty' || (outcome.kind === 'rejected' && outcome.rejection.code === 'SEALED')) {
        await this.#update(row, [row.id], { reported: true })
      } else {
        this.#options.log({ level: 'warn', code: 'OUTBOX_REPORT_FAILED', seller: row.sellerId, date: row.date })
      }
    }
  }

  async #reportAll(): Promise<void> {
    const rows = await unreportedRows(this.#options.db)
    await this.#report(rows)
  }

  // ── 타임아웃 확인·서버가 죽은 뒤 (AC-Y1-36) ────────────────────────────

  async #confirmAll(): Promise<void> {
    const rows = await sendingRows(this.#options.db)
    if (rows.length === 0) return
    const now = this.#now()
    const groups = new Map<string, RunnerRow[]>()
    for (const row of rows) {
      const key = `${row.sellerId}|${row.groupId ?? String(row.id)}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const group of groups.values()) {
      const first = group[0] as RunnerRow
      const confirming = first.reason === 'CONFIRM' || first.reason === 'CONFIRM_LISTED' || first.reason === 'CONFIRM_LIST_FAILED'
      const leaseLive = first.leaseUntil !== null && first.leaseUntil.getTime() > now.getTime()
      if (!confirming && leaseLive) continue // 다른 실행기가 보내는 중
      if (confirming && leaseLive && first.leaseOwner !== this.#options.owner) continue
      let rowsNow = group
      if (!confirming || first.leaseOwner !== this.#options.owner) {
        // 서버가 죽은 뒤 남은 행(임대 지남): 확인부터 한다. 임대를 넘겨받는다(한 문장). 게시 중에 죽은 행의 확인 시간은 그 시도의 타임아웃부터 30초 —
        // 임대(60초)가 지났으니 이미 끝났다: 바로 끝 조회부터 (AC-Y1-96)
        const until = new Date(now.getTime() + SENDING_LEASE_MS)
        const confirmUntil = first.confirmUntil ?? (first.attemptAt === null ? now : new Date(first.attemptAt.getTime() + this.#postTimeoutMs + this.#confirmWindowMs))
        const ids = group.map((row) => row.id)
        const claimed = await this.#update(first, ids, { reason: confirming ? first.reason : 'CONFIRM', confirmUntil, leaseOwner: this.#options.owner, leaseUntil: until }, { state: 'SENDING', ...(first.leaseOwner === null ? {} : { leaseOwner: first.leaseOwner }) })
        if (claimed.length !== ids.length) continue
        rowsNow = group.map((row) => ({ ...row, reason: confirming ? row.reason : 'CONFIRM', confirmUntil, leaseOwner: this.#options.owner, leaseUntil: until }))
      }
      const target = targetOf(first)
      const link = await latestLink(this.#options.db, first.sellerId, first.broadcastId ?? '')
      if (link === null) {
        await this.#failAttempt(rowsNow)
        continue
      }
      await this.#confirm(rowsNow, link, target)
    }
  }

  /**
   * 그 시도의 글이 올라갔는지 본다 (AC-Y1-36·93·96). 찾으면 SENT, 아니면 다음 바퀴에 다시.
   * - 실시간 채팅: 수집기가 본 우리 메시지를 바퀴마다 본다. 수집기가 LIVE가 아니면 확인 시간 안에 이른 조회를 한 번 한다(실패해도 한 번).
   * - 영상·요약 댓글: 확인 시간 안에 최근 댓글 이른 조회를 한 번 한다.
   * - 확인 시간이 끝나면 끝 조회: 성공한 조회로 못 찾았을 때만 실패 한 번(다시 시도). 끝 조회 실패는 다음 바퀴에 다시, 3번이면 UNCONFIRMED
   */
  async #confirm(rows: RunnerRow[], link: LinkRow, target: OutboxTarget): Promise<void> {
    const first = rows[0] as RunnerRow
    const ids = rows.map((row) => row.id)
    if (first.sentText === null) {
      await this.#failAttempt(rows)
      return
    }
    const owner = this.#options.owner
    const now = this.#options.timer.now()
    // 확인이 길어져도(조회 시간 제한·끝 조회 다시 하기) 다른 실행기가 이 행을 넘겨받지 않게 임대를 늘린다
    const kept = await this.#update(first, ids, { leaseUntil: new Date(now + SENDING_LEASE_MS) }, { state: 'SENDING', leaseOwner: owner })
    if (kept.length !== ids.length) return
    const until = first.confirmUntil?.getTime() ?? 0
    if (target === 'LIVE_CHAT') {
      // 실시간 채팅 (D-YT-SRV-17): 공식 조회를 부르지 않는다 — 서버 수집기가 그 회차에서 본 우리 글(작성자 = 글 올리는 계정·같은 문구·시도 시작 5초 전 이후,
      // 다른 묶음이 가진 글은 빼고)로만 확인한다. 바퀴마다 본다. 확인 시간 안에 보면 게시됨, 끝날 때까지 못 보면 다시 게시하지 않고 UNCONFIRMED
      const outcome = await this.#claim(rows, link, target, [], 'SENDING')
      if (outcome === 'sent' || outcome === 'gone') return
      if (now < until) return
      if (outcome === 'defer') {
        // 같은 글을 지금 게시하는 중인 다른 묶음의 응답을 기다린다 — 10초 간격으로 3번까지, 그래도 정하지 못하면 UNCONFIRMED (D-I3-17 (3))
        if (first.nextAt !== null && now < first.nextAt.getTime()) return
        const tries = first.confirmTries + 1
        if (tries < MAX_CONFIRM_TRIES) {
          await this.#update(first, ids, { confirmTries: tries, nextAt: new Date(now + this.#lookupIntervalMs) }, { state: 'SENDING', leaseOwner: owner })
          return
        }
        await this.#unconfirmed(rows, tries)
        return
      }
      await this.#unconfirmed(rows, first.confirmTries)
      return
    }
    // 같은 행의 조회 사이는 10초 이상 (AC-I3-87) — 확인 중인 행(SENDING)의 next_at = 다음 조회를 해도 되는 시각
    if (first.nextAt !== null && now < first.nextAt.getTime()) return
    if (now < until) {
      // 2. 이른 조회 (시도마다 한 번): 영상·요약 댓글
      if (first.reason !== 'CONFIRM') return
      const lookup = await this.#lookup(first, link)
      const nextLookup = this.#nextLookup()
      await this.#update(first, ids, { reason: lookup === null || !lookup.complete ? 'CONFIRM_LIST_FAILED' : 'CONFIRM_LISTED', nextAt: nextLookup }, { state: 'SENDING', leaseOwner: owner })
      if (lookup !== null) await this.#claim(rows, link, target, lookup.found, 'SENDING')
      return
    }
    // 3. 끝 조회 (확인 시간이 끝난 뒤, 3번까지): 그 시도 뒤의 글을 모두 본 조회로도 못 찾았을 때만 다시 게시한다.
    //    조회 실패·같은 글을 게시하는 중인 다른 묶음 때문에 짝짓기를 미룸은 모두 한 번으로 센다 — 3번 안에 정하지 못하면 UNCONFIRMED(다시 게시 없음)
    //    다 보지 못한 조회(실시간 채팅의 첫 쪽이 기준 시각까지 거슬러 가지 못함·5쪽 상한)는 찾은 글로 짝지을 수는 있어도, 못 찾음은 실패한 조회다 (RA-I3-001)
    const lookup = await this.#lookup(first, link)
    const nextLookup = this.#nextLookup()
    const claimed = lookup === null ? 'failed' : await this.#claim(rows, link, target, lookup.found, 'SENDING')
    const outcome = claimed === 'none' && lookup !== null && !lookup.complete ? 'failed' : claimed
    if (outcome === 'sent' || outcome === 'gone') return
    if (outcome === 'none') {
      await this.#failAttempt(rows)
      return
    }
    const tries = first.confirmTries + 1
    if (tries < MAX_CONFIRM_TRIES) {
      await this.#update(first, ids, { confirmTries: tries, nextAt: nextLookup }, { state: 'SENDING', leaseOwner: owner })
      return
    }
    await this.#unconfirmed(rows, tries)
  }

  /** 확인하지 못했다: 다시 게시하지 않는다(두 번 게시보다 빠짐이 안전하다). 게시 보고도 하지 않는다 — 판매자가 유튜브를 보고 다시 보낸다 (D-Y1-06) */
  async #unconfirmed(rows: RunnerRow[], tries: number): Promise<void> {
    const first = rows[0] as RunnerRow
    const changed = await this.#update(
      first,
      rows.map((row) => row.id),
      { state: 'FAILED', reason: 'UNCONFIRMED', confirmTries: tries, nextAt: null, leaseOwner: null, leaseUntil: null, confirmUntil: null },
      { state: 'SENDING', leaseOwner: this.#options.owner },
    )
    this.#publishRows(first.sellerId, first.date, changed, 'FAILED', 'UNCONFIRMED')
    if (changed.length > 0) this.#options.log({ level: 'warn', code: 'OUTBOX_UNCONFIRMED', seller: first.sellerId, date: first.date })
  }

  /**
   * 게시 확인 짝짓기 (AC-Y1-93): 찾은 후보와 수집기가 본 우리 메시지 중 이 묶음의 메시지를 골라 SENT로 적고 게시 보고를 한다.
   * sent(적음) · none(없음) · defer(같은 글을 게시하는 중인 묶음의 응답을 기다림) · gone(다른 실행기가 바꿈)
   */
  async #claim(rows: RunnerRow[], link: LinkRow, target: OutboxTarget, candidates: readonly RemoteCandidate[], state: 'SENDING' | 'WAITING'): Promise<'sent' | 'none' | 'defer' | 'gone'> {
    this.#check()
    const first = rows[0] as RunnerRow
    const result = await claimRemote(this.#options.db, {
      sellerId: first.sellerId,
      broadcastId: first.broadcastId ?? link.broadcastId,
      targets: target === 'LIVE_CHAT' ? ['LIVE_CHAT'] : ['VIDEO_COMMENT', 'SUMMARY'],
      text: first.sentText ?? '',
      selfIds: rows.map((row) => row.id),
      selfState: state,
      ...(state === 'SENDING' ? { selfOwner: this.#options.owner } : {}),
      // 다른 길로 올린 글은 그 길의 작성자(봇 계정·Nightbot)도 우리 글로 본다 (D-YT-SEND-06)
      own: target === 'LIVE_CHAT' ? { linkId: link.id, posterChannelId: link.channelId, otherAuthors: this.#options.chatSend?.authorsFor(first.sellerId) ?? [] } : null,
      candidates,
      slackMs: CONFIRM_SLACK_MS,
      now: this.#now(),
    })
    if (result.kind !== 'claimed') return result.kind
    this.#publishRows(first.sellerId, first.date, result.ids, 'SENT', null)
    await this.#report(rows.filter((row) => result.ids.includes(row.id)))
    return 'sent'
  }

  /**
   * 확인 조회 한 번 — 영상·요약 댓글만 (실시간 채팅은 공식 조회를 부르지 않는다, D-YT-SRV-17). 글 올리는 계정이 쓴 같은 글 전부(그 시도 시작 − 5초 이후).
   * 응답의 다음 쪽을 따라가며(최신순, 기준 시각보다 이른 항목이 나올 때까지 — 다음 쪽이 없으면 끝, 많아야 5쪽, 쪽마다 할당량에 센다) 찾은 글과
   * 그 범위를 **모두 봤는지**(complete)를 돌려준다 (D-I3-17 (2), AC-I3-86). 못 찾음은 모두 본 조회일 때만 결과다 — 다 보지 못했으면 실패한 조회로 센다.
   * 조회하지 못하면 null: 네트워크·시간 제한·5xx·429·속도 제한·할당량 초과·권한 없음·401 뒤 새로 고침 실패, 다시 연결 필요, 할당량 멈춤이라 부르지 않음,
   * 그 방송을 이은 채널의 토큰을 꺼낼 수 없음(채널이 바뀜 — AC-I3-85)
   */
  async #lookup(row: RunnerRow, link: LinkRow): Promise<{ readonly found: RemoteCandidate[]; readonly complete: boolean } | null> {
    const { connections, google, quota, log } = this.#options
    const text = row.sentText ?? ''
    const since = row.attemptAt === null ? 0 : row.attemptAt.getTime() - CONFIRM_SLACK_MS
    const found: RemoteCandidate[] = []
    let pageToken: string | null = null
    for (let page = 0; page < LOOKUP_MAX_PAGES; page++) {
      if ((await quota.mode(row.sellerId)) === 'PAUSED') return null
      let body: Record<string, unknown>
      try {
        const query: Record<string, string> = { part: 'snippet', videoId: link.videoId, order: 'time', maxResults: String(COMMENT_LOOKUP_PAGE) }
        if (pageToken !== null) query.pageToken = pageToken
        body = await connections.withChannelToken(row.sellerId, link.channelId ?? '', (token) =>
          google.api({ sellerId: row.sellerId, method: 'commentThreads.list', accessToken: token, path: '/commentThreads', query, signal: this.#inflight.signal }),
        )
      } catch (error) {
        log({ level: 'warn', code: 'YOUTUBE_API_FAILED', seller: row.sellerId, ...googleFields(error) })
        if (error instanceof GoogleError && error.reason === 'quotaExceeded') await quota.markExceeded(row.sellerId)
        return null
      }
      if (!Array.isArray(body.items)) return null
      const items = body.items as Record<string, unknown>[]
      let reachedOlder = false
      for (const item of items) {
        if (typeof item.id !== 'string') continue
        const top = (((item.snippet ?? {}) as Record<string, unknown>).topLevelComment ?? {}) as Record<string, unknown>
        const snippet = (top.snippet ?? {}) as Record<string, unknown>
        const author = ((snippet.authorChannelId ?? {}) as Record<string, unknown>).value
        const published = Date.parse(typeof snippet.publishedAt === 'string' ? snippet.publishedAt : '')
        if (Number.isFinite(published) && published < since) reachedOlder = true
        if (author === link.channelId && snippet.textOriginal === text && Number.isFinite(published) && published >= since) found.push({ id: item.id, publishedAt: published })
      }
      const next = typeof body.nextPageToken === 'string' && body.nextPageToken !== '' ? body.nextPageToken : null
      if (reachedOlder || next === null) return { found, complete: true }
      pageToken = next
    }
    return { found, complete: false }
  }

  // ── 방송 후 요약 댓글 (AC-Y1-46) ──────────────────────────────────────

  async #summaries(): Promise<void> {
    const { db, timer, connections } = this.#options
    const now = timer.now()
    for (const candidate of await summaryCandidates(db, new Date(now - SUMMARY_DELAY_MS))) {
      this.#check()
      const { link, date } = candidate
      const runtime = await this.#options.writer.read(link.sellerId, date, false)
      const settings = getBroadcast(runtime.state, link.broadcastId)?.settings
      let texts: string[] = []
      if (settings?.['thanks.videoComment'] === 'SUMMARY') {
        try {
          texts = summaryComments(summaryLines(runtime.state, link.broadcastId))
        } catch (error) {
          if (!(error instanceof MissingAmountError)) throw error
          // 찜 금액이 없는 확정 찜: 그 방송의 요약은 만들지 않는다(발송함 행 없음) — 찜 ID만 남긴다 (D-O3-15)
          this.#options.log({ level: 'error', code: 'AMOUNT_MISSING', seller: link.sellerId, date, claim: error.claimId })
        }
      }
      if (texts.length === 0) {
        await markSummaryDone(db, link.sellerId, link.id, new Date(now))
        continue
      }
      const connection = await connections.row(link.sellerId)
      const consent = connection?.consentVideoCommentAt ?? null
      const scopeId = link.scopeId
      await db.transaction(async (tx) => {
        if (!(await markSummaryDone(tx, link.sellerId, link.id, new Date(now)))) return
        await insertSummaryRows(
          tx,
          texts.map((text, index) => ({
            sellerId: link.sellerId,
            scopeId,
            effectId: `summary:${link.broadcastId}:${String(index + 1)}`,
            seq: runtime.seq,
            body: JSON.stringify({ kind: SUMMARY_KIND, broadcast: link.broadcastId, part: index + 1 }),
            broadcastId: link.broadcastId,
            text,
            state: consent === null ? 'FAILED' : 'WAITING',
            reason: consent === null ? 'NO_CONSENT' : null,
            now: new Date(now),
            deadlineAt: new Date(now + COMMENT_DEADLINE_MS),
          })),
        )
      })
      this.#options.publish(link.sellerId, { kind: 'outbox', date, summary: link.broadcastId })
    }
  }

  // ── 판매자 조작 ───────────────────────────────────────────────────────

  /** 동의를 껐다·연결을 끊었다: 그 대상의 기다리던 자동 게시 행 → 보내지 못함(NO_CONSENT) */
  async consentOff(sellerId: string, targets: readonly ConsentTarget[], includeManual: boolean): Promise<void> {
    const list: string[] = [...targets]
    if (targets.includes('VIDEO_COMMENT')) list.push('SUMMARY')
    const rows = await failWaiting(this.#options.db, sellerId, { targets: list, ...(includeManual ? {} : { manual: false }) }, 'NO_CONSENT', this.#now())
    await this.#publishFailed(sellerId, rows, 'NO_CONSENT')
  }

  /** 방송 연결을 끊었다: 그 방송의 기다리던 실시간 채팅 감사 → 보내지 못함(NO_LINK) (AC-Y1-13) */
  async unlinked(sellerId: string, broadcastId: string): Promise<void> {
    const rows = await failWaiting(this.#options.db, sellerId, { targets: ['LIVE_CHAT'], broadcastId }, 'NO_LINK', this.#now())
    await this.#publishFailed(sellerId, rows, 'NO_LINK')
  }

  /** 유튜브 채팅이 끝났다: 그 방송의 기다리던 실시간 채팅 감사 → 보내지 못함(CHAT_ENDED) */
  async chatEnded(sellerId: string, broadcastId: string): Promise<void> {
    const rows = await failWaiting(this.#options.db, sellerId, { targets: ['LIVE_CHAT'], broadcastId }, 'CHAT_ENDED', this.#now())
    await this.#publishFailed(sellerId, rows, 'CHAT_ENDED')
  }

  async #publishFailed(sellerId: string, rows: readonly { id: number; scopeId: string }[], reason: string): Promise<void> {
    if (rows.length === 0) return
    const dates = await scopeDates(this.#options.db, sellerId, rows.map((row) => row.scopeId))
    const byDate = new Map<string, number[]>()
    for (const row of rows) {
      const date = dates.get(row.scopeId) ?? ''
      byDate.set(date, [...(byDate.get(date) ?? []), row.id])
    }
    for (const [date, ids] of byDate) this.#publishRows(sellerId, date === '' ? null : date, ids, 'FAILED', reason)
  }

  /** 날짜(실제 범위)의 행 목록 (AC-Y1-39) */
  async list(sellerId: string, scopeId: string): Promise<OutboxRowView[]> {
    const rows = await scopeRows(this.#options.db, sellerId, scopeId)
    return rows.map((row) => outboxRowView(row, rows))
  }

  /**
   * 수동 재전송 (AC-Y1-38). FAILED 행 하나만(확인하지 못함 UNCONFIRMED 포함 — 판매자가 유튜브를 보고 고른다), 같은 요청 번호는 한 번만.
   * 그때 엔진 상태를 다시 보고, 동의는 필요 없지만 연결·그 방송을 이은 채널 = 지금 연결한 채널(AC-Y1-92)·게시 권한·이은 방송(실시간 채팅이면 열린 채팅)이
   * 있어야 하고 할당량 멈춤이면 받지 않는다. 받으면 한 건씩(묶지 않고) 다시 시도·타임아웃 규칙을 처음부터 — 기한은 없다
   */
  async resend(
    sellerId: string,
    rowId: number,
    requestId: string,
  ): Promise<
    | { kind: 'ok'; row: OutboxRowView }
    | { kind: 'not_found' }
    | {
        kind: 'rejected'
        code: 'EFFECT_CANCELLED' | 'ALREADY_SENT' | 'RESEND_NOT_ALLOWED' | 'NO_PERMISSION' | 'NOT_LINKED' | 'NOT_MY_CHANNEL' | 'CHAT_ENDED' | 'YOUTUBE_RECONNECT_NEEDED' | 'QUOTA_PAUSED' | 'YOUTUBE_NOT_CONNECTED'
        message: string
        row?: OutboxRowView
      }
  > {
    const { db } = this.#options
    const prior = await rowByResendRequest(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.id !== rowId) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
      return { kind: 'ok', row: outboxRowView(prior) }
    }
    const row = await findRow(db, sellerId, rowId)
    if (row === null) return { kind: 'not_found' }
    if (row.state !== 'FAILED') return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED, row: outboxRowView(row) }
    const target = targetOf(row)
    const now = this.#now()
    if (row.kind === 'POST_THANKS') {
      const state = (await this.#options.writer.read(sellerId, row.date, false)).state
      const status = listEffects(state).find((effect) => effect.id === row.effectId)?.status
      if (status === 'CANCELLED') {
        await updateRows(db, sellerId, [row.id], { state: 'SKIPPED', reason: 'CANCELLED', resendRequestId: requestId }, now, { state: 'FAILED' })
        this.#publishRows(sellerId, row.date, [row.id], 'SKIPPED', 'CANCELLED')
        return { kind: 'rejected', code: 'EFFECT_CANCELLED', message: RESEND_MESSAGES.CANCELLED }
      }
      if (status === 'DONE') {
        await updateRows(db, sellerId, [row.id], { state: 'SENT', reason: null, reported: true, resendRequestId: requestId }, now, { state: 'FAILED' })
        this.#publishRows(sellerId, row.date, [row.id], 'SENT', null)
        return { kind: 'rejected', code: 'ALREADY_SENT', message: RESEND_MESSAGES.ALREADY_SENT }
      }
    }
    // 틱톡 감사 (D-TT-SEND-05): 유튜브 연결·동의와 상관없이 틱톡 실행기에 다시 맡긴다 — 이은 틱톡 방송·로그인은 보낼 때 본다
    if (row.via === TT_VIA) {
      const again = await updateRows(
        db,
        sellerId,
        [row.id],
        { state: 'WAITING', reason: 'TIKTOK', manual: true, deadlineAt: null, attempts: 0, groupId: null, nextAt: now, sentText: null, attemptAt: null, remoteId: null, leaseOwner: null, leaseUntil: null, resendRequestId: requestId, dismissedAt: null, dismissedBy: null },
        now,
        { state: 'FAILED' },
      )
      if (again.length === 0) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
      this.#publishRows(sellerId, row.date, again, 'WAITING', 'TIKTOK')
      const fresh = await findRow(db, sellerId, row.id)
      return { kind: 'ok', row: outboxRowView(fresh ?? row) }
    }
    const connection = await this.#options.connections.row(sellerId)
    const link = await activeLink(db, sellerId, row.broadcastId ?? '')
    // 글 올리는 계정이 비어 있으면 채널 다름이 아니다 — 실행기가 올리기 바로 전에 그때 연결한 채널을 적는다 (D-YT-SRV-16)
    if (connection !== null && link !== null && link.channelId !== null && link.channelId !== connection.channelId) return { kind: 'rejected', code: 'NOT_MY_CHANNEL', message: OUTBOX_REASON_MESSAGES.NOT_MY_CHANNEL }
    // 자동 게시와 같은 길 (X1 D-X1-19): 공식으로 올릴 수 있으면 공식, 아니면 확장 스위치·연결·회차 이어짐이면 확장에 맡긴다.
    // 판매자가 누른 다시 보내기라 '동의 전'·'스위치 켜기 전' 감사도 보낸다(manual — 공식 경로의 수동 재전송 규칙과 같다)
    const official = connection !== null && connection.status === 'CONNECTED' && connection.canPublish && link !== null
    // 봇 길(D-YT-SEND-11): 판매자 연결 없이도 다시 보낸다 — 이은 방송·채팅 끝만 본다
    const bot = target === 'LIVE_CHAT' && this.#sender(sellerId) !== null
    if (!official && !bot && target === 'LIVE_CHAT' && this.#options.extension !== undefined && row.broadcastId !== null) {
      if ((await this.#options.extension.route(sellerId, row.broadcastId)) !== null) {
        const handed = await updateRows(
          db,
          sellerId,
          [row.id],
          {
            state: 'WAITING',
            reason: 'EXTENSION',
            manual: true,
            deadlineAt: null,
            attempts: 0,
            groupId: null,
            nextAt: null,
            postText: liveChatText(effectOf(row)?.text ?? ''),
            sentText: null,
            attemptAt: null,
            confirmUntil: null,
            confirmTries: 0,
            remoteId: null,
            leaseOwner: null,
            leaseUntil: null,
            resendRequestId: requestId,
            dismissedAt: null,
            dismissedBy: null,
            via: EXT_VIA,
          },
          now,
          { state: 'FAILED' },
        )
        if (handed.length === 0) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
        this.#publishRows(sellerId, row.date, handed, 'WAITING', 'EXTENSION')
        this.#options.extension.handed?.(sellerId, row.broadcastId)
        const fresh = await findRow(db, sellerId, row.id)
        return { kind: 'ok', row: outboxRowView(fresh ?? row) }
      }
    }
    if (!bot) {
      if (connection === null) return { kind: 'rejected', code: 'YOUTUBE_NOT_CONNECTED', message: RESEND_MESSAGES.NO_ROUTE }
      if (connection.status !== 'CONNECTED') return { kind: 'rejected', code: 'YOUTUBE_RECONNECT_NEEDED', message: OUTBOX_REASON_MESSAGES.RECONNECT }
      // 그 방송을 이은 채널 = 지금 연결한 채널일 때만 (AC-Y1-92). 행은 그대로 FAILED
      if (link !== null && link.channelId !== null && link.channelId !== connection.channelId) return { kind: 'rejected', code: 'NOT_MY_CHANNEL', message: OUTBOX_REASON_MESSAGES.NOT_MY_CHANNEL }
      if (!connection.canPublish) return { kind: 'rejected', code: 'NO_PERMISSION', message: OUTBOX_REASON_MESSAGES.NO_PERMISSION }
    }
    if (link === null) return { kind: 'rejected', code: 'NOT_LINKED', message: OUTBOX_REASON_MESSAGES.NO_LINK }
    if (target === 'LIVE_CHAT' && link.chatEndedAt !== null) return { kind: 'rejected', code: 'CHAT_ENDED', message: OUTBOX_REASON_MESSAGES.CHAT_ENDED }
    if (!bot && (await this.#options.quota.mode(sellerId)) === 'PAUSED') return { kind: 'rejected', code: 'QUOTA_PAUSED', message: RESEND_MESSAGES.QUOTA_PAUSED }
    const effect = effectOf(row)
    const text = target === 'SUMMARY' ? (row.postText ?? '') : target === 'LIVE_CHAT' ? liveChatText(effect?.text ?? '') : commentText(effect?.text ?? '')
    const changed = await updateRows(
      db,
      sellerId,
      [row.id],
      {
        state: 'WAITING',
        reason: null,
        manual: true,
        deadlineAt: null,
        attempts: 0,
        groupId: `m${String(row.id)}-${requestId}`,
        nextAt: now,
        postText: text,
        sentText: null,
        attemptAt: null,
        confirmUntil: null,
        confirmTries: 0,
        remoteId: null,
        resendRequestId: requestId,
        // 다시 보내면 "알림에서 뺌"은 뜻이 없다 — 또 실패하면 새 실패로 알린다 (AC-I3-36)
        dismissedAt: null,
        dismissedBy: null,
        // 확장에 맡겼던 행도 판매자가 다시 보내면 공식 경로로 (X1 D-X1-19 — 저절로는 넘기지 않는다)
        via: null,
      },
      now,
      { state: 'FAILED' },
    )
    if (changed.length === 0) return { kind: 'rejected', code: 'RESEND_NOT_ALLOWED', message: RESEND_MESSAGES.NOT_ALLOWED }
    this.#publishRows(sellerId, row.date, [row.id], 'WAITING', null)
    this.notify()
    const fresh = await findRow(db, sellerId, row.id)
    return { kind: 'ok', row: outboxRowView(fresh ?? row) }
  }

  /**
   * 게시됨 확인 (AC-I3-36, D-I3-05): 판매자가 유튜브에서 본 확인하지 못한 감사(FAILED(UNCONFIRMED))를 그 메시지의 행 모두 SENT로 적고
   * 효과마다 게시 보고(effect.thanksSent, 조치자 = 그 계정)를 기록한다 — 공개 감사가 나간 확정은 잠긴다(R-7 3). 확정이 이미 풀린 효과도 보고는 한다
   * (엔진이 잠금 없이 실행 완료로 둔다 — R-13 늦은 보고). 같은 요청 번호는 처음 결과. 다시 게시하지 않는다
   */
  async confirmPosted(
    sellerId: string,
    rowId: number,
    accountId: string,
    requestId: string,
  ): Promise<{ kind: 'ok'; rows: OutboxRowView[] } | { kind: 'not_found' } | { kind: 'rejected'; code: 'CONFIRM_NOT_ALLOWED'; message: string }> {
    const { db } = this.#options
    const prior = await rowByConfirmRequest(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.id !== rowId) return { kind: 'rejected', code: 'CONFIRM_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.CONFIRM_NOT_ALLOWED }
      return { kind: 'ok', rows: await this.#groupViews(sellerId, prior) }
    }
    const result = await confirmPostedRows(db, sellerId, rowId, accountId, requestId, this.#now())
    if (result.kind === 'not_found') return { kind: 'not_found' }
    if (result.kind === 'not_allowed') return { kind: 'rejected', code: 'CONFIRM_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.CONFIRM_NOT_ALLOWED }
    const row = await findRow(db, sellerId, rowId)
    if (row === null) return { kind: 'not_found' }
    this.#publishRows(sellerId, row.date, result.ids, 'SENT', null)
    const members = (await this.#groupViews(sellerId, row)).filter((view) => result.ids.includes(view.id))
    // 게시 보고 (실행기의 보고와 같은 요청 번호 — 한 번만). 저장하지 못하면 실행기가 다음 바퀴에 같은 계정으로 다시 한다
    const runnerRows = (await Promise.all(result.ids.map((id) => findRow(db, sellerId, id)))).filter((item): item is RunnerRow => item !== null)
    await this.#report(runnerRows)
    return { kind: 'ok', rows: members.length > 0 ? members : await this.#groupViews(sellerId, row) }
  }

  /** 알림에서 빼기 (AC-I3-36): FAILED 행만 — 상태·이유는 그대로, 다시 보내기는 그대로 된다 */
  async dismiss(sellerId: string, rowId: number, accountId: string): Promise<{ kind: 'ok'; row: OutboxRowView } | { kind: 'not_found' } | { kind: 'rejected'; code: 'DISMISS_NOT_ALLOWED'; message: string }> {
    const result = await dismissRow(this.#options.db, sellerId, rowId, accountId, this.#now())
    if (result.kind === 'not_found') return { kind: 'not_found' }
    if (result.kind === 'not_allowed') return { kind: 'rejected', code: 'DISMISS_NOT_ALLOWED', message: SELLER_OUTBOX_MESSAGES.DISMISS_NOT_ALLOWED }
    this.#options.publish(sellerId, { kind: 'outbox', date: result.row.date, ids: [rowId], state: result.row.state ?? 'FAILED', reason: result.row.reason, dismissed: true })
    return { kind: 'ok', row: outboxRowView(result.row) }
  }

  /** 그 행의 묶음 행들의 보기 (묶음이 없으면 그 행만) */
  async #groupViews(sellerId: string, row: RunnerRow): Promise<OutboxRowView[]> {
    const rows = row.groupId === null ? [row] : await groupRows(this.#options.db, sellerId, row.groupId)
    return rows.map((item) => outboxRowView(item, rows))
  }

  /** 그 행이 속한 묶음의 행들 (시험·조회) */
  group(sellerId: string, groupId: string): Promise<RunnerRow[]> {
    return groupRows(this.#options.db, sellerId, groupId)
  }
}

/**
 * 방송 후 요약 줄 (AC-Y1-46, YT-05): 그 방송의 확정 판매(지금 엔진 상태) — 번호 순, 한 상품 안은 확정 순(상품마다의 확정버전 오름차순, D-Y08·D-O3-13).
 * 옵션 상품은 변형마다의 1등(D-O1-01, winnerClaimsOf). 품종 = 지금 상품 이름, 옵션 글 = 코어 ClaimInfo.variant(있을 때만), 수량 = 2 이상일 때만,
 * 가격 = 그 찜의 찜 금액(코어 ClaimInfo.amount, R-19 "표시"), 구매자 = 그 찜의 구매자 자신의 지금 표시 이름(문자 구매자·문자찜으로 생긴 찜은 늘 `문자찜`).
 * 유튜브 발송함으로 가는 감사의 판매만 넣는다 — 찜의 구매자 자신이 인스타그램(ig:)·틱톡(tt:) 구매자인 판매는 넣지 않는다 (D-N2b-2-09, AC-N2b-2-12).
 * 확정 찜에 찜 금액이 없으면 단가 × 수량으로 채우지 않고 MissingAmountError — 그 방송의 요약을 만들지 않는다 (D-O3-15).
 * claims는 시험용 주입 자리(기본 코어 listClaims)
 */
export function summaryLines(state: EngineState, broadcastId: string, claimList: Iterable<ClaimInfo> = listClaims(state)): SummaryLine[] {
  const products = listProducts(state).filter((product) => product.broadcast === broadcastId)
  const claims = new Map([...claimList].map((claim) => [claim.id, claim]))
  const lines: SummaryLine[] = []
  for (const product of [...products].sort((a, b) => a.no - b.no)) {
    const winners = winnerClaimsOf(product)
      .flatMap((claimId) => {
        const claim = claims.get(claimId)
        return claim === undefined || claim.status !== 'CONFIRMED' ? [] : [claim]
      })
      .filter((claim) => !claim.buyer.startsWith(INSTAGRAM_PREFIX) && !claim.buyer.startsWith(TIKTOK_PREFIX))
      .sort((a, b) => (a.confirmVersion ?? 0) - (b.confirmVersion ?? 0))
    for (const claim of winners) {
      const amount = requireAmount(claim)
      const buyer = getBuyer(state, claim.buyer)
      const sms = claim.origin === 'sms' || buyer?.kind === 'sms'
      lines.push({
        no: product.no,
        name: product.name,
        ...(claim.variant === null || claim.variant === '' ? {} : { variant: claim.variant }),
        ...(claim.qty >= 2 ? { qty: claim.qty } : {}),
        price: formatWon(amount),
        buyer: sms ? '문자찜' : (buyer?.display ?? '시청자'),
      })
    }
  }
  return lines
}

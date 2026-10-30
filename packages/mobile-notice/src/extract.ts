// 알림 → 봉투 후보 (SMS3). 안드로이드 Kotlin `NoticeExtractor`와 같은 규칙의 TS 본 — 가짜 구현이 쓰고, 시험이 두 쪽 규칙을 같은 사례로 잠근다.
// 1) 허용한 앱이 아니면 내용을 열지 않고 버린다(이 함수까지 오지 않는다 — packageName만 본다).
// 2) 묶음 요약·계속 떠 있는 알림은 버린다.
// 3) 메시지 스타일이면 메시지마다 시각·보낸 사람·본문을 꺼낸다. 내가 보낸 메시지(사람 없음·나)는 뺀다.
// 4) 아니면 TITLE(보낸 사람·은행 알림 제목) / BIG_TEXT(없으면 TEXT)로 한 건.
// 5) 판매자가 켜기 전(enabledAtMs − 1시간)보다 오래된 메시지는 보내지 않는다(대화 기록이 통째로 가지 않게).
import { NOTICE_BODY_MAX_CHARS, NOTICE_SOURCE_MAX_CHARS, type NoticeKindHint, type NoticeSourceType } from './contract.ts'
import { SMS_PACKAGES } from './packages.ts'
import { sha256Hex } from './sha256.ts'

/** 메시지 스타일의 메시지 한 개 (NotificationCompat.MessagingStyle.Message) */
export interface RawMessage {
  readonly timestampMs: number
  /** 보낸 사람 이름(연락처 이름 또는 번호). 사람이 없으면(내가 보낸 것) null */
  readonly senderName: string | null
  /** Person.uri ("tel:+8210…" 등) */
  readonly senderUri: string | null
  readonly text: string | null
  /** 휴대폰 주인이 보낸 메시지 (Person이 없거나 MessagingStyle.user와 같은 사람) */
  readonly fromUser: boolean
}

/** 알림에서 꺼낸 날것 (안드로이드 StatusBarNotification → 이 모양) */
export interface RawNotice {
  readonly packageName: string
  /** Notification.when (0이면 없음) */
  readonly whenMs: number
  /** StatusBarNotification.postTime */
  readonly postTimeMs: number
  readonly title: string | null
  readonly text: string | null
  readonly bigText: string | null
  /** 메시지 스타일이 아니면 null */
  readonly messages: readonly RawMessage[] | null
  readonly groupSummary: boolean
  readonly ongoing: boolean
}

/** 봉투가 될 한 건 (sentAtMs·deviceId는 보낼 때 붙인다) */
export interface NoticeCandidate {
  readonly kindHint: NoticeKindHint
  readonly sourceType: NoticeSourceType
  readonly source: string
  readonly body: string
  readonly receivedAtMs: number
  readonly localId: string
}

export type ExtractSkip = 'SUMMARY' | 'ONGOING' | 'EMPTY'

export interface ExtractResult {
  readonly candidates: readonly NoticeCandidate[]
  /** 한 건도 못 꺼낸 까닭 */
  readonly skipped: ExtractSkip | null
  /** 켜기 전 메시지라 뺀 건수 */
  readonly tooOld: number
}

/** 켜기 전 이만큼까지는 받는다 (방송 시작하고 늦게 켠 판매자의 문자찜을 잃지 않게) */
export const HISTORY_GRACE_MS = 60 * 60 * 1000
/** 보낸 사람이 없을 때 */
export const UNKNOWN_SENDER = '모름'

export const isSmsPackage = (packageName: string): boolean => (SMS_PACKAGES as readonly string[]).includes(packageName)

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\r\n?/g, '\n').trim()
/** UTF-16 단위로 자른다(Kotlin take·Swift utf16과 같게). 짝 대리 문자 가운데서 잘리면 앞쪽 반을 뺀다 */
export function cutUtf16(value: string, max: number): string {
  if (value.length <= max) return value
  const head = value.slice(0, max)
  const last = head.charCodeAt(head.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
}
const cut = cutUtf16

/** 전화번호처럼 생긴 글 → 숫자만(앞 + 유지). 아니면 null */
export function phoneDigits(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\+?[0-9 ()\-.]+$/.test(trimmed)) return null
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length < 3 || digits.length > 20) return null
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** 보낸 사람: tel: 주소 → 번호, 번호 모양 이름 → 숫자, 아니면 이름 그대로 */
export function senderOf(name: string | null, uri: string | null): string {
  if (uri !== null && uri.toLowerCase().startsWith('tel:')) {
    let raw = uri.slice(4)
    try {
      raw = decodeURIComponent(raw)
    } catch {
      // 틀린 % 표기는 그대로 둔다
    }
    const digits = phoneDigits(raw)
    if (digits !== null) return digits
  }
  const n = clean(name)
  if (n === '') return UNKNOWN_SENDER
  return phoneDigits(n) ?? cut(n, NOTICE_SOURCE_MAX_CHARS)
}

/** 같은 알림 두 번 막기 열쇠: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 본문) 앞 16바이트 16진 */
export function localIdOf(packageName: string, source: string, receivedAtMs: number, body: string): string {
  return sha256Hex(`${packageName}\u001f${source}\u001f${receivedAtMs}\u001f${body}`).slice(0, 32)
}

function candidate(packageName: string, kindHint: NoticeKindHint, source: string, body: string, receivedAtMs: number): NoticeCandidate {
  const sourceType: NoticeSourceType = kindHint === 'sms' ? 'sms_number' : 'app_package'
  const finalSource = kindHint === 'sms' ? source : packageName
  const finalBody = cut(body, NOTICE_BODY_MAX_CHARS)
  return { kindHint, sourceType, source: finalSource, body: finalBody, receivedAtMs, localId: localIdOf(packageName, finalSource, receivedAtMs, finalBody) }
}

/** 아이폰 단축어가 넣은 것의 패키지 자리 (localId 재료 — 서버로는 가지 않는다) */
export const IOS_SHORTCUT_SOURCE_APP = 'ios.shortcut.messages'
/** 아이폰 단축어 두 번 막기: 같은 보낸 사람·같은 내용이 같은 1분 안에 다시 들어오면 같은 것으로 본다 */
export const IOS_DUPLICATE_WINDOW_MS = 60_000

/**
 * 아이폰 단축어 입력 → 봉투 후보. 아이폰은 메시지 앱에서만 받으므로 은행도 보낸 곳은 문자 번호(sms_number)다.
 * 받은 시각 = 단축어가 돈 시각. 본문이 비면 null.
 */
export function shortcutCandidate(input: { readonly sender: string; readonly body: string; readonly kind: NoticeKindHint }, nowMs: number): NoticeCandidate | null {
  const body = cut(clean(input.body), NOTICE_BODY_MAX_CHARS)
  if (body === '') return null
  const source = senderOf(input.sender, null)
  const bucket = Math.floor(nowMs / IOS_DUPLICATE_WINDOW_MS) * IOS_DUPLICATE_WINDOW_MS
  return { kindHint: input.kind, sourceType: 'sms_number', source, body, receivedAtMs: nowMs, localId: localIdOf(IOS_SHORTCUT_SOURCE_APP, source, bucket, body) }
}

/** 날것 알림 → 봉투 후보들. enabledAtMs = 판매자가 켠 시각 */
export function extractNotice(raw: RawNotice, enabledAtMs: number): ExtractResult {
  if (raw.groupSummary) return { candidates: [], skipped: 'SUMMARY', tooOld: 0 }
  if (raw.ongoing) return { candidates: [], skipped: 'ONGOING', tooOld: 0 }
  const kindHint: NoticeKindHint = isSmsPackage(raw.packageName) ? 'sms' : 'bank'
  const oldest = enabledAtMs - HISTORY_GRACE_MS
  const candidates: NoticeCandidate[] = []
  let tooOld = 0

  if (raw.messages !== null && raw.messages.length > 0) {
    for (const message of raw.messages) {
      if (message.fromUser) continue
      const text = clean(message.text)
      if (text === '') continue
      const at = message.timestampMs > 0 ? message.timestampMs : raw.whenMs > 0 ? raw.whenMs : raw.postTimeMs
      if (at < oldest) {
        tooOld++
        continue
      }
      const source = kindHint === 'sms' ? senderOf(message.senderName ?? raw.title, message.senderUri) : raw.packageName
      candidates.push(candidate(raw.packageName, kindHint, source, text, at))
    }
    return { candidates, skipped: candidates.length === 0 && tooOld === 0 ? 'EMPTY' : null, tooOld }
  }

  const title = clean(raw.title)
  const text = clean(raw.bigText) !== '' ? clean(raw.bigText) : clean(raw.text)
  const at = raw.whenMs > 0 ? raw.whenMs : raw.postTimeMs
  if (text === '' && (kindHint === 'sms' || title === '')) return { candidates: [], skipped: 'EMPTY', tooOld: 0 }
  if (at < oldest) return { candidates: [], skipped: null, tooOld: 1 }
  if (kindHint === 'sms') {
    candidates.push(candidate(raw.packageName, 'sms', senderOf(title, null), text, at))
  } else {
    // 은행 알림은 제목에 금액·이름이 있을 때가 많다 — 제목과 본문을 한 줄씩 (본문이 제목으로 시작하면 본문만)
    const body = title === '' ? text : text === '' ? title : text.startsWith(title) ? text : `${title}\n${text}`
    candidates.push(candidate(raw.packageName, 'bank', raw.packageName, body, at))
  }
  return { candidates, skipped: null, tooOld: 0 }
}

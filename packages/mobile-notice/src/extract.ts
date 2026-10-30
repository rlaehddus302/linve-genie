// 알림 → 보낼 메시지 (SMS3, SPEC ORD-13 C-04). 안드로이드 Kotlin `NoticeExtractor`와 같은 규칙의 TS 본 — 가짜 구현이 쓰고, 공용 사례가 두 쪽 규칙을 잠근다.
// 1) 읽을 앱이 아니면 내용을 열지 않고 버린다(이 함수까지 오지 않는다 — packages.ts channelForPackage가 패키지 이름만 본다).
// 2) 묶음 요약·계속 떠 있는 알림은 버린다.
// 3) 메시지 스타일이면 메시지마다 시각·보낸 사람·본문을 꺼낸다. 내가 보낸 메시지(사람 없음·나)는 뺀다.
// 4) 아니면 문자는 TITLE(보낸 사람) / BIG_TEXT(없으면 TEXT)로 한 건, 앱 알림은 title = TITLE, text = BIG_TEXT(없으면 TEXT)로 한 건.
// 5) 판매자가 켜기 전(enabledAtMs − 1시간)보다 오래된 메시지는 보내지 않는다(대화 기록이 통째로 가지 않게).
// id: 같은 알림이 고쳐 다시 떠도(안드로이드 알림 갱신·떠 있는 알림 다시 훑기) 같은 메시지면 같은 id(C-04·C-06, AC-SMS3-27).
import { NOTICE_FROM_MAX_CHARS, NOTICE_TEXT_MAX_CHARS, NOTICE_TITLE_MAX_CHARS, type InboxChannel, type InboxMessage } from './contract.ts'
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

/** 보낼 메시지 한 건 = 요청의 메시지 한 건 */
export type NoticeCandidate = InboxMessage

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

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\r\n?/g, '\n').trim()
/** UTF-16 단위로 자른다(Kotlin take·Swift utf16과 같게). 짝 대리 문자 가운데서 잘리면 앞쪽 반을 뺀다 */
export function cutUtf16(value: string, max: number): string {
  if (value.length <= max) return value
  const head = value.slice(0, max)
  const last = head.charCodeAt(head.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
}
const cut = cutUtf16

/**
 * 전화번호처럼 생긴 글인가 — 맞으면 앞뒤 빈칸만 뺀 글 그대로, 아니면 null.
 * 괄호·점·빈칸·하이픈·앞 +를 지우지 않는다: 서버가 보낸 곳 원문으로 은행 대표번호인지 본다(DP-9 1, D-DEP2-10 —
 * `+82 1588-9999`·`(1588)9999`는 믿지 않는다). 여기서는 tel: 주소가 번호인지 가리는 데만 쓴다.
 */
export function phoneLike(value: string): string | null {
  const trimmed = clean(value)
  if (!/^\+?[0-9 ()\-.]+$/.test(trimmed)) return null
  const digits = trimmed.replace(/[^0-9]/g, '').length
  if (digits < 3 || digits > 20) return null
  return trimmed
}

/**
 * 보낸 곳 (C-04 from): 글을 바꾸지 않고 보낸다(앞뒤 빈칸만 뺀다, 200자까지) — D-DEP2-10.
 * tel: 주소가 번호면 %XX만 풀어 그 글, 아니면 보낸 사람 이름(연락처 이름·번호 그대로). 없으면 null.
 */
export function senderOf(name: string | null, uri: string | null): string | null {
  if (uri !== null && uri.toLowerCase().startsWith('tel:')) {
    let raw = uri.slice(4)
    try {
      raw = decodeURIComponent(raw)
    } catch {
      // 틀린 % 표기는 그대로 둔다
    }
    const number = phoneLike(raw)
    if (number !== null) return cut(number, NOTICE_FROM_MAX_CHARS)
  }
  const n = clean(name)
  if (n === '') return null
  return cut(n, NOTICE_FROM_MAX_CHARS)
}

/** 메시지 id: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 제목 ␟ 본문) 앞 16바이트 16진 32자. null 칸은 빈 글 */
export function messageIdOf(packageName: string, from: string | null, receivedAtMs: number, title: string | null, text: string): string {
  return sha256Hex(`${packageName}\u001f${from ?? ''}\u001f${receivedAtMs}\u001f${title ?? ''}\u001f${text}`).slice(0, 32)
}

function message(packageName: string, channel: InboxChannel, from: string | null, title: string | null, text: string, receivedAtMs: number): NoticeCandidate {
  const finalFrom = channel === 'APP' ? packageName : from
  const finalTitle = channel === 'APP' && title !== null && title !== '' ? cut(title, NOTICE_TITLE_MAX_CHARS) : null
  const finalText = cut(text, NOTICE_TEXT_MAX_CHARS)
  return {
    id: messageIdOf(packageName, finalFrom, receivedAtMs, finalTitle, finalText),
    channel,
    from: finalFrom,
    title: finalTitle,
    text: finalText,
    receivedAt: receivedAtMs,
  }
}

/** 아이폰 단축어가 넣은 것의 패키지 자리 (id 재료 — 서버로는 가지 않는다) */
export const IOS_SHORTCUT_SOURCE_APP = 'ios.shortcut.messages'
/** 아이폰 단축어 두 번 막기: 같은 보낸 곳·같은 내용이 같은 1분 안에 다시 들어오면 같은 id */
export const IOS_DUPLICATE_WINDOW_MS = 60_000

/**
 * 아이폰 단축어 입력 → 보낼 메시지. 아이폰은 메시지 앱의 문자만 받는다(C-01 — channel SMS).
 * 받은 시각 = 단축어가 돈 시각. 본문이 비면 null.
 */
export function shortcutCandidate(input: { readonly sender: string; readonly body: string }, nowMs: number): NoticeCandidate | null {
  const text = cut(clean(input.body), NOTICE_TEXT_MAX_CHARS)
  if (text === '') return null
  const from = senderOf(input.sender, null)
  const bucket = Math.floor(nowMs / IOS_DUPLICATE_WINDOW_MS) * IOS_DUPLICATE_WINDOW_MS
  return { id: messageIdOf(IOS_SHORTCUT_SOURCE_APP, from, bucket, null, text), channel: 'SMS', from, title: null, text, receivedAt: nowMs }
}

/** 날것 알림 → 보낼 메시지들. channel = 패키지로 정한 것(packages.ts), enabledAtMs = 판매자가 켠 시각 */
export function extractNotice(raw: RawNotice, channel: InboxChannel, enabledAtMs: number): ExtractResult {
  if (raw.groupSummary) return { candidates: [], skipped: 'SUMMARY', tooOld: 0 }
  if (raw.ongoing) return { candidates: [], skipped: 'ONGOING', tooOld: 0 }
  const oldest = enabledAtMs - HISTORY_GRACE_MS
  const candidates: NoticeCandidate[] = []
  let tooOld = 0

  if (raw.messages !== null && raw.messages.length > 0) {
    for (const m of raw.messages) {
      if (m.fromUser) continue
      const text = clean(m.text)
      if (text === '') continue
      const at = m.timestampMs > 0 ? m.timestampMs : raw.whenMs > 0 ? raw.whenMs : raw.postTimeMs
      if (at < oldest) {
        tooOld++
        continue
      }
      if (channel === 'SMS') candidates.push(message(raw.packageName, 'SMS', senderOf(m.senderName ?? raw.title, m.senderUri), null, text, at))
      else candidates.push(message(raw.packageName, 'APP', null, clean(raw.title), text, at))
    }
    return { candidates, skipped: candidates.length === 0 && tooOld === 0 ? 'EMPTY' : null, tooOld }
  }

  const title = clean(raw.title)
  const body = clean(raw.bigText) !== '' ? clean(raw.bigText) : clean(raw.text)
  const at = raw.whenMs > 0 ? raw.whenMs : raw.postTimeMs
  if (body === '' && (channel === 'SMS' || title === '')) return { candidates: [], skipped: 'EMPTY', tooOld: 0 }
  if (at < oldest) return { candidates: [], skipped: null, tooOld: 1 }
  if (channel === 'SMS') {
    candidates.push(message(raw.packageName, 'SMS', senderOf(title, null), null, body, at))
  } else if (body === '') {
    // 제목만 있는 은행 알림 — 제목을 본문으로(같은 글을 두 칸에 싣지 않는다)
    candidates.push(message(raw.packageName, 'APP', null, null, title, at))
  } else {
    candidates.push(message(raw.packageName, 'APP', null, title, body, at))
  }
  return { candidates, skipped: null, tooOld: 0 }
}

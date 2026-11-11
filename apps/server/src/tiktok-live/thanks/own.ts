// 봇이 올린 틱톡 감사 글을 찜으로 읽지 않기 (D-TT-SEND-06).
// 봇 계정 감사 "15번 핑크프릴 10,000원 ○○님 구매 감사합니다"가 틱톡 채팅에 뜨면 직접 연결·크롬 확장이 그 댓글을 읽는다 —
// 그대로 기록하면 "15번" 찜으로 판정돼 엉뚱한 구매자가 생긴다(분쟁). 기록하기 전에 두 가지로 거른다:
//   (1) 쓴 사람의 숫자 사용자 ID가 운영자가 적은 봇 계정 ID(LIVEJJIM_TT_SEND_BOT_USER_IDS)면 버린다.
//   (2) 그 판매자에게 최근 15분 안에 우리가 보낸(보내려던) 감사 글과 본문이 같으면 버린다 — 봇 ID를 모를 때도 막는다.
// 본문·아이디는 로그에 남기지 않는다(수만).

/** 보낸 글을 기억하는 시간 — 감사 기한(10분)보다 넉넉히 */
export const OWN_THANKS_TTL_MS = 15 * 60_000

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

export class OwnThanks {
  readonly #now: () => number
  readonly #botUserIds: ReadonlySet<string>
  /** 판매자 → (정리한 글 → 잊는 시각) */
  readonly #recent = new Map<string, Map<string, number>>()

  constructor(now: () => number, botUserIds: readonly string[] = []) {
    this.#now = now
    this.#botUserIds = new Set(botUserIds)
  }

  /** 보내기 직전에 부른다 (보내는 도중 뜬 댓글도 거르게) */
  remember(sellerId: string, text: string): void {
    const now = this.#now()
    const texts = this.#recent.get(sellerId) ?? new Map<string, number>()
    for (const [key, until] of texts) if (until <= now) texts.delete(key)
    texts.set(normalize(text), now + OWN_THANKS_TTL_MS)
    this.#recent.set(sellerId, texts)
  }

  /** 우리 봇이 올린 감사 댓글인가 */
  isOwn(sellerId: string, record: { readonly userId: string; readonly text: string }): boolean {
    if (this.#botUserIds.has(record.userId)) return true
    const texts = this.#recent.get(sellerId)
    if (texts === undefined) return false
    const until = texts.get(normalize(record.text))
    return until !== undefined && until > this.#now()
  }
}

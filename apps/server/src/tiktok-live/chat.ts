// 틱톡 공통 댓글 레코드 → 서버가 기록하는 chat 이벤트의 다섯 칸 (R-1 "틱톡 댓글의 chat", R-11, D-N2b-2-03, 골든 tests/golden/tiktok/chat.json).
// id = tt:<댓글 ID>, ch = tt:<숫자 사용자 ID>(글자 그대로 — 숫자로 바꾸지 않는다), nick = 수집 경로 이름 정리(D-Y05), text·owner 그대로.
// publishedAt은 넣지 않는다 — 틱톡 회차는 접수순이라 엔진은 서버가 붙인 at을 쓴다(D-N2b-2-02).
import { TIKTOK_PREFIX } from '../platform.ts'
import type { TikTokCommentRecord } from '../tiktok/index.ts'
import { sanitizeNick } from '../youtube/texts.ts'

export interface TikTokChatFields {
  readonly id: string
  readonly ch: string
  readonly nick: string
  readonly text: string
  readonly owner: boolean
}

export function tiktokChatFields(record: TikTokCommentRecord): TikTokChatFields {
  return {
    id: `${TIKTOK_PREFIX}${record.commentId}`,
    ch: `${TIKTOK_PREFIX}${record.userId}`,
    nick: sanitizeNick(record.nickname),
    text: record.text,
    owner: record.owner,
  }
}

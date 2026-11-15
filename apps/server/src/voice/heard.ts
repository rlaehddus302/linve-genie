// 음성 인식 기록 (D-UX4-156, 사용자 지시 2026-11-16 "음성인식은 왜 끝난 라이브엔 볼 수 없어? 채팅처럼 다 저장해두는 거 아니야? 보이게 해줘"):
// - 받아쓰기 일꾼이 돌려준 최종 글을 판매자·방송마다 한 줄씩 voice_heard에 남긴다 — 휴대폰 마이크 흐름(relay)·라이브 소리 흐름(stream-service) 모두.
//   옛 규칙(D-APP-03 "받아쓴 글도 서버는 저장하지 않는다")을 바꾼다. 소리는 그대로 두지 않는다.
// - 저장 전에 제어 문자를 빼고 긴 숫자(전화번호 등)를 가린다(voice-log cleanHeard). 글은 로그에 남기지 않는다(실패는 코드만).
// - 받아쓴 글을 기기·읽기에 넘기는 길을 늦추지 않게 기다리지 않고 차례대로 쓴다. 판정 입력이 아니다(등록은 지금처럼 쓰기 요청이 이벤트로 먼저 기록된다).
// - GET /api/broadcasts/:id/heard → { lines: [{ at(UTC 밀리초), text }] } 시간순. 판매자 자기 방송만(남의 방송·없는 방송은 404).
// - 날짜를 봉인하면 채팅 원문처럼 지운다(youtube/seal.ts).
import { and, asc, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import type { Env } from '../api.ts'
import type { Db } from '../db/database.ts'
import { voiceHeard } from '../db/schema.ts'
import { apiError } from '../errors.ts'
import type { LogSink } from '../log.ts'
import { findBroadcast } from '../store.ts'
import { cleanHeard } from '../voice-log.ts'

/** 한 줄 상한 (일꾼 결과 상한과 같음, 코드 포인트) */
export const HEARD_LINE_MAX = 2_000
/** 한 방송에서 읽어 오는 줄 상한 (오래된 것부터) */
export const HEARD_READ_MAX = 20_000
/** 쓰기를 기다리는 줄 상한 — 넘으면 버리고 코드만 남긴다(DB가 멈춰도 메모리가 늘지 않게) */
const PENDING_MAX = 500
/** 방송 자리(날짜·리허설) 기억 상한 */
const PLACE_MAX = 1_000

export interface HeardLine {
  /** 서버가 글을 받은 시각 (UTC 밀리초) */
  readonly at: number
  readonly text: string
}

interface Place { readonly date: string; readonly rehearsal: boolean }

export class HeardLog {
  readonly #db: Db
  readonly #log: LogSink
  readonly #places = new Map<string, Promise<Place | null>>()
  #pending = 0
  #writing: Promise<void> = Promise.resolve()

  constructor(db: Db, log: LogSink) {
    this.#db = db
    this.#log = log
  }

  /** 받아쓴 글 한 줄을 남긴다 (기다리지 않는다). 빈 글·없는 방송은 남기지 않는다 */
  add(sellerId: string, broadcastId: string, text: string, at: number): void {
    const clean = cleanHeard(text, HEARD_LINE_MAX)
    if (clean === '' || !Number.isFinite(at)) return
    if (this.#pending >= PENDING_MAX) {
      this.#log({ level: 'warn', code: 'VOICE_HEARD_SAVE_FAILED' })
      return
    }
    this.#pending++
    this.#writing = this.#writing
      .then(async () => {
        const place = await this.#place(sellerId, broadcastId)
        if (place === null) return
        await this.#db.insert(voiceHeard).values({ sellerId, broadcastId, date: place.date, rehearsal: place.rehearsal, at: new Date(at), text: clean })
      })
      .catch(() => this.#log({ level: 'warn', code: 'VOICE_HEARD_SAVE_FAILED' }))
      .finally(() => { this.#pending-- })
  }

  /** 지금까지 받은 줄을 다 쓸 때까지 (시험·끄기) */
  settled(): Promise<void> {
    return this.#writing
  }

  #place(sellerId: string, broadcastId: string): Promise<Place | null> {
    const key = `${sellerId}\u0000${broadcastId}`
    const known = this.#places.get(key)
    if (known !== undefined) return known
    if (this.#places.size >= PLACE_MAX) this.#places.clear()
    const found = findBroadcast(this.#db, sellerId, broadcastId).then((row) => (row === null ? null : { date: row.date, rehearsal: row.rehearsal }))
    // 못 찾은 방송은 기억하지 않는다 (곧 만들어질 수 있다)
    this.#places.set(key, found)
    void found.then((place) => { if (place === null) this.#places.delete(key) }, () => this.#places.delete(key))
    return found
  }
}

/** 그 방송의 음성 인식 기록 (시간순, 같은 시각이면 받은 차례) */
export async function listHeard(db: Db, sellerId: string, broadcastId: string): Promise<HeardLine[]> {
  const rows = await db
    .select({ at: voiceHeard.at, text: voiceHeard.text })
    .from(voiceHeard)
    .where(and(eq(voiceHeard.sellerId, sellerId), eq(voiceHeard.broadcastId, broadcastId)))
    .orderBy(asc(voiceHeard.at), asc(voiceHeard.id))
    .limit(HEARD_READ_MAX)
  return rows.map((row) => ({ at: row.at.getTime(), text: row.text }))
}

/** GET /api/broadcasts/:id/heard — 판매자 자기 방송만 (없거나 남의 방송이면 404) */
export function registerHeardRoutes(api: Hono<Env>, db: Db): void {
  api.get('/broadcasts/:id/heard', async (c) => {
    const sellerId = c.get('session').sellerId
    const broadcast = await findBroadcast(db, sellerId, c.req.param('id'))
    if (broadcast === null) return apiError(404, 'NOT_FOUND', '그 방송을 찾지 못했어요.')
    return c.json({ lines: await listHeard(db, sellerId, broadcast.id) })
  })
}

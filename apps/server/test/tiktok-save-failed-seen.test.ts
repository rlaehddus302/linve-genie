// 틱톡 저장 실패 확인·입력 검사로 건너뛴 댓글 수 통합 시험 (N2b-2, AC-N2b-2-74·75, D-N2b-2-16·17). 가짜 웹캐스트·가짜 시계 — 바깥 연결 없음.
import { afterEach, describe, expect, it } from 'vitest'
import { TIKTOK_MISSED_MESSAGE } from '../src/tiktok/index.ts'
import type { Draft, WriteJob } from '../src/writer.ts'
import { addSeller, client, rid, waitFor } from './support.ts'
import { assistantSession, chats, connected, linkTiktok, logText, msgId, realBroadcast, restart, tiktokComment, tiktokSeller, ttWorld, unlinkTiktok, type TtWorld } from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(options: Parameters<typeof ttWorld>[0] = {}): Promise<TtWorld> {
  const w = await ttWorld(options)
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

type Collection = Record<string, unknown>
const collection = async (w: TtWorld, cookie: string, b: string) => ((await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as { collection: Collection | null }).collection
const seen = (w: TtWorld, cookie: string, b: string, body: unknown) => client(w, cookie).post(`/api/broadcasts/${b}/tiktok/save-failed-seen`, body)
const saveFailedText = (n: number) => `저장하지 못한 틱톡 댓글이 ${String(n)}개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.`

/** 채팅 기록만 실패하게 하는 세계 (failing.on 동안) */
async function failingWorld(): Promise<{ w: TtWorld; failing: { on: boolean } }> {
  const failing = { on: false }
  const w = await world({
    overrides: {
      hooks: {
        beforeCommit: (records) => {
          if (failing.on && records.some((r) => r.type === 'chat')) throw new Error('planted-db-error')
        },
      },
    },
  })
  return { w, failing }
}

/** 댓글 n개를 하나씩 저장 실패로 (한 묶음씩 — saveFailed가 n 늘어난다) */
async function failComments(w: TtWorld, failing: { on: boolean }, tiktokId: string, n: number): Promise<void> {
  failing.on = true
  for (let i = 0; i < n; i += 1) await tiktokComment(w, tiktokId, { userId: String(7200 + i), nickname: `실패${String(i)}`, comment: '15' })
  failing.on = false
}

describe('AC-N2b-2-74 저장 실패 확인 (D-N2b-2-16)', () => {
  it('확인하지 않은 수만 알린다 — 확인하면 저장 실패 몫이 꺼지고 끊김 몫은 그대로, 새로 늘면 그 수만 다시 알린다. SSE로 보기가 간다', async () => {
    const { w, failing } = await failingWorld()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await failComments(w, failing, tiktokId, 3)
    expect(await collection(w, seller.cookie, b)).toMatchObject({ state: 'CONNECTED', saveFailed: 3, saveFailedSeen: 0, missed: true, missedMessage: saveFailedText(3) })

    const before = w.published.length
    const acked = await seen(w, seller.cookie, b, { upTo: 3 })
    expect(acked.status, acked.text).toBe(200)
    expect((acked.body.link as { collection: Collection }).collection).toMatchObject({ saveFailed: 3, saveFailedSeen: 3, missed: false, missedMessage: null })
    expect(await collection(w, seller.cookie, b)).toMatchObject({ saveFailed: 3, saveFailedSeen: 3, missed: false, missedMessage: null })
    await waitFor(() =>
      w.published.slice(before).some((p) => p.sellerId === seller.sellerId && (p.data.link as { collection?: Collection } | undefined)?.collection?.saveFailedSeen === 3),
    )

    // 끊김 때문에 켜진 missed는 확인과 상관없이 그대로 — 끊김 문장
    w.webcast.last?.drop()
    await waitFor(async () => (await collection(w, seller.cookie, b))?.state === 'RETRYING')
    expect(await collection(w, seller.cookie, b)).toMatchObject({ missed: true, missedMessage: TIKTOK_MISSED_MESSAGE, saveFailedSeen: 3 })
    await w.tclock.advance(5000)
    await connected(w, seller, b)

    // 그 뒤 2개가 더 실패하면 문장의 수는 2
    await failComments(w, failing, tiktokId, 2)
    expect(await collection(w, seller.cookie, b)).toMatchObject({ saveFailed: 5, saveFailedSeen: 3, missed: true, missedMessage: saveFailedText(2) })
  })

  it('upTo는 saveFailed까지만·줄지 않음·같은 요청 두 번 = 같은 결과', async () => {
    const { w, failing } = await failingWorld()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await failComments(w, failing, tiktokId, 3)

    const over = await seen(w, seller.cookie, b, { upTo: 99 })
    expect(over.status).toBe(200)
    expect((over.body.link as { collection: Collection }).collection).toMatchObject({ saveFailed: 3, saveFailedSeen: 3 })
    // 아주 큰 수도 저장 실패 수까지 (열 범위를 넘는 값도 거절하지 않고 자른다)
    expect((await seen(w, seller.cookie, b, { upTo: Number.MAX_SAFE_INTEGER })).status).toBe(200)

    await failComments(w, failing, tiktokId, 2)
    const lower = await seen(w, seller.cookie, b, { upTo: 1 })
    expect((lower.body.link as { collection: Collection }).collection).toMatchObject({ saveFailed: 5, saveFailedSeen: 3, missed: true, missedMessage: saveFailedText(2) })

    // 화면이 4까지만 봤으면 4까지만 — 5번째는 다시 알린다
    const first = await seen(w, seller.cookie, b, { upTo: 4 })
    const second = await seen(w, seller.cookie, b, { upTo: 4 })
    expect(first.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect((second.body.link as { collection: Collection }).collection).toMatchObject({ saveFailed: 5, saveFailedSeen: 4, missed: true, missedMessage: saveFailedText(1) })
  })

  it('upTo가 0 이상의 정수가 아니면 400, 이어진 연결이 없으면 409 NOT_LINKED, 다른 판매자의 회차는 404, 보조자는 403', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    // 잇기 전
    const unlinked = await seen(w, seller.cookie, b, { upTo: 0 })
    expect([unlinked.status, (unlinked.body.error as { code: string }).code]).toEqual([409, 'NOT_LINKED'])
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    for (const bad of [{ upTo: -1 }, { upTo: 1.5 }, { upTo: '3' }, { upTo: null }, {}, { upTo: Number.MAX_SAFE_INTEGER + 1 }]) {
      const response = await seen(w, seller.cookie, b, bad)
      expect([response.status, (response.body.error as { code: string }).code], JSON.stringify(bad)).toEqual([400, 'INVALID_INPUT'])
    }
    const extra = await seen(w, seller.cookie, b, { upTo: 0, planted: 1 })
    expect(extra.status).toBe(400)
    expect((await seen(w, seller.cookie, b, { upTo: 0 })).status).toBe(200)

    const other = await addSeller(w)
    const foreign = await seen(w, other.cookie, b, { upTo: 0 })
    expect([foreign.status, (foreign.body.error as { code: string }).code]).toEqual([404, 'NOT_FOUND'])
    expect((await seen(w, seller.cookie, 'b-none', { upTo: 0 })).status).toBe(404)

    const helper = await assistantSession(w, seller)
    const assistant = await seen(w, helper.cookie, b, { upTo: 0 })
    expect([assistant.status, (assistant.body.error as { code: string }).code]).toEqual([403, 'ASSISTANT_FORBIDDEN'])

    // 끊은 뒤·끝낸 뒤 = 이어진 연결 없음
    await unlinkTiktok(w, seller, b)
    expect((await seen(w, seller.cookie, b, { upTo: 0 })).status).toBe(409)
    const b2 = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b2)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b2}/end`, { requestId: rid('end') })).status).toBe(200)
    const ended = await seen(w, seller.cookie, b2, { upTo: 0 })
    expect([ended.status, (ended.body.error as { code: string }).code]).toEqual([409, 'NOT_LINKED'])
  })
})

describe('AC-N2b-2-75 입력 검사로 건너뛴 댓글은 skipped로 따로 센다 (D-N2b-2-17)', () => {
  /** 기록 경로에 들어가는 채팅 중 닉네임이 PLANTED-BAD인 것의 본문을 글이 아닌 값으로 바꿔 엔진 입력 검사에 걸리게 한다 */
  function plantInvalid(w: TtWorld): void {
    const writer = w.server.writer
    const original = writer.write.bind(writer)
    writer.write = (job: WriteJob) =>
      original({
        ...job,
        build: (ctx, prepared) => {
          const drafts = job.build(ctx, prepared)
          if (!Array.isArray(drafts)) return drafts
          return (drafts as readonly Draft[]).map((draft) => (draft.fields.nick === 'PLANTED-BAD' ? { ...draft, fields: { ...draft.fields, text: 42 } } : draft))
        },
      })
  }

  it('검사에 걸리는 1개 + 정상 2개 한 묶음 → chat 2, skipped 1, notRecorded 0. 로그에 댓글 값 없음', async () => {
    const w = await world()
    plantInvalid(w)
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7101', uniqueId: 'a', nickname: '첫째', comment: '15' })
    w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7102', uniqueId: 'b', nickname: 'PLANTED-BAD', comment: 'PLANTED-TEXT' })
    w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7103', uniqueId: 'c', nickname: '셋째', comment: '16' })
    await w.server.tiktok.idle()
    expect((await chats(w, seller.sellerId)).map((c) => c.nick)).toEqual(['첫째', '셋째'])
    expect(await collection(w, seller.cookie, b)).toMatchObject({ comments: 2, skipped: 1, notRecorded: 0, saveFailed: 0, missed: false })
    expect(w.logs.some((l) => l.code === 'TIKTOK_SKIPPED' && l.count === 1)).toBe(true)
    expect(logText(w.logs)).not.toMatch(/PLANTED-BAD|PLANTED-TEXT/)

    // 묶음 전체가 검사에 걸려도(아무것도 쓰지 않음) skipped로 센다
    await tiktokComment(w, tiktokId, { userId: '7104', nickname: 'PLANTED-BAD', comment: '17' })
    expect(await collection(w, seller.cookie, b)).toMatchObject({ comments: 2, skipped: 2, notRecorded: 0 })
  })

  it('이미 기록된 같은 메시지 ID는 어느 수에도 넣지 않는다 (AC-N2b-2-52)', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    const id = msgId()
    w.webcast.broadcast(tiktokId, { msgId: id, userId: '7101', uniqueId: 'v', nickname: '홍길동', comment: '15' })
    await w.server.tiktok.idle()
    // 다시 켜서 모듈 기억을 비우고 같은 댓글이 또 온다 — 기록 경로가 거른다
    const again = await restart(w)
    worlds.push(again)
    await again.server.tiktok.resume()
    await connected(again, seller, b)
    w.webcast.broadcast(tiktokId, { msgId: id, userId: '7101', uniqueId: 'v', nickname: '홍길동', comment: '15' })
    w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7102', uniqueId: 'w', nickname: '둘째', comment: '16' })
    await again.server.tiktok.idle()
    expect(await chats(again, seller.sellerId)).toHaveLength(2)
    expect(await collection(again, seller.cookie, b)).toMatchObject({ comments: 2, skipped: 0, notRecorded: 0, saveFailed: 0 })
  })
})

// 방송 일정·알림 신청 정리 (MESSAGE_RULES MR-6 "지우기", SCH-01, KP1 AC-KP1-24). 타이머는 부르는 쪽(LedgerSweeper — 시작 때 + 1시간마다)이 건다.
// 1. 번호가 남은 신청마다 동의 기록으로 상태(consentStatus)를 정해 기한이 지났으면(EXPIRED — 기한 날 0시 KST부터) 번호 원문·전화번호 키를 지운다.
//    그만 받은(WITHDRAWN) 신청에 번호가 남아 있으면 그것도 지운다(그만 받기가 이미 지우지만 혹시 남은 것). 동의 기록은 번호 없이 그대로.
// 2. 시작 시각이 지난 일정을 지운다(공개 페이지·판매자 화면에서 이미 빠진 것).
// - 처음 고르기는 락 없이 하고, 지우기는 판매자 알림 락(alertLockKey — 신청·그만 받기와 같은 락) 안에서 그 신청의 기록을 다시 읽어
//   여전히 기한 지남·그만 받음일 때만 한다 (그사이 다시 신청한 번호를 지우지 않는다, RA-KP1-004).
// - 기록은 (판매자, 신청) 색인으로 읽는다 — 판매자 조건을 함께 건다 (RA-KP1-009).
// 문자를 보내지 않는다. 번호·키는 로그에 남기지 않는다(이 함수는 로그를 쓰지 않는다).
import { and, asc, eq, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { alertConsents, alertSubscribers, scheduleItems } from '../db/schema.ts'
import { alertLockKey, alertStatusOf } from './service.ts'

/** 한 번에 보는 신청 수 */
const SWEEP_CHUNK = 500

export async function sweepSchedule(db: Db, now: Date): Promise<void> {
  const nowMs = now.getTime()
  let after = ''
  for (;;) {
    const subscribers = await db
      .select({ id: alertSubscribers.id, sellerId: alertSubscribers.sellerId })
      .from(alertSubscribers)
      .where(and(or(isNotNull(alertSubscribers.phoneKey), isNotNull(alertSubscribers.phoneEnc)), after === '' ? undefined : gt(alertSubscribers.id, after)))
      .orderBy(asc(alertSubscribers.id))
      .limit(SWEEP_CHUNK)
    if (subscribers.length === 0) break
    after = (subscribers.at(-1) as { id: string }).id
    const records = await db
      .select({ subscriber: alertConsents.subscriberId, sellerId: alertConsents.sellerId, type: alertConsents.type, at: alertConsents.at })
      .from(alertConsents)
      .where(and(inArray(alertConsents.sellerId, [...new Set(subscribers.map((row) => row.sellerId))]), inArray(alertConsents.subscriberId, subscribers.map((row) => row.id))))
      .orderBy(asc(alertConsents.id))
    const bySubscriber = new Map<string, { type: string; at: Date }[]>()
    for (const subscriber of subscribers) bySubscriber.set(subscriber.id, [])
    for (const record of records) {
      // 판매자가 다른 기록은 섞지 않는다
      const owner = subscribers.find((row) => row.id === record.subscriber)
      if (owner === undefined || owner.sellerId !== record.sellerId) continue
      bySubscriber.get(record.subscriber)?.push({ type: record.type, at: record.at })
    }
    for (const subscriber of subscribers) {
      const { status } = alertStatusOf(nowMs, bySubscriber.get(subscriber.id) ?? [])
      if (status !== 'EXPIRED' && status !== 'WITHDRAWN') continue
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${alertLockKey(subscriber.sellerId)})`)
        const fresh = await tx
          .select({ type: alertConsents.type, at: alertConsents.at })
          .from(alertConsents)
          .where(and(eq(alertConsents.sellerId, subscriber.sellerId), eq(alertConsents.subscriberId, subscriber.id)))
          .orderBy(asc(alertConsents.id))
        const again = alertStatusOf(nowMs, fresh).status
        if (again !== 'EXPIRED' && again !== 'WITHDRAWN') return
        await tx
          .update(alertSubscribers)
          .set({ phoneKey: null, phoneEnc: null })
          .where(and(eq(alertSubscribers.sellerId, subscriber.sellerId), eq(alertSubscribers.id, subscriber.id)))
      })
    }
    if (subscribers.length < SWEEP_CHUNK) break
  }
  await db.delete(scheduleItems).where(lt(scheduleItems.startsAt, now))
}

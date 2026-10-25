// MOB2 적대 시험 (test-domain) — RA-MOB2-02 · D-MOB2-09 · R-6 · D-023
// 받은 시각을 비운 문자찜이 저절로 다시 보낼 실패로 끝나면 화면이 칸에 처음 "넣기"를 누른 시각(kstTime, HH:MM:SS)을 채우고,
// 다시 보내기는 그 칸을 readReceived로 읽은 값을 싣는다(SmsPage.tsx). 이 값이 늦게(끊김이 길어도, KST 자정을 넘어도)
// 엔진에 들어갔을 때 받은 시각이 처음 누른 초 정각으로 풀리고, RECEIVED_TIME 방송에서 끊긴 사이 들어온 채팅찜보다 앞서는지 본다.
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(pending-window-property.test.ts와 같은 까닭).
import { applyEvent, initEngine, listClaims, resolveReceivedTime, type EngineEvent, type EngineState } from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const KST_MODULE = '../../../apps/web/src/lib/kst.ts'
const RECEIVED_MODULE = '../../../apps/web/src/lib/received.ts'

interface Web {
  kstTime(value: number): string
  readReceived(text: string, now: number): { kind: 'ok'; value: string; time: number; day: string } | { kind: 'empty' | 'invalid' }
}
const load = async (): Promise<Web> => ({
  ...((await import(/* @vite-ignore */ KST_MODULE)) as Pick<Web, 'kstTime'>),
  ...((await import(/* @vite-ignore */ RECEIVED_MODULE)) as Pick<Web, 'readReceived'>),
})

/** 2026-10-19 00:00:00 KST */
const MIDNIGHT = Date.UTC(2026, 9, 18, 15, 0, 0)
const B = { id: 'b1', date: '2026-10-18', title: '밤 방송' } as const
const floorSec = (ms: number): number => Math.floor(ms / 1000) * 1000

/** RECEIVED_TIME 방송: 15번(재고 1) → 끊긴 사이 채팅찜(게시 chatAt, 도착 chatAt) → 연결이 돌아와 문자찜(도착 arriveAt, 채운 받은 시각) */
function play(received: string, chatAt: number, arriveAt: number): EngineState {
  let state = initEngine({ broadcasts: [B], settings: { 'contention.policy': 'RECEIVED_TIME' } })
  let seq = 0
  const apply = (event: Record<string, unknown>): void => {
    state = applyEvent(state, { ...event, seq: ++seq } as unknown as EngineEvent).state
  }
  apply({ type: 'product.register', b: 'b1', no: 15, name: '핑크프릴', price: 10000, stock: 1, at: MIDNIGHT - 3 * 3_600_000 })
  apply({ type: 'chat', b: 'b1', id: 'm1', ch: 'UC_A', nick: '홍길동', text: '15', at: chatAt, publishedAt: chatAt })
  apply({ type: 'sms', b: 'b1', ref: 'r1', no: 15, received, at: arriveAt })
  return state
}

describe('RA-MOB2-02 D-MOB2-09 채운 받은 시각은 늦게 들어가도 처음 누른 초로 풀린다', () => {
  it('속성: 자정 앞뒤 2시간·끊김 최대 2시간 — 화면이 채운 값 = 처음 누른 초, 엔진 받은 시각 = 처음 누른 초, 끊긴 사이 채팅찜보다 1등 (시드 고정)', async () => {
    const web = await load()
    fc.assert(
      fc.property(
        fc.integer({ min: -2 * 3_600_000, max: 2 * 3_600_000 }),
        fc.integer({ min: 0, max: 30_000 }),
        fc.integer({ min: 1_000, max: 2 * 3_600_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pressOffset, failDelay, gap, chatFrac) => {
          const press = MIDNIGHT + pressOffset
          const failNow = press + failDelay
          const arriveAt = press + Math.max(gap, failDelay)
          const text = web.kstTime(press)
          expect(text).toMatch(/^\d{2}:\d{2}:\d{2}$/)
          // 채우는 순간(실패한 때) 화면이 읽은 값이 그대로 실린다
          const read = web.readReceived(text, failNow)
          expect(read.kind, text).toBe('ok')
          if (read.kind !== 'ok') return
          expect(read.value).toBe(text)
          expect(read.time).toBe(floorSec(press))
          // 다시 보내기가 실제로 눌리는 때(도착 직전)에 읽어도 같은 값
          const again = web.readReceived(text, arriveAt)
          expect(again.kind === 'ok' ? again.value : null).toBe(text)
          // 엔진(서버와 같은 순수 함수)도 처음 누른 초로 푼다 — 자정을 넘겨 들어가도 전날
          expect(resolveReceivedTime(read.value, arriveAt)?.time).toBe(floorSec(press))
          // 끊긴 사이(처음 누른 초 뒤 ~ 다시 들어가기 전) 같은 번호 채팅찜
          const chatAt = floorSec(press) + 1 + Math.floor(chatFrac * (arriveAt - floorSec(press) - 1))
          const claims = listClaims(play(read.value, chatAt, arriveAt))
          const sms = claims.find((c) => c.origin === 'sms')
          const chat = claims.find((c) => c.origin === 'chat')
          expect(sms?.rankTime, `press=${new Date(press).toISOString()} arrive=${new Date(arriveAt).toISOString()}`).toBe(floorSec(press))
          expect(sms?.status).toBe('CONFIRMED')
          expect(chat?.status).toBe('WAITLISTED')
        },
      ),
      { seed: 20261026, numRuns: 400 },
    )
  })

  describe('경계 사례 (고정)', () => {
    const cases: { name: string; press: number; arrive: number; chat: number; text: string }[] = [
      { name: '23:59:59.900에 누르고 00:00:40에 들어감 — 전날 23:59:59', press: MIDNIGHT - 100, arrive: MIDNIGHT + 40_000, chat: MIDNIGHT + 5_000, text: '23:59:59' },
      { name: '00:00:00.000 정각에 누르고 00:30에 들어감', press: MIDNIGHT, arrive: MIDNIGHT + 1_800_000, chat: MIDNIGHT + 1, text: '00:00:00' },
      { name: '23:10:05에 누르고 끊김 1시간 넘겨 00:15에 들어감', press: MIDNIGHT - 2_995_000, arrive: MIDNIGHT + 900_000, chat: MIDNIGHT - 60_000, text: '23:10:05' },
    ]
    for (const c of cases) {
      it(c.name, async () => {
        const web = await load()
        const text = web.kstTime(c.press)
        expect(text).toBe(c.text)
        const read = web.readReceived(text, c.arrive)
        expect(read.kind === 'ok' ? read.time : null).toBe(floorSec(c.press))
        const claims = listClaims(play(text, c.chat, c.arrive))
        expect(Object.fromEntries(claims.map((x) => [x.origin, x.status]))).toEqual({ sms: 'CONFIRMED', chat: 'WAITLISTED' })
      })
    }
  })
})

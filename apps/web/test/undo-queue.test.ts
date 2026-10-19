// 되돌리기 (AC-S05-40·41, D-083) — 가짜 시계로 기다리지 않고 확인한다.
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import type { WriteResult } from '../src/api/types.ts'
import { HOST_ACTION_DELAY_MS, REGISTER_BLOCKED, REGISTER_UNDO_MS, UndoQueue, type Timer } from '../src/lib/undo-queue.ts'
import { flush } from './support.ts'

class ManualTimer implements Timer {
  now = 0
  #next = 1
  readonly #tasks = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.#tasks.set(id, { at: this.now + ms, fn })
    return id
  }
  clear(handle: unknown): void {
    this.#tasks.delete(handle as number)
  }
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      const due = [...this.#tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (due === undefined) break
      this.#tasks.delete(due[0])
      this.now = due[1].at
      due[1].fn()
    }
    this.now = end
  }
}

const result = (changed = true): WriteResult => ({ date: '2026-10-19', rehearsal: false, seq: 1, type: 'host.cancel', changed, effects: [] })

function setup() {
  const timer = new ManualTimer()
  let n = 0
  const queue = new UndoQueue({ timer, now: () => timer.now, requestId: () => `req-${String(++n)}`, retry: { sleep: async () => {} } })
  return { timer, queue }
}

describe('방송자 조치는 정한 시간 뒤에 보낸다 (AC-S05-41)', () => {
  it('운영 값은 5초다', () => {
    expect(HOST_ACTION_DELAY_MS).toBe(5000)
    expect(REGISTER_UNDO_MS).toBe(5000)
    expect(new UndoQueue().delayMs).toBe(5000)
  })

  it('누를 때 요청 번호를 만들고, 5초 전에는 보내지 않고, 5초가 지나면 그 번호로 보낸다', async () => {
    const { timer, queue } = setup()
    const send = vi.fn(async (_requestId: string) => result())
    const item = queue.add({ label: '15번 홍길동 취소', send })
    expect(item.requestId).toBe('req-1')
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'waiting', label: '15번 홍길동 취소' })
    timer.advance(4999)
    await flush()
    expect(send).not.toHaveBeenCalled()
    timer.advance(1)
    await flush()
    expect(send).toHaveBeenCalledWith('req-1')
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'done' })
  })

  it('5초 안에 되돌리면 아무것도 보내지 않는다', async () => {
    const { timer, queue } = setup()
    const send = vi.fn(async () => result())
    const item = queue.add({ label: '15번 홍길동 취소', send })
    timer.advance(3000)
    expect(queue.undo(item.id)).toBe(true)
    timer.advance(10_000)
    await flush()
    expect(send).not.toHaveBeenCalled()
    // 보내기 시작한 뒤에는 되돌릴 수 없다
    const second = queue.add({ label: '16번 취소', send })
    timer.advance(5000)
    expect(queue.undo(second.id)).toBe(false)
  })

  it('여러 개는 각자 5초 뒤에 누른 순서대로 보내고, Ctrl+Z(undoLatest)는 가장 최근 것부터', async () => {
    const { timer, queue } = setup()
    const sent: string[] = []
    const send = (label: string) => async () => {
      sent.push(label)
      return result()
    }
    queue.add({ label: 'A', send: send('A') })
    timer.advance(1000)
    queue.add({ label: 'B', send: send('B') })
    timer.advance(1000)
    queue.add({ label: 'C', send: send('C') })
    const undone = queue.undoLatest()
    expect(undone?.kind === 'action' ? undone.label : null).toBe('C')
    timer.advance(10_000)
    await flush()
    expect(sent).toEqual(['A', 'B'])
  })

  it('맞지 않아 아무 일도 없으면(changed: false) "적용되지 않았어요" 상태', async () => {
    const { timer, queue } = setup()
    queue.add({ label: '15번 취소', send: async () => result(false) })
    timer.advance(5000)
    await flush()
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'notApplied' })
  })

  it('저장 실패·네트워크 오류는 같은 요청 번호로 다시 보내고, 그래도 안 되면 실패 → 다시 보내기도 같은 번호', async () => {
    const { timer, queue } = setup()
    const seen: string[] = []
    let fail = true
    queue.add({
      label: '15번 취소',
      send: async (requestId) => {
        seen.push(requestId)
        if (fail) throw new ApiError({ status: 500, code: 'SAVE_FAILED', message: '저장하지 못했어요. 다시 시도해 주세요.' })
        return result()
      },
    })
    timer.advance(5000)
    await flush(20)
    expect(seen).toEqual(['req-1', 'req-1', 'req-1', 'req-1'])
    const failed = queue.getSnapshot()[0]
    expect(failed).toMatchObject({ status: 'failed' })
    fail = false
    queue.resend(failed?.id ?? 0)
    await flush()
    expect(seen.at(-1)).toBe('req-1')
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'done' })
  })

  it('화면을 닫거나 로그인이 풀리면(cancelAll) 기다리던 조치는 보내지 않는다', async () => {
    const { timer, queue } = setup()
    const send = vi.fn(async () => result())
    queue.add({ label: '15번 취소', send })
    queue.cancelAll()
    timer.advance(10_000)
    await flush()
    expect(send).not.toHaveBeenCalled()
    expect(queue.getSnapshot()).toEqual([])
  })

  it('서버가 거절하면 onError (사유의 휴대폰 번호 → 창을 다시 연다)', async () => {
    const { timer, queue } = setup()
    const onError = vi.fn()
    queue.add({
      label: '15번 취소',
      send: async () => {
        throw new ApiError({ status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'reason', message: '전화번호' }] })
      },
      onError,
    })
    timer.advance(5000)
    await flush()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as ApiError).problemFor('reason')).toBeDefined()
  })

  it('창을 다시 열 수 있는 거절이면 항목에 버튼 글자("사유 고치기")가 붙고, reopen은 그 항목을 지우고 친 값으로 창을 연다(한 번만)', async () => {
    const { timer, queue } = setup()
    const open = vi.fn()
    const rejected = new ApiError({ status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'reason', message: '전화번호' }] })
    const item = queue.add({
      label: '15번 취소',
      send: async () => {
        throw rejected
      },
      reopen: { label: '사유 고치기', accepts: (error) => error.status === 400, open },
    })
    expect(queue.reopen(item.id)).toBe(false) // 아직 기다리는 중
    timer.advance(5000)
    await flush()
    expect(queue.getSnapshot()).toMatchObject([{ id: item.id, status: 'failed', reopenLabel: '사유 고치기' }])
    expect(queue.reopen(item.id)).toBe(true)
    expect(open).toHaveBeenCalledWith(rejected)
    expect(queue.getSnapshot()).toEqual([])
    expect(queue.reopen(item.id)).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('다시 열 수 없는 실패(서버 오류)에는 버튼 글자가 없고 reopen은 아무것도 하지 않는다', async () => {
    const { timer, queue } = setup()
    const open = vi.fn()
    const item = queue.add({
      label: '15번 취소',
      send: async () => {
        throw new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' })
      },
      reopen: { label: '사유 고치기', accepts: (error) => error.status === 400, open },
    })
    timer.advance(5000)
    await flush()
    expect(queue.getSnapshot()).toMatchObject([{ id: item.id, status: 'failed', reopenLabel: null }])
    expect(queue.reopen(item.id)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('등록 되돌리기 (AC-S05-40)', () => {
  it('5초 안: 되돌리기 함수가 판매 종료를 보낸다 → "N번 등록을 되돌렸어요(판매 종료)"', async () => {
    const { timer, queue } = setup()
    const undo = vi.fn(async () => 'undone' as const)
    const item = queue.addRegistration({ no: 15, product: 'b1/15', undo })
    timer.advance(4000)
    expect(queue.undo(item.id)).toBe(true)
    await flush()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'undone', message: '15번 등록을 되돌렸어요(판매 종료)' })
  })

  it('찜이 들어왔으면 "찜이 들어와서 되돌릴 수 없어요…"', async () => {
    const { queue } = setup()
    const item = queue.addRegistration({ no: 15, product: 'b1/15', undo: async () => 'blocked' })
    queue.undo(item.id)
    await flush()
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'blocked', message: REGISTER_BLOCKED })
    expect(REGISTER_BLOCKED).toBe('찜이 들어와서 되돌릴 수 없어요. 고치기로 바로잡아 주세요.')
  })

  it('5초가 지나면 되돌리기는 사라진다', () => {
    const { timer, queue } = setup()
    queue.addRegistration({ no: 15, product: 'b1/15', undo: async () => 'undone' })
    timer.advance(5000)
    expect(queue.getSnapshot()).toEqual([])
    expect(queue.latestUndoable()).toBeUndefined()
  })

  it('Ctrl+Z는 등록과 조치 중 가장 최근 것', () => {
    const { timer, queue } = setup()
    queue.add({ label: '15번 취소', send: async () => result() })
    timer.advance(100)
    const registration = queue.addRegistration({ no: 16, product: 'b1/16', undo: async () => 'undone' })
    expect(queue.latestUndoable()?.id).toBe(registration.id)
  })
})

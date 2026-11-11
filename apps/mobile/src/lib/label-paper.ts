// 휴대폰에서 직접 출력한 용지만 센다. 연결한 실물 프린터별로 판매자가 입력한 잔량을 기억한다.
import type { PrinterMemoryStorage } from './printer-memory.ts'
import { useEffect, useSyncExternalStore } from 'react'

export const LOW_PAPER = 10
export class LabelPaper {
  storage: PrinterMemoryStorage | null = null
  readonly #counts = new Map<string, number | null>()
  readonly #listeners = new Set<() => void>()
  #pending = Promise.resolve()

  get = (id: string | null): number | null => id === null ? null : this.#counts.get(id) ?? null
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  // 롤 교체·연속 출력·다시 열기가 같은 순서로 저장되게 한다.
  update(id: string, action: 'load' | 'printed' | number | null): Promise<void> {
    const work = this.#pending.then(async () => {
      const key = 'livegenie.label-paper.' + id
      const store = this.storage
      if (!this.#counts.has(id)) {
        const raw = await store?.getItem(key)
        this.#counts.set(id, raw != null && /^\d{1,5}$/.test(raw) ? Number(raw) : null)
      }
      const current = this.get(id)
      if (action !== 'load') {
        const next = action === 'printed' ? (current === null ? null : Math.max(0, current - 1)) : action
        if (next !== null && (!Number.isInteger(next) || next < 0 || next > 99999)) throw new RangeError('용지 장수를 확인해 주세요.')
        if (next === current) return
        if (next === null) await store?.removeItem(key)
        else await store?.setItem(key, String(next))
        this.#counts.set(id, next)
      }
      for (const listener of this.#listeners) listener()
    })
    this.#pending = work.catch(() => undefined)
    return work
  }
}

export const labelPaper = new LabelPaper()

export function useLabelPaper(id: string | null): number | null {
  useEffect(() => {
    if (id !== null) void labelPaper.update(id, 'load').catch(() => undefined)
  }, [id])
  return useSyncExternalStore(labelPaper.subscribe, () => labelPaper.get(id))
}

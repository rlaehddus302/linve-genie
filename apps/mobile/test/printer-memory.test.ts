// 앱 프린터 기억 저장소 (L-7 마지막 프린터 기억, D-QS1-01 6): 되살리기·쓰기·깨진 값·저장소 실패
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { RememberedPrinter } from '@livejjim/printer'
import { loadPrintMemory, PRINTER_MEMORY_KEY, readPrinterMemory, wirePrinterMemory, type PrinterMemoryStorage, type PrinterMemoryTarget } from '../src/lib/printer-memory.ts'

class MemoryStorage implements PrinterMemoryStorage {
  readonly data = new Map<string, string>()
  fail = false
  getItem(key: string): Promise<string | null> {
    return this.fail ? Promise.reject(new Error('x')) : Promise.resolve(this.data.get(key) ?? null)
  }
  setItem(key: string, value: string): Promise<void> {
    if (this.fail) return Promise.reject(new Error('x'))
    this.data.set(key, value)
    return Promise.resolve()
  }
  removeItem(key: string): Promise<void> {
    this.data.delete(key)
    return Promise.resolve()
  }
}

class Target implements PrinterMemoryTarget {
  hasRemembered = false
  listener: ((value: RememberedPrinter | null) => void) | null = null
  onRememberedChange(listener: (value: RememberedPrinter | null) => void): () => void {
    this.listener = listener
    return () => (this.listener = null)
  }
}

const BT: RememberedPrinter = { method: 'bluetooth', deviceId: 'AA:BB' }

describe('readPrinterMemory', () => {
  it('없음·깨진 값·형식 밖은 null, 올바른 값은 그대로', () => {
    expect(readPrinterMemory(null)).toBeNull()
    expect(readPrinterMemory('{깨짐')).toBeNull()
    expect(readPrinterMemory(JSON.stringify({ method: 'bluetooth', deviceId: '' }))).toBeNull()
    expect(readPrinterMemory(JSON.stringify(BT))).toEqual(BT)
  })
})

describe('wirePrinterMemory', () => {
  it('저장된 기억을 한 번 되살린다', async () => {
    const storage = new MemoryStorage()
    storage.data.set(PRINTER_MEMORY_KEY, JSON.stringify(BT))
    const restored: Array<RememberedPrinter | null> = []
    await wirePrinterMemory(new Target(), (v) => restored.push(v), storage)
    expect(restored).toEqual([BT])
  })

  it('바뀌면 쓰고, 지우면 지운다', async () => {
    const storage = new MemoryStorage()
    const target = new Target()
    await wirePrinterMemory(target, () => undefined, storage)
    target.listener?.(BT)
    expect(JSON.parse(storage.data.get(PRINTER_MEMORY_KEY)!)).toEqual(BT)
    target.listener?.(null)
    expect(storage.data.has(PRINTER_MEMORY_KEY)).toBe(false)
  })

  it('되살리기 전에 판매자가 이미 이었으면 덮지 않는다', async () => {
    const storage = new MemoryStorage()
    storage.data.set(PRINTER_MEMORY_KEY, JSON.stringify(BT))
    const target = new Target()
    target.hasRemembered = true
    const restored: unknown[] = []
    await wirePrinterMemory(target, (v) => restored.push(v), storage)
    expect(restored).toEqual([])
  })

  it('저장소가 실패해도 멈추지 않는다', async () => {
    const storage = new MemoryStorage()
    storage.fail = true
    const target = new Target()
    await expect(wirePrinterMemory(target, () => undefined, storage)).resolves.toBeUndefined()
    expect(() => target.listener?.(BT)).not.toThrow()
  })
})

it('다시 연 앱은 같은 출력 기기이며 테스트를 통과한 실물 프린터만 기억한다', async () => {
  const storage = new MemoryStorage()
  const first = await loadPrintMemory(storage, () => 'app-first')
  first.printerTests.set('printer-A', true)
  await Promise.resolve()
  const second = await loadPrintMemory(storage, () => 'app-second')
  expect(second.deviceId).toBe(first.deviceId)
  expect(second.printerTests.has('printer-A')).toBe(true)
  expect(second.printerTests.has('printer-B')).toBe(false)
})

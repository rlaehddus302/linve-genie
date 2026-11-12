// 기억한 프린터를 앱 저장소에 둔다 (LABEL_RULES L-7 "마지막 프린터 기억", D-QS1-01 (6)) — 웹의 브라우저 저장소와 같은 값·같은 이름.
// 두는 것은 연결 방법과 기기 ID뿐이다(기기 이름·판매자 정보 없음). 서버로 보내지 않는다.
// 앱을 다시 켜면 되살려 "다시 연결"이 고르기 창 없이 그 기기로 잇는다. 되살리기 전에 판매자가 이미 이었으면 되살린 값으로 덮지 않는다.
import { parseRememberedPrinter, type RememberedPrinter } from '@livejjim/printer'

/** 웹 printer-station REMEMBERED_KEY와 같은 이름 */
export const PRINTER_MEMORY_KEY = 'livejjim.printer.remembered'

/** AsyncStorage에서 쓰는 부분 */
export interface PrinterMemoryStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PrinterMemoryTarget {
  readonly hasRemembered: boolean
  onRememberedChange(listener: (value: RememberedPrinter | null) => void): () => void
}

/** 저장소 값 → 기억 (깨진 값·형식 밖이면 null) */
export function readPrinterMemory(raw: string | null): RememberedPrinter | null {
  if (raw === null) return null
  try {
    return parseRememberedPrinter(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * 되살리고(한 번), 바뀔 때마다 쓴다. restore는 되살린 값을 어댑터에 넣는 함수다.
 * 돌려준 약속은 되살리기가 끝나면 풀린다(시험용). 저장소가 실패해도 앱은 계속 간다(기억 없이 — 다음 연결은 고르기 창).
 */
export function wirePrinterMemory(target: PrinterMemoryTarget, restore: (value: RememberedPrinter | null) => void, storage: PrinterMemoryStorage, key: string = PRINTER_MEMORY_KEY): Promise<void> {
  let touched = false
  target.onRememberedChange((value) => {
    touched = true
    const write = value === null ? storage.removeItem(key) : storage.setItem(key, JSON.stringify(value))
    void write.catch(() => undefined)
  })
  return storage.getItem(key).then(
    (raw) => {
      if (touched || target.hasRemembered) return
      const value = readPrinterMemory(raw)
      if (value !== null) restore(value)
    },
    () => undefined,
  )
}

/** 설치별 출력 기기 ID와 실물 프린터별 테스트 결과. 앱을 다시 열어도 같은 출력 기기를 쓴다. */
export async function loadPrintMemory(storage: PrinterMemoryStorage, makeId: () => string) {
  const deviceKey = 'livegenie.print.device'
  const testsKey = 'livegenie.print.confirmed'
  const [saved, raw] = await Promise.all([deviceKey, testsKey].map((key) => storage.getItem(key).catch(() => null)))
  const deviceId = saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved) ? saved : makeId()
  if (deviceId !== saved) await storage.setItem(deviceKey, deviceId).catch(() => undefined)
  let tested = new Set<string>()
  try {
    const values: unknown = JSON.parse(raw ?? '[]')
    if (Array.isArray(values)) tested = new Set(values.filter((v): v is string => typeof v === 'string'))
  } catch { /* 이전 저장값이 깨졌으면 새로 확인한다. */ }
  let writes = Promise.resolve()
  const printerTests = {
    has: (id: string) => tested.has(id),
    set: (id: string, yes: boolean) => {
      if (tested.has(id) === yes) return
      if (yes) tested.add(id)
      else tested.delete(id)
      const value = JSON.stringify([...tested])
      writes = writes.then(() => storage.setItem(testsKey, value)).catch(() => undefined)
    },
  }
  return { deviceId, printerTests }
}

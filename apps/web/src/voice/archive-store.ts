// 음성 인식 기록 모아 두기 (V3 D-V3-56, AC-V3-65~67): 설정이 켜져 있으면 덩어리마다 가린 글과 읽은 값을 이 기기 IndexedDB에 방송별로 남긴다.
// 서버로 보내지 않는다. 30일 지난 덩어리는 지운다(남길 때·열 때). [기록 지우기]·[음성 인식 기록 내려받기](방송 하나 또는 전체).
// 가리기·형식은 음성 패키지(createArchiveChunk·createArchiveExport) — 이 파일은 저장만 한다. IndexedDB를 쓸 수 없으면 조용히 아무것도 하지 않는다.
import type { VoiceArchiveBroadcast, VoiceArchiveChunk } from '@livejjim/voice'

const DB_NAME = 'livejjim-voice-archive'
const STORE = 'chunks'
/** 남겨 두는 기간 (음성 패키지 VOICE_ARCHIVE_KEEP_MS와 같다) */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

export interface ArchiveRecord {
  readonly broadcastId: string
  readonly title: string
  readonly date: string
  readonly chunk: VoiceArchiveChunk
}

/** 설정 저장 키 (같은 음성 설정 저장값 안) */
export const ARCHIVE_KEY = 'voice.archive'
export const ARCHIVE_LABEL = '음성 인식 기록 모아 두기'
export const ARCHIVE_CLEAR = '기록 지우기'
export const ARCHIVE_DOWNLOAD_ONE = '이 방송 음성 인식 기록 내려받기'
export const ARCHIVE_DOWNLOAD_ALL = '음성 인식 기록 모두 내려받기'
export const ARCHIVE_CLEARED = '음성 인식 기록을 지웠어요.'

/** 저장값에서 켬/끔. 없으면 연습(이 컴퓨터·같은 와이파이 주소)은 켬, 운영은 끔 (D-V3-56) */
export function readArchive(stored: unknown, hostname: string = typeof location === 'undefined' ? '' : location.hostname): boolean {
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    const value = (stored as Record<string, unknown>)[ARCHIVE_KEY]
    if (typeof value === 'boolean') return value
  }
  return isPracticeHost(hostname)
}

/** 연습 서버 주소인가 (localhost·127.x·사설 IP) */
export function isPracticeHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a, b] = parts as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('broadcastId', 'broadcastId')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

async function all(): Promise<(ArchiveRecord & { readonly id: number })[]> {
  const db = await open()
  if (db === null) return []
  return await new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as (ArchiveRecord & { id: number })[])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** 30일 지난 덩어리를 지운다 */
export async function pruneArchiveStore(now: number = Date.now()): Promise<void> {
  const records = await all()
  const old = records.filter((record) => now - record.chunk.at > KEEP_MS)
  if (old.length === 0) return
  const db = await open()
  if (db === null) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    for (const record of old) tx.objectStore(STORE).delete(record.id)
    await done(tx)
  } catch {
    // 지우지 못하면 다음에
  }
}

/** 덩어리 하나를 남긴다 (가린 뒤 — createArchiveChunk 결과) */
export async function addArchiveChunk(record: ArchiveRecord): Promise<void> {
  const db = await open()
  if (db === null) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(record)
    await done(tx)
  } catch {
    // 남기지 못하면 이번 덩어리는 없다
  }
  await pruneArchiveStore(record.chunk.at)
}

/** 방송별로 묶은 기록 (broadcastId가 있으면 그 방송만) */
export async function archiveBroadcasts(broadcastId?: string): Promise<VoiceArchiveBroadcast[]> {
  await pruneArchiveStore()
  const records = await all()
  const groups = new Map<string, { title: string; date: string; chunks: VoiceArchiveChunk[] }>()
  for (const record of records) {
    if (broadcastId !== undefined && record.broadcastId !== broadcastId) continue
    const group = groups.get(record.broadcastId) ?? { title: record.title, date: record.date, chunks: [] }
    group.chunks.push(record.chunk)
    groups.set(record.broadcastId, group)
  }
  return [...groups].map(([id, group]) => ({ broadcastId: id, title: group.title, date: group.date, chunks: group.chunks.sort((a, b) => a.at - b.at) }))
}

/** [기록 지우기] — broadcastId가 없으면 전부 */
export async function clearArchive(broadcastId?: string): Promise<void> {
  const db = await open()
  if (db === null) return
  const records = broadcastId === undefined ? [] : await all()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    if (broadcastId === undefined) tx.objectStore(STORE).clear()
    else for (const record of records) if (record.broadcastId === broadcastId) tx.objectStore(STORE).delete(record.id)
    await done(tx)
  } catch {
    // 지우지 못하면 그대로
  }
}

/** JSON 파일로 내려받기 */
export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 켤 때 안내 (음성 패키지 VOICE_ARCHIVE_NOTICE와 같은 문장 — 화면 파일은 음성 패키지 값을 직접 부르지 않는다) */
export const VOICE_ARCHIVE_NOTICE = '판매자 목소리를 글로 바꾼 것이 이 기기에 남아요. 시청자 이름이 들어갈 수 있어요.'

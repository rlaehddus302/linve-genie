// 음성 인식 기록 모아 두기 (V3 D-V3-56, AC-V3-65~67): 설정이 켜져 있으면 덩어리마다 가린 글과 읽은 값을 이 기기 IndexedDB에 방송별로 남긴다.
// 서버로 보내지 않는다. 30일 지난 덩어리는 지운다(남길 때·열 때). [기록 지우기]·[음성 인식 기록 내려받기](방송 하나 또는 전체).
// 가리기·형식은 음성 패키지(createArchiveChunk·createArchiveExport) — 이 파일은 저장만 한다. IndexedDB를 쓸 수 없으면 조용히 아무것도 하지 않는다.
import type { VoiceArchiveBroadcast, VoiceArchiveChunk } from '@livejjim/voice'
import { archiveEnabled, type ArchiveGap } from './archive-model.ts'
export { ARCHIVE_KEY, type ArchiveGap } from './archive-model.ts'

const DB_PREFIX = 'livejjim-voice-archive'
/** 지금 로그인한 판매자 (기록은 판매자마다 따로 — RA-V3-008). 모르면 남기지 않는다 */
let seller: string | null = null

/** 로그인한 판매자를 알린다 (로그아웃이면 null) */
export function setArchiveSeller(id: string | null): void {
  seller = id
}

const dbName = (id: string): string => `${DB_PREFIX}:${encodeURIComponent(id)}`
const STORE = 'chunks'
/** 남겨 두는 기간 (음성 패키지 VOICE_ARCHIVE_KEEP_MS와 같다) */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000

export interface ArchiveRecord {
  readonly broadcastId: string
  readonly title: string
  readonly date: string
  readonly chunk: VoiceArchiveChunk
}

/** 저장 모양 (시각 색인을 위해 at을 위에 둔다) */
type StoredRecord = ArchiveRecord & { readonly at: number }

/** 설정 저장 키 (같은 음성 설정 저장값 안) */
export const ARCHIVE_LABEL = '음성 인식 기록 모아 두기'
export const ARCHIVE_CLEAR = '기록 지우기'
export const ARCHIVE_DOWNLOAD_ONE = '이 방송 음성 인식 기록 내려받기'
export const ARCHIVE_DOWNLOAD_ALL = '음성 인식 기록 모두 내려받기'
export const ARCHIVE_CLEARED = '음성 인식 기록을 지웠어요.'

/** 저장값에서 켬/끔. 없으면 연습(이 컴퓨터 주소)은 켬, 운영은 끔 (D-V3-56) */
export function readArchive(stored: unknown, hostname: string = typeof location === 'undefined' ? '' : location.hostname): boolean {
  return archiveEnabled(stored, isPracticeHost(hostname))
}

/** 연습 주소인가 (이 컴퓨터만 — localhost·127.0.0.1·[::1]·*.localhost). 같은 와이파이의 사설 주소는 운영처럼 끔 (RA-V3-008) */
export function isPracticeHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || seller === null) {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(dbName(seller), 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('broadcastId', 'broadcastId')
        store.createIndex('at', 'at')
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

/** 30일 지난 덩어리를 지운다 — 시각 색인 범위로 (모두 읽지 않는다) */
export async function pruneArchiveStore(now: number = Date.now()): Promise<void> {
  const db = await open()
  if (db === null) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const index = tx.objectStore(STORE).index('at')
    const request = index.openCursor(IDBKeyRange.upperBound(now - KEEP_MS, true))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor === null) return
      cursor.delete()
      cursor.continue()
    }
    await done(tx)
  } catch {
    // 지우지 못하면 다음에
  }
}

/** 로그아웃: 그 판매자의 기록을 모두 지운다 ([기록 지우기]와 같다, RA-V3-008) */
export async function clearArchiveForLogout(): Promise<void> {
  const id = seller
  seller = null
  if (id === null || typeof indexedDB === 'undefined') return
  for (const name of [dbName(id), gapDbName(id)]) {
    await new Promise<void>((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      } catch {
        resolve()
      }
    })
  }
}

/** 덩어리 하나를 남긴다 (가린 뒤 — createArchiveChunk 결과) */
export async function addArchiveChunk(record: ArchiveRecord): Promise<void> {
  const db = await open()
  if (db === null) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const stored: StoredRecord = { ...record, at: record.chunk.at }
    tx.objectStore(STORE).add(stored)
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

/** [기록 지우기] — broadcastId가 없으면 전부 (인식 끊김 줄도 함께) */
export async function clearArchive(broadcastId?: string): Promise<void> {
  await clearGaps(broadcastId)
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

// ── 인식 끊김 줄 (V3 실방송 보강) ──
// 음성 인식이 끊겼다 다시 들은 때마다 "인식 끊김 0.8초 (network)" 한 줄을 같은 설정(기록 모아 두기)이 켜져 있을 때 이 기기에 남긴다.
// 들은 글은 없다(시간·까닭만). 덩어리 DB와 따로 둔다 — 덩어리 DB 판(version)을 올리지 않고, 덩어리 수를 바꾸지 않는다. 같이 지우고 같이 내려받는다.

const GAP_PREFIX = 'livejjim-voice-gaps'
const gapDbName = (id: string): string => `${GAP_PREFIX}:${encodeURIComponent(id)}`
const GAP_STORE = 'gaps'

/** 끊김 한 줄 */

export interface ArchiveGapRecord {
  readonly broadcastId: string
  readonly title: string
  readonly date: string
  readonly gap: ArchiveGap
}

function openGaps(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || seller === null) {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(gapDbName(seller), 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(GAP_STORE)) {
        const store = db.createObjectStore(GAP_STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('at', 'at')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function allGaps(): Promise<(ArchiveGapRecord & { readonly id: number })[]> {
  const db = await openGaps()
  if (db === null) return []
  return await new Promise((resolve) => {
    try {
      const request = db.transaction(GAP_STORE, 'readonly').objectStore(GAP_STORE).getAll()
      request.onsuccess = () => resolve(request.result as (ArchiveGapRecord & { id: number })[])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** 끊김 한 줄을 남긴다 (30일 지난 줄은 지운다) */
export async function addArchiveGap(record: ArchiveGapRecord): Promise<void> {
  const db = await openGaps()
  if (db === null) return
  try {
    const tx = db.transaction(GAP_STORE, 'readwrite')
    const store = tx.objectStore(GAP_STORE)
    store.add({ ...record, at: record.gap.at })
    const old = store.index('at').openCursor(IDBKeyRange.upperBound(record.gap.at - KEEP_MS, true))
    old.onsuccess = () => {
      const cursor = old.result
      if (cursor === null) return
      cursor.delete()
      cursor.continue()
    }
    await done(tx)
  } catch {
    // 남기지 못하면 이번 줄은 없다
  }
}

/** 방송별 끊김 줄 (broadcastId가 있으면 그 방송만, 시각 순, 30일 안) */
export async function archiveGaps(broadcastId?: string, now: number = Date.now()): Promise<Map<string, { title: string; date: string; gaps: ArchiveGap[] }>> {
  const groups = new Map<string, { title: string; date: string; gaps: ArchiveGap[] }>()
  for (const record of await allGaps()) {
    if (broadcastId !== undefined && record.broadcastId !== broadcastId) continue
    if (!(now - record.gap.at <= KEEP_MS)) continue
    const group = groups.get(record.broadcastId) ?? { title: record.title, date: record.date, gaps: [] }
    group.gaps.push(record.gap)
    groups.set(record.broadcastId, group)
  }
  for (const group of groups.values()) group.gaps.sort((a, b) => a.at - b.at)
  return groups
}

async function clearGaps(broadcastId?: string): Promise<void> {
  const db = await openGaps()
  if (db === null) return
  const records = broadcastId === undefined ? [] : await allGaps()
  try {
    const tx = db.transaction(GAP_STORE, 'readwrite')
    if (broadcastId === undefined) tx.objectStore(GAP_STORE).clear()
    else for (const record of records) if (record.broadcastId === broadcastId) tx.objectStore(GAP_STORE).delete(record.id)
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

// 기기에만 남기는 동의·설정·선택한 기록. 원시 소리는 저장하지 않는다.
interface Store { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem?(key: string): Promise<void> }
let store: Store | null = null
let prefs: Record<string, unknown> = {}
export function configureVoiceStorage(value: Store): void { store = value }
export async function readVoicePreferences(): Promise<Record<string, unknown>> {
  try {
    const raw = await store?.getItem('livegenie.voice.preferences.v1')
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) prefs = parsed as Record<string, unknown>
  } catch { /* 저장을 읽지 못하면 현재 기기 설정 */ }
  return prefs
}
export async function writeVoicePreference(key: string, value: unknown): Promise<void> {
  prefs = { ...prefs, [key]: value }
  await store?.setItem('livegenie.voice.preferences.v1', JSON.stringify(prefs))
}
interface ArchiveEntry { at: number; kind: string; value: unknown }
const KEEP_MS = 30 * 86400000
let account: string | null = null
let archive: readonly ArchiveEntry[] | null = null
let archiveWriting: Promise<void> = Promise.resolve()
const archiveKey = (loginId: string): string => `livegenie.voice.archive.v1.${encodeURIComponent(loginId)}`
export function setVoiceAccount(loginId: string | null): void {
  if (account === loginId) return
  account = loginId; archive = null
}
export async function archiveVoice(kind: string, value: unknown): Promise<void> {
  const current = account
  if (current === null) return
  if (archive === null) {
    const raw = await store?.getItem(archiveKey(current))
    let parsed: unknown = null
    try { parsed = raw ? JSON.parse(raw) : null } catch { /* 손상된 기록은 읽지 않는다 */ }
    archive = Array.isArray(parsed) ? parsed.filter((entry): entry is ArchiveEntry => entry !== null && typeof entry === 'object' && Number.isFinite(entry.at) && typeof entry.kind === 'string') : []
  }
  if (current !== account) return
  archive = [...archive.filter((item) => Date.now() - item.at < KEEP_MS), { at: Date.now(), kind, value }]
  archiveWriting = store?.setItem(archiveKey(current), JSON.stringify(archive)) ?? Promise.resolve()
  await archiveWriting
}
/** D-V3-110: 판매자별 기록, 로그아웃 때 삭제. 세션 비밀은 이 저장소에 넣지 않는다. */
export async function clearVoiceArchive(): Promise<void> {
  const current = account
  archive = null; account = null
  if (current === null || store === null) return
  await archiveWriting.catch(() => undefined)
  if (store.removeItem) await store.removeItem(archiveKey(current))
  else await store.setItem(archiveKey(current), '[]')
}

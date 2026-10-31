// 저장 API와 분리한 기록 설정·전송 모양. 서버 읽기 세션도 DOM 없이 쓴다.
export const ARCHIVE_KEY = 'voice.archive'
export interface ArchiveGap {
  readonly at: number
  readonly ms: number
  readonly reason: string
  readonly text: string
}
export function archiveEnabled(stored: unknown, fallback = false): boolean {
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    const value = (stored as Record<string, unknown>)[ARCHIVE_KEY]
    if (typeof value === 'boolean') return value
  }
  return fallback
}

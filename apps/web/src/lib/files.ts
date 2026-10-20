// 서버가 만든 파일을 다루는 화면 도구 (I2 D-I2-01, AC-I2-13·15·81).
// - 받은 바이트를 그대로 쓴다: 미리 보기 그림·공유 파일·저장 파일이 같은 바이트다(화면이 다시 그리지 않는다).
// - 브라우저 저장소(localStorage·sessionStorage·IndexedDB)에 두지 않는다 — 메모리의 객체 주소(blob:)만 쓰고 다 쓰면 놓는다.

/** 파일 저장(내려받기): 같은 바이트를 그 이름으로 */
export function saveFile(blob: Blob, fileName: string): void {
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // 브라우저가 내려받기를 시작할 시간을 두고 놓는다
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 미리 보기 그림 주소 (blob:) — 쓰지 않으면 revokeObjectUrl로 놓는다 */
export function objectUrl(blob: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null
}

export function revokeObjectUrl(url: string | null): void {
  if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

/** 이 기기가 파일 공유를 하는가 (navigator.canShare({ files })가 참) */
export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** 공유를 고르기 전에 묻는 빈 그림 파일 (받은 그림이 아직 없을 때) */
export const PROBE_PNG = (): File => new File([new Uint8Array(0)], 'receipt.png', { type: 'image/png' })

export type ShareOutcome = 'shared' | 'cancelled' | 'failed'

/**
 * 파일 공유: 누른 순간 그 파일을 넘긴다(다시 받지 않는다). 판매자가 공유 창을 닫으면(AbortError) 'cancelled' — 오류를 보이지 않는다.
 * share는 누른 그 처리 안에서 바로 불러야 한다(브라우저의 사용자 동작 조건) — 이 함수 앞에서 기다리지 않는다.
 */
export function shareFile(file: File): Promise<ShareOutcome> {
  let pending: Promise<void>
  try {
    pending = navigator.share({ files: [file] })
  } catch {
    return Promise.resolve('failed')
  }
  return pending.then(
    () => 'shared' as const,
    (error: unknown) => (error instanceof DOMException && error.name === 'AbortError' ? ('cancelled' as const) : ('failed' as const)),
  )
}

/** 파일 크기 "1.2MB" · "3.4KB" (설정 화면의 백업 목록) */
export function sizeWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const mb = 1024 * 1024
  if (bytes >= mb) return `${(Math.round((bytes / mb) * 10) / 10).toFixed(1)}MB`
  const kb = Math.max(Math.round((bytes / 1024) * 10) / 10, 0.1)
  return `${kb.toFixed(1)}KB`
}

/** File의 바이트를 base64로 (상품 목록 가져오기 미리 보기에 싣는다) */
export async function fileBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

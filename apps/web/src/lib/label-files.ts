// 라벨 파일 저장·공유 (LBL-07, D-I1-07, AC-I1-40~42): 브라우저 내려받기, 파일 공유를 지원하는 휴대폰은 공유.
// 내보내기는 출력함이 아니다 — 작업 상태·이력·엔진을 바꾸지 않는다.

/** 파일 내려받기 (브라우저 저장) */
export function downloadBytes(bytes: Uint8Array, name: string, type: string): void {
  const blob = new Blob([new Uint8Array(bytes)], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 파일 공유를 지원하는지 (휴대폰 — 그림 파일 하나) */
export function canShareFile(): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    const probe = new File([new Uint8Array([0])], 'label.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** 그림 파일 공유 (취소하면 아무 일도 없다) */
export async function shareBytes(bytes: Uint8Array, name: string, type: string): Promise<void> {
  const file = new File([new Uint8Array(bytes)], name, { type })
  try {
    await navigator.share({ files: [file] })
  } catch {
    // 판매자가 공유 창을 닫았다
  }
}

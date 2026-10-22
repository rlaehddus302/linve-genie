// CSV 파일 글 읽기 (DP-2 끝, D-N3-08, AC-N3-45): UTF-8로 읽어 보고, 올바른 UTF-8이 아니면 EUC-KR로 읽는다(은행이 내려 주는 CSV는 EUC-KR이 흔하다).
// 맨 앞 BOM은 디코더가 뺀다. 읽은 글은 붙여넣기 칸에 넣을 뿐이고, 표를 읽는 규칙은 서버(DP-2)가 정한다.

/** 파일 바이트 → 글 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/** 고른 파일을 읽는다 (arrayBuffer가 없는 오래된 브라우저는 FileReader로) */
export async function readCsvFile(file: Blob): Promise<string> {
  if (typeof file.arrayBuffer === 'function') return decodeCsv(await file.arrayBuffer())
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했어요'))
    reader.readAsArrayBuffer(file)
  })
  return decodeCsv(bytes)
}

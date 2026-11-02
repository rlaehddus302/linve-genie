// 클립보드 읽기 (방송 시작 → 유튜브 주소 붙여넣기 단계). 읽는 함수는 바꿔 끼운다(앱은 expo-clipboard, 시험은 가짜).
// 주소가 유튜브 방송 주소처럼 보일 때만 버튼 하나로 붙여 넣는다 — 진짜 주소인지는 서버가 정한다(잇기 API의 거절 문장 그대로).

type Reader = () => Promise<string>
type Writer = (text: string) => Promise<boolean>

let reader: Reader = async () => ''
let writer: Writer = async () => false

export function setClipboardReader(next: Reader): void {
  reader = next
}

/** 클립보드 쓰기 (영수증 링크 복사 — D-APPX-03). 앱은 expo-clipboard, 시험은 가짜 */
export function setClipboardWriter(next: Writer): void {
  writer = next
}

/** 글을 클립보드에 넣는다. 못 넣으면 false (화면이 손으로 복사할 글 칸을 보인다) */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    return await writer(text)
  } catch {
    return false
  }
}

/** 유튜브 방송 주소처럼 보이면 다듬은 주소, 아니면 null (youtube.com·youtu.be만 — 판정은 서버 parseVideoId) */
export function youtubeAddress(text: string): string | null {
  const value = text.trim()
  if (value === '' || value.length > 2048 || /\s/.test(value)) return null
  return /^(https?:\/\/)?((www|m|studio)\.)?(youtube\.com|youtu\.be)\//i.test(value) ? value : null
}

/** 클립보드의 유튜브 주소 (없거나 못 읽으면 null) */
export async function clipboardYoutubeAddress(): Promise<string | null> {
  try {
    return youtubeAddress(await reader())
  } catch {
    return null
  }
}

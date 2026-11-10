// 클립보드 (방송 링크 칸). 읽는 함수는 바꿔 끼운다(앱은 expo-clipboard, 시험은 가짜).
// 아이폰은 앱이 클립보드를 읽을 때마다 "붙여넣기 허용" 창을 띄운다 — 그래서 저절로 읽지 않고, 글이 있는지만 본 뒤(probe, 창 없음)
// 칸 아래 [붙여넣기] 칩을 보인다(누르면 읽는다 — 아이폰은 이때 허용을 물을 수 있다) (D-UX3-11 → D-UX4-115). 진짜 방송 링크인지는 서버가 정한다.

type Reader = () => Promise<string>
type Writer = (text: string) => Promise<boolean>
type Probe = () => Promise<boolean>

let reader: Reader = async () => ''
let writer: Writer = async () => false
let probe: Probe | null = null

/** 클립보드에 글이 있는지만 본다 (아이폰 hasStrings — 허용 창이 뜨지 않는다). 시험·기본은 읽어서 본다 */
export function setClipboardProbe(next: Probe | null): void {
  probe = next
}

export async function clipboardHasText(): Promise<boolean> {
  try {
    return probe === null ? (await reader()).trim() !== '' : await probe()
  } catch {
    return false
  }
}

/** 클립보드 글 읽기 ([붙여넣기]를 눌렀을 때) */
export async function readClipboard(): Promise<string> {
  try {
    return await reader()
  } catch {
    return ''
  }
}

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

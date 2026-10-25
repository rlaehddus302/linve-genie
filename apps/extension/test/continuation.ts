// 시험용: 유튜브 live_chat continuation 모양 (pytchat의 liveparam 구조 — base64 안에 base64가 든 프로토콜 버퍼)
const varint = (n: number): string => {
  let out = ''
  let rest = n
  while (rest >= 0x80) {
    out += String.fromCharCode((rest % 0x80) | 0x80)
    rest = Math.floor(rest / 0x80)
  }
  return out + String.fromCharCode(rest)
}
const field = (no: number, value: string): string => varint(no * 8 + 2) + varint(value.length) + value
const b64url = (bytes: string): string => btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_')

/** 영상 ID·채널 ID로 continuation을 만든다 */
export function continuationFor(video: string, channel = 'UCx980AAAAAAAAAAAAAAAAAA'): string {
  const s1 = field(3, field(1, video)) + field(5, field(1, channel) + field(2, video))
  const header = btoa(field(1, s1) + field(3, field(48687757, field(1, video))) + varint(4 * 8) + varint(1))
  return encodeURIComponent(b64url(field(119693434, field(1, header) + field(2, 'timestamps'))))
}

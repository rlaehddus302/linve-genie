// CH-08: 영상 주소가 아닌 `@핸들/live` 링크는 공유 버튼 안내를 낸다
import { describe, expect, it } from 'vitest'
import { NOT_VIDEO_LINK_MESSAGE, isChannelLiveLink } from '../src/lib/youtube.ts'

describe('채널 방송 링크 알아보기', () => {
  it.each(['@minjung/live', '＠minjung/live', ' https://www.tiktok.com/@minjung/live ', 'www.youtube.com/@minjung/live', '@다육이/live?x=1'])('%s 는 영상 주소가 아니다', (text) => {
    expect(isChannelLiveLink(text)).toBe(true)
  })
  it.each(['https://youtu.be/ABCDEFGHIJK', 'https://www.youtube.com/live/ABCDEFGHIJK', 'ABCDEFGHIJK', '잘못된 주소', '@minjung', ''])('%s 는 아니다', (text) => {
    expect(isChannelLiveLink(text)).toBe(false)
  })
  it('안내 문장', () => {
    expect(NOT_VIDEO_LINK_MESSAGE).toBe('라이브 화면의 공유 버튼으로 주소를 복사해 주세요.') // 문구 바뀜 (D-UX4-86)
  })
})

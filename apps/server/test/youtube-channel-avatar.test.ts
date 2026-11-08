// D-UX3-85: 홈 맨 위 라이브 표시에 쓸 채널 프로필 사진 주소 — 채널 페이지의 og:image, 유튜브 이미지 호스트(https)만.
import { describe, expect, it } from 'vitest'
import { realTimer } from '../src/youtube/timer.ts'
import { HttpWebTransport, parseChannelAvatar, WebChatSource } from '../src/youtube/web-chat-source.ts'

const page = (image: string) => `<html><head><meta property="og:image" content="${image}"></head></html>`

describe('parseChannelAvatar', () => {
  it('유튜브 이미지 호스트의 https 주소만 (&amp;는 풀어 준다)', () => {
    expect(parseChannelAvatar(page('https://yt3.googleusercontent.com/abc=s900-c-k?x=1&amp;y=2'))).toBe('https://yt3.googleusercontent.com/abc=s900-c-k?x=1&y=2')
    expect(parseChannelAvatar(page('https://yt3.ggpht.com/abc'))).toBe('https://yt3.ggpht.com/abc')
    expect(parseChannelAvatar(page('http://yt3.ggpht.com/abc'))).toBeNull()
    expect(parseChannelAvatar(page('https://evil.example.com/a.png'))).toBeNull()
    expect(parseChannelAvatar('<html></html>')).toBeNull()
  })

  it('WebChatSource.channelAvatar는 채널 페이지를 한 번 읽어 주소를 준다', async () => {
    const timer = realTimer()
    const urls: string[] = []
    const fetcher = (async (input: string) => {
      urls.push(String(input))
      return new Response(page('https://yt3.ggpht.com/me'), { status: 200 })
    }) as unknown as typeof fetch
    const source = new WebChatSource({ timer, transport: new HttpWebTransport({ timer, fetch: fetcher }) })
    expect(await source.channelAvatar('UCaaaaaaaaaaaaaaaaaaaaaa')).toBe('https://yt3.ggpht.com/me')
    expect(urls).toEqual(['https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa?hl=en'])
  })
})

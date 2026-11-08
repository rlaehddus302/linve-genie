// D-YT-SRV-21: 유튜브 웹 읽기를 집 회선 프록시(방송 소리와 같은 LIVEJJIM_YT_MEDIA_PROXY)로 보낸다.
// 데이터센터 IP는 유튜브 봇 확인에 막힌다(D-YT-SRV-19). 프록시에 닿지 못하면 그 요청만 이 서버에서 바로 다시 부르고, 유튜브의 막힘 응답은 그대로 쓴다.
import { describe, expect, it } from 'vitest'
import { readYoutubeWebChat, readYoutubeWebProxy } from '../src/config.ts'
import { realTimer } from '../src/youtube/timer.ts'
import { HttpWebTransport, WebChatSource } from '../src/youtube/web-chat-source.ts'

const ok = (text: string, status = 200) => new Response(text, { status })

function counter(respond: () => Response | Promise<Response>) {
  const urls: string[] = []
  const fn = (async (input: string) => {
    urls.push(String(input))
    return await respond()
  }) as unknown as typeof fetch
  return { fn, urls }
}

describe('설정', () => {
  it('방송 소리 프록시가 있으면 웹 읽기도 같은 출구로, LIVEJJIM_YT_WEB_PROXY=off면 쓰지 않는다', () => {
    expect(readYoutubeWebProxy({}, 'http://host.docker.internal:18888')).toBe('http://host.docker.internal:18888')
    expect(readYoutubeWebProxy({}, null)).toBeNull()
    expect(readYoutubeWebProxy({ LIVEJJIM_YT_WEB_PROXY: ' OFF ' }, 'http://127.0.0.1:18888')).toBeNull()
    expect(readYoutubeWebChat({}, 'http://127.0.0.1:18888')).toMatchObject({ on: true, proxy: 'http://127.0.0.1:18888' })
    expect(readYoutubeWebChat({ LIVEJJIM_YT_WEB_CHAT: 'off' }, 'http://127.0.0.1:18888')).toEqual({ on: false, warning: null })
  })
})

describe('HttpWebTransport 프록시', () => {
  const timer = realTimer()

  it('프록시가 있으면 프록시로만 부른다', async () => {
    const direct = counter(() => ok('direct'))
    const proxied = counter(() => ok('proxied'))
    const transport = new HttpWebTransport({ timer, fetch: direct.fn, proxyFetch: proxied.fn })
    const response = await transport.request({ method: 'GET', path: '/watch?v=abc' })
    expect(response.text).toBe('proxied')
    expect(proxied.urls).toEqual(['https://www.youtube.com/watch?v=abc'])
    expect(direct.urls).toEqual([])
    expect(transport.proxied).toBe(true)
  })

  it('프록시에 닿지 못하면(연결 오류) 그 요청만 이 서버에서 바로 부른다', async () => {
    const direct = counter(() => ok('direct'))
    const proxied = counter(() => {
      throw new TypeError('fetch failed')
    })
    const transport = new HttpWebTransport({ timer, fetch: direct.fn, proxyFetch: proxied.fn })
    expect((await transport.request({ method: 'GET', path: '/live_chat?v=abc' })).text).toBe('direct')
    expect(proxied.urls.length).toBe(1)
    expect(direct.urls.length).toBe(1)
  })

  it('프록시로 받은 유튜브 막힘(429)은 바로 부르지 않고 막힘으로 알린다', async () => {
    const direct = counter(() => ok('direct'))
    const proxied = counter(() => ok('Sign in to confirm you’re not a bot', 429))
    const source = new WebChatSource({ timer, transport: new HttpWebTransport({ timer, fetch: direct.fn, proxyFetch: proxied.fn }) })
    await expect(source.page('abc')).rejects.toMatchObject({ kind: 'BLOCKED' })
    expect(direct.urls).toEqual([])
  })

  it('프록시가 없으면 지금처럼 바로 부른다', async () => {
    const direct = counter(() => ok('direct'))
    const transport = new HttpWebTransport({ timer, fetch: direct.fn })
    expect((await transport.request({ method: 'GET', path: '/watch?v=abc' })).text).toBe('direct')
    expect(transport.proxied).toBe(false)
  })
})

// D-TT-PHOTO-01 틱톡 프로필 사진: 연결할 때 받은 방 정보(roomInfo.data.owner.avatar_thumb)의 주소를 서버가 한 번 받아 작은 사진(data: 주소)으로
// 넘긴다 — 서명 붙은 틱톡 주소의 만료·머리글과 상관없이 아이폰·안드로이드가 같은 글자로 그린다. 틱톡 이미지 서버 https만, 이미지 머리로 다시 확인.
import { afterEach, describe, expect, it } from 'vitest'
import { avatarDataUrl, fetchTikTokAvatar, imageType, isTikTokAvatarUrl, tiktokAvatarUrl, TIKTOK_AVATAR_MAX_BYTES } from '../src/tiktok/index.ts'
import { addSeller, client } from './support.ts'
import { connected, linkTiktok, realBroadcast, tiktokSeller, ttWorld, type TtWorld } from './tiktok-live-support.ts'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const THUMB_WEBP = 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/abc~tplv-tiktokx-cropcenter:100:100.webp?dr=1&x-expires=1763600000&x-signature=x'
const THUMB_JPEG = 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/abc~tplv-tiktokx-cropcenter:100:100.jpeg?dr=1&x-expires=1763600000&x-signature=x'

const worlds: TtWorld[] = []
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

describe('방 정보에서 사진 주소 꺼내기 (순수 함수)', () => {
  it('owner.avatar_thumb의 틱톡 이미지 서버 주소 — JPEG를 먼저, 없으면 avatar_medium', () => {
    expect(tiktokAvatarUrl({ roomInfo: { data: { owner: { avatar_thumb: { url_list: [THUMB_WEBP, THUMB_JPEG] } } } } })).toBe(THUMB_JPEG)
    expect(tiktokAvatarUrl({ roomInfo: { data: { owner: { avatar_thumb: { url_list: [THUMB_WEBP] } } } } })).toBe(THUMB_WEBP)
    expect(tiktokAvatarUrl({ roomInfo: { data: { owner: { avatar_thumb: { url_list: [] }, avatar_medium: { url_list: [THUMB_JPEG] } } } } })).toBe(THUMB_JPEG)
  })

  it('모양이 다르거나 틱톡 이미지 서버가 아닌 주소(http·다른 호스트·사용자 정보·포트)는 쓰지 않는다', () => {
    for (const state of [null, 'x', {}, { roomInfo: null }, { roomInfo: { data: { status: 2 } } }, { roomInfo: { data: { owner: { avatar_thumb: { url_list: 'https://p16.tiktokcdn.com/a.jpeg' } } } } }]) {
      expect(tiktokAvatarUrl(state)).toBeNull()
    }
    for (const url of ['http://p16.tiktokcdn.com/a.jpeg', 'https://evil.example/a.jpeg', 'https://tiktokcdn.com.evil.example/a.jpeg', 'https://u:p@p16.tiktokcdn.com/a.jpeg', 'https://p16.tiktokcdn.com:8443/a.jpeg', 'https://169.254.169.254/latest', 'javascript:alert(1)']) {
      expect(isTikTokAvatarUrl(url), url).toBe(false)
    }
    expect(isTikTokAvatarUrl('https://p77-sign.tiktokcdn-us.com/a.jpeg')).toBe(true)
    expect(isTikTokAvatarUrl('https://p3-pc-sign.ibyteimg.com/a.webp')).toBe(true)
  })

  it('받은 바이트는 이미지 머리로 형식을 정한다 — 이미지가 아니거나 너무 크면 null', () => {
    expect(imageType(JPEG)).toBe('image/jpeg')
    expect(avatarDataUrl(JPEG)).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`)
    expect(avatarDataUrl(new TextEncoder().encode('<html>blocked</html>'))).toBeNull()
    const big = new Uint8Array(TIKTOK_AVATAR_MAX_BYTES + 1)
    big.set(JPEG)
    expect(avatarDataUrl(big)).toBeNull()
  })

  it('실제 받기: 틱톡 이미지 서버 주소만 부르고 넘겨주기(redirect)는 따르지 않는다. 실패는 null', async () => {
    const calls: { url: string; redirect: unknown }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, redirect: init?.redirect })
      return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as unknown as typeof fetch
    expect(await fetchTikTokAvatar(fake)(THUMB_JPEG)).toMatch(/^data:image\/jpeg;base64,/)
    expect(await fetchTikTokAvatar(fake)('https://evil.example/a.jpeg')).toBeNull()
    expect(calls).toEqual([{ url: THUMB_JPEG, redirect: 'error' }])
    const failing = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await fetchTikTokAvatar(failing)(THUMB_JPEG)).toBeNull()
    const notFound = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    expect(await fetchTikTokAvatar(notFound)(THUMB_JPEG)).toBeNull()
  })
})

describe('GET /api/broadcasts/:id/tiktok/avatar', () => {
  it('연결할 때 받은 방 정보의 사진을 한 번 받아 data: 주소로 — 다시 물으면 다시 받지 않는다. 다른 판매자의 회차는 404', async () => {
    const fetched: string[] = []
    const w = await ttWorld({
      avatarFetch: async (url) => {
        fetched.push(url)
        return avatarDataUrl(JPEG)
      },
    })
    worlds.push(w)
    const { seller, tiktokId } = await tiktokSeller(w)
    w.webcast.avatar(tiktokId, [THUMB_WEBP, THUMB_JPEG])
    const b = await realBroadcast(w, seller)
    const api = client(w, seller.cookie)
    // 아직 연결 전: 주소를 모른다
    expect((await api.get(`/api/broadcasts/${b}/tiktok/avatar`)).body).toEqual({ avatar: null })
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await connected(w, seller, b)
    const first = await api.get(`/api/broadcasts/${b}/tiktok/avatar`)
    expect(first.status).toBe(200)
    expect(first.body.avatar).toBe(avatarDataUrl(JPEG))
    expect((await api.get(`/api/broadcasts/${b}/tiktok/avatar`)).body.avatar).toBe(avatarDataUrl(JPEG))
    expect(fetched).toEqual([THUMB_JPEG])

    const other = await addSeller(w)
    expect((await client(w, other.cookie).get(`/api/broadcasts/${b}/tiktok/avatar`)).status).toBe(404)
  })

  it('방 정보에 사진이 없거나 받지 못하면 null (기본 그림)', async () => {
    const w = await ttWorld({ avatarFetch: async () => null })
    worlds.push(w)
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await connected(w, seller, b)
    expect((await client(w, seller.cookie).get(`/api/broadcasts/${b}/tiktok/avatar`)).body).toEqual({ avatar: null })
    w.webcast.avatar(tiktokId, [THUMB_JPEG])
    expect((await client(w, seller.cookie).get(`/api/broadcasts/${b}/tiktok/avatar`)).body).toEqual({ avatar: null })
  })
})

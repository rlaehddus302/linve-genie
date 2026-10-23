// AC-L1-11 유튜브 연결과 따로 (D-L1-05, D-Y02, D-019): 구글 로그인은 유튜브 권한을 묻지 않고, 서로의 연결·state·돌아오는 주소를 건드리지 않는다.
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { FakeOAuth } from '../src/social/fake-oauth.ts'
import { ORIGIN, addSeller, client } from './support.ts'
import { approve, openCallback, resultOf, runFlow, startFlow, type SocialWorld } from './l1-support.ts'
import { callback as youtubeCallback, connectSeller, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const fakes: FakeOAuth[] = []
const youtubes: YoutubeWorld[] = []
afterAll(async () => {
  for (const fake of fakes) await fake.close()
  for (const world of youtubes) await world.fake.close()
})

async function bothWorld(): Promise<SocialWorld & YoutubeWorld & { readonly social: FakeOAuth }> {
  const social = await FakeOAuth.start({ redirectUris: { google: `${ORIGIN}/api/auth/google/callback` } })
  fakes.push(social)
  const world = await youtubeWorld({ overrides: { socialLogin: social.setup({ providers: ['google'] }) } })
  youtubes.push(world)
  return { ...world, social, fake: world.fake } as unknown as SocialWorld & YoutubeWorld & { readonly social: FakeOAuth }
}
const asSocial = (world: YoutubeWorld, social: FakeOAuth): SocialWorld => ({ ...world, fake: social })

describe('AC-L1-11 유튜브 연결과 따로', () => {
  it('구글 로그인 승인 주소에 youtube 권한이 없고, 유튜브 연결 승인 주소는 L1 전과 같다(읽기 권한)', async () => {
    const world = await bothWorld()
    const s = asSocial(world, world.social)
    const seller = await addSeller(world)
    const login = new URL((await startFlow(s, 'google')).authorizeUrl)
    expect(login.searchParams.get('scope')).toBe('openid email')
    expect(login.toString()).not.toMatch(/youtube/i)
    const youtube = await client(world, seller.cookie).post('/api/youtube/connection/start', {})
    const url = new URL(youtube.body.authorizeUrl as string)
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly')
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.livejjim.test/api/youtube/oauth/callback')
  })

  it('구글 로그인 연결·로그인·끊기는 유튜브 연결을 바꾸지 않고, 유튜브 끊기는 구글 로그인 연결을 바꾸지 않는다 (서로 다른 구글 계정이어도 된다)', async () => {
    const world = await bothWorld()
    const s = asSocial(world, world.social)
    const connected = await connectSeller(world)
    const pg = world.database.pglite as PGlite
    const youtubeRows = async () => JSON.stringify((await pg.query(`select * from youtube_connections`)).rows)
    const before = await youtubeRows()
    const user = world.social.addUser('google', { email: 'other.account@gmail.com' })
    expect((await runFlow(s, 'google', user.id, { session: connected.seller.cookie })).result.login).toBe('LINKED')
    const viaGoogle = await runFlow(s, 'google', user.id)
    expect(viaGoogle.session).not.toBeNull()
    expect((await client(world, connected.seller.cookie).post('/api/auth/unlink', { provider: 'google' })).status).toBe(200)
    expect(await youtubeRows()).toBe(before)
    expect((await runFlow(s, 'google', user.id, { session: connected.seller.cookie })).result.login).toBe('LINKED')
    expect((await client(world, connected.seller.cookie).post('/api/youtube/connection/disconnect', {})).status).toBe(200)
    expect((await pg.query(`select provider from login_links`)).rows).toEqual([{ provider: 'google' }])
  })

  it('한쪽 state를 다른 쪽 돌아오는 주소에 넣으면 EXPIRED (유튜브 쪽은 기존 STATE_INVALID)', async () => {
    const world = await bothWorld()
    const s = asSocial(world, world.social)
    const seller = await addSeller(world)
    // 유튜브 state → 구글 로그인 돌아오는 주소
    const youtube = await client(world, seller.cookie).post('/api/youtube/connection/start', {})
    const youtubeState = new URL(youtube.body.authorizeUrl as string).searchParams.get('state') as string
    const loginStart = await startFlow(s, 'google')
    expect(resultOf(await openCallback(s, `${ORIGIN}/api/auth/google/callback?code=x&state=${youtubeState}`, { browser: loginStart.browser, session: seller.cookie })).login).toBe('EXPIRED')
    // 구글 로그인(연결) state → 유튜브 돌아오는 주소
    const link = await startFlow(s, 'google', { session: seller.cookie })
    const user = world.social.addUser('google')
    const search = new URL(approve(world.social, link.authorizeUrl, user.id)).search
    expect(await youtubeCallback(world, seller.cookie, search)).toBe('STATE_INVALID')
  })
})

// AC-L1-02 표·유일·토큰 칸 없음 (D-L1-02·D-L1-03·D-L1-04, SYS-02): 마이그레이션 하나로 더한 공급자 연결·state 표와 세션 만든 방법 칸.
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER } from '../src/db/database.ts'
import { startServer } from './support.ts'
import { addSeller, client } from './support.ts'
import { newSocialWorld, runFlow, type SocialWorld } from './l1-support.ts'

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})

const columns = async (pg: PGlite, table: string) =>
  (await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows.map((row) => row.column_name)

describe('AC-L1-02 표', () => {
  it('마이그레이션 하나(0014)로 새 표 둘과 세션 칸 하나를 더한다', () => {
    const files = readdirSync(MIGRATIONS_FOLDER).filter((file) => file.endsWith('.sql') && file.includes('l1'))
    expect(files).toEqual(['0014_l1_social_login.sql'])
    const sql = readFileSync(`${MIGRATIONS_FOLDER}/0014_l1_social_login.sql`, 'utf8')
    expect(sql).toContain('CREATE TABLE "login_links"')
    expect(sql).toContain('CREATE TABLE "login_states"')
    expect(sql).toContain(`ALTER TABLE "sessions" ADD COLUMN "method" text DEFAULT 'PASSWORD' NOT NULL`)
    // 기존 표의 칸을 바꾸거나 지우지 않는다
    expect(sql).not.toMatch(/DROP|ALTER COLUMN|RENAME/i)
  })

  it('칸: 연결 표·state 표·세션 — 토큰·인가 코드·이메일 원문·닉네임 원문 칸이 없다', async () => {
    const world = await newSocialWorld()
    worlds.push(world)
    const pg = world.database.pglite as PGlite
    expect(await columns(pg, 'login_links')).toEqual(['id', 'seller_id', 'account_id', 'provider', 'provider_user_id', 'label', 'linked_at', 'last_login_at'])
    expect(await columns(pg, 'login_states')).toEqual(['state_hash', 'browser_hash', 'provider', 'purpose', 'seller_id', 'account_id', 'session_hash', 'verifier_enc', 'created_at', 'expires_at', 'used_at', 'app_challenge'])
    expect(await columns(pg, 'sessions')).toEqual(['token_hash', 'seller_id', 'account_id', 'created_at', 'expires_at', 'extended_at', 'method'])
    // D-UX3-28: 앱 로그인 challenge(검증 값의 해시)·가입 표 (표는 해시, 공급자 계정 ID는 암호화 칸)
    // D-UX3-30: 가입 표에 확인한 번호(해시·가린 번호·확인 시각)와 그 번호의 기존 계정. 문자 인증 표는 인증번호·번호 모두 해시만 — 원문 칸이 없다
    expect(await columns(pg, 'login_tickets')).toEqual(['ticket_hash', 'kind', 'provider', 'app_challenge', 'seller_id', 'account_id', 'provider_user_enc', 'label', 'created_at', 'expires_at', 'used_at', 'phone_hash', 'phone_label', 'phone_verified_at', 'target_account_id'])
    expect(await columns(pg, 'phone_checks')).toEqual(['key', 'seller_id', 'phone_hash', 'phone_label', 'code_hash', 'code_expires_at', 'attempts', 'sends', 'sent_at', 'created_at'])
    expect(await columns(pg, 'phone_sends')).toEqual(['id', 'seller_id', 'phone_hash', 'sent_at'])
    for (const table of ['login_links', 'login_states', 'login_tickets', 'sessions', 'accounts', 'phone_checks', 'phone_sends']) {
      for (const name of await columns(pg, table)) expect(name, `${table}.${name}`).not.toMatch(/access|refresh|id_token|^code$|auth_code|email|nickname|^token$|^phone$|^phone_number$/)
    }
  })

  it('유일 제약: (공급자, 공급자 계정 ID) · (계정, 공급자) — 앱 검사를 거치지 않아도 DB가 막는다', async () => {
    const world = await newSocialWorld()
    worlds.push(world)
    const a = await addSeller(world)
    const b = await addSeller(world)
    const pg = world.database.pglite as PGlite
    const insert = (seller: string, account: string, provider: string, id: string) =>
      pg.query(`insert into login_links (seller_id, account_id, provider, provider_user_id, linked_at) values ($1, $2, $3, $4, now())`, [seller, account, provider, id]).then(
        () => 'ok',
        (error: { code?: string }) => error.code,
      )
    expect(await insert(a.sellerId, a.accountId, 'kakao', '111')).toBe('ok')
    expect(await insert(b.sellerId, b.accountId, 'kakao', '111')).toBe('23505')
    expect(await insert(a.sellerId, a.accountId, 'kakao', '222')).toBe('23505')
    expect(await insert(a.sellerId, a.accountId, 'naver', '111')).toBe('ok')
    const rows = await pg.query<{ conname: string; columns: string }>(`
      select c.conname, string_agg(a.attname, ',' order by k.ord) as columns from pg_constraint c
      join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'u' and c.conname like 'login_links_%' group by c.conname`)
    expect(Object.fromEntries(rows.rows.map((row) => [row.conname, row.columns]))).toEqual({
      login_links_provider_user_uq: 'provider,provider_user_id',
      login_links_account_provider_uq: 'account_id,provider',
    })
  })

  it('세션 만든 방법: 아이디 로그인 PASSWORD · 간편 로그인은 그 공급자 · 서버를 다시 켜도 연결이 그대로', async () => {
    const world = await newSocialWorld()
    worlds.push(world)
    const a = await addSeller(world)
    const pg = world.database.pglite as PGlite
    expect((await pg.query<{ method: string }>(`select method from sessions`)).rows.map((row) => row.method)).toEqual(['PASSWORD'])
    const user = world.fake.addUser('naver', { email: 'seller@naver.com' })
    expect((await runFlow(world, 'naver', user.id, { session: a.cookie })).result.login).toBe('LINKED')
    // 같은 DB로 서버를 새로 켠다
    const again = { ...startServer(world.database, world.masterKey, { socialLogin: world.fake.setup() }), fake: world.fake }
    const login = await runFlow(again, 'naver', user.id)
    expect(login.result.location).toBe('https://app.livejjim.test/')
    expect((await client(again, login.session).get('/api/me')).body.loginId).toBe(a.loginId)
    expect((await pg.query<{ method: string }>(`select method from sessions order by created_at`)).rows.map((row) => row.method).sort()).toEqual(['NAVER', 'PASSWORD'])
  })
})

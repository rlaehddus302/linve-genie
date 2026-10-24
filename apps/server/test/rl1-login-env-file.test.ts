// RL1 연습 모드의 실제 간편 로그인 파일(.env.login.local) 읽기: 운영과 같은 이름·같은 규칙, 값이 있는 공급자만 켬, 문장에 값이 나오지 않음.
// 그리고 연습 모드 스크립트가 --real-login에서 가짜 공급자를 섞지 않고 이 읽기를 쓰는지, 파일이 깃에 올라가지 않는지.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOGIN_ENV_FILE, LOGIN_ENV_NAMES, parseLoginEnvFile } from '../src/social/login-env-file.ts'
import { SOCIAL_ENV, checkSocialSetup } from '../src/social/providers.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SECRET = 'S3cr3t-value-must-not-leak'

const failMessage = (text: string): string => {
  const result = parseLoginEnvFile(text)
  if (result.ok) throw new Error('실패여야 한다')
  return result.message
}

describe('RL1 .env.login.local 읽기', () => {
  it('이름은 운영 환경 변수(SOCIAL_ENV)와 같은 여섯 개다', () => {
    expect(LOGIN_ENV_FILE).toBe('.env.login.local')
    expect([...LOGIN_ENV_NAMES].sort()).toEqual(
      [
        'LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID',
        'LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET',
        'LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET',
        'LIVEJJIM_LOGIN_KAKAO_REST_API_KEY',
        'LIVEJJIM_LOGIN_NAVER_CLIENT_ID',
        'LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET',
      ].sort(),
    )
    expect(LOGIN_ENV_NAMES).toContain(SOCIAL_ENV.kakao.id)
  })

  it('빈 파일·주석뿐이면 모두 꺼진다', () => {
    expect(parseLoginEnvFile('')).toEqual({ ok: true, providers: {} })
    expect(parseLoginEnvFile('# 메모\n\n   \n# LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=abc\n')).toEqual({ ok: true, providers: {} })
  })

  it('값이 있는 공급자만 켜진다 — 카카오만', () => {
    expect(parseLoginEnvFile('LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=abc123\n')).toEqual({ ok: true, providers: { kakao: { clientId: 'abc123', clientSecret: null } } })
  })

  it('셋 다·따옴표·export·CRLF·BOM·앞뒤 빈칸을 받는다', () => {
    const text = [
      '\uFEFF# 연습용',
      'export LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID = "1234-abc.apps.googleusercontent.com"',
      "LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET='GOCSPX-xyz'",
      '  LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=k1  ',
      'LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET=k2',
      'LIVEJJIM_LOGIN_NAVER_CLIENT_ID=n1',
      'LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET=n2=',
    ].join('\r\n')
    const result = parseLoginEnvFile(text)
    expect(result).toEqual({
      ok: true,
      providers: {
        google: { clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-xyz' },
        kakao: { clientId: 'k1', clientSecret: 'k2' },
        naver: { clientId: 'n1', clientSecret: 'n2=' },
      },
    })
    // 연습 모드 설정 모양 그대로 서버 설정 확인을 통과한다 (실제 https 고정 주소, allowInsecure 없음)
    if (result.ok) expect(checkSocialSetup({ providers: result.providers })).toBeNull()
  })

  it('형식 오류는 줄 번호로 알리고 값은 문장에 넣지 않는다', () => {
    const noEquals = failMessage(`# 메모\n${SECRET}\n`)
    expect(noEquals).toBe('.env.login.local 2번째 줄의 모양이 이상해요. 한 줄에 "이름=값"으로 적어 주세요.')
    expect(failMessage(`=${SECRET}`)).not.toContain(SECRET)
    // 이름 자리에 값을 붙여 넣었으면 이름도 보이지 않는다
    const pastedName = failMessage(`${SECRET}=x`)
    expect(pastedName).not.toContain(SECRET)
    expect(pastedName).toContain('1번째 줄의 이름을 모르겠어요')
    // 이름처럼 생긴 오타는 이름만 보인다
    const typo = failMessage(`LIVEJJIM_LOGIN_KAKAO_REST_KEY=${SECRET}`)
    expect(typo).toContain('(LIVEJJIM_LOGIN_KAKAO_REST_KEY)을 모르겠어요')
    expect(typo).not.toContain(SECRET)
    // 유튜브 연결 이름(다른 파일)을 여기에 적어도 멈춘다
    expect(failMessage(`LIVEJJIM_GOOGLE_CLIENT_ID=${SECRET}`)).toContain('(LIVEJJIM_GOOGLE_CLIENT_ID)')
  })

  it('빈 값·예시 글·두 번 적기는 쉬운 문장으로 멈춘다', () => {
    expect(failMessage('LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=\n')).toBe('.env.login.local 1번째 줄(LIVEJJIM_LOGIN_KAKAO_REST_API_KEY)의 값이 비어 있어요. 값을 적거나 그 줄을 지워 주세요.')
    expect(failMessage('LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=""')).toContain('값이 비어 있어요')
    expect(failMessage('LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=받은 REST API 키')).toContain('값에 한글·빈칸이 있어요')
    expect(failMessage(`LIVEJJIM_LOGIN_NAVER_CLIENT_ID=${SECRET} x`)).not.toContain(SECRET)
    expect(failMessage(`LIVEJJIM_LOGIN_KAKAO_REST_API_KEY=a\nLIVEJJIM_LOGIN_KAKAO_REST_API_KEY=${SECRET}`)).toBe('.env.login.local에 LIVEJJIM_LOGIN_KAKAO_REST_API_KEY이 두 번 적혀 있어요. 한 줄만 남겨 주세요.')
  })

  it('반만 적으면 운영과 같은 문장으로 멈춘다 (구글·네이버 둘 다, 카카오는 키 필수)', () => {
    expect(failMessage(`LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID=${SECRET}`)).toBe('.env.login.local: 구글 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요.')
    expect(failMessage(`LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET=${SECRET}`)).toContain('네이버 로그인 설정이 반만')
    expect(failMessage(`LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET=${SECRET}`)).toContain('카카오 로그인 설정이 반만')
  })
})

describe('RL1 연습 모드 스크립트·깃', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'try', 'try.mjs'), 'utf8')

  it('--real-login은 이 읽기를 쓰고, 가짜 공급자 대신 실제 고정 주소로 켠다', () => {
    expect(script).toContain("'--real-login'")
    expect(script).toContain('parseLoginEnvFile(')
    expect(script).toContain('socialLogin: realLogin === null ? oauth.setup(')
    expect(script).toContain(': { providers: realLogin }')
  })

  it('.env.login.local은 깃에 올라가지 않는다', () => {
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '-v', LOGIN_ENV_FILE], { cwd: ROOT, encoding: 'utf8' })
    expect(ignored).toContain('.gitignore')
  })
})

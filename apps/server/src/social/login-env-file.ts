// 연습 모드의 실제 간편 로그인 파일 읽기 (RL1): 저장소 맨 위 `.env.login.local`(깃에 올리지 않는 파일)의 글을 읽어
// 운영과 같은 환경 변수 이름(SOCIAL_ENV)·같은 규칙(readSocialLoginEnv — 반만 적으면 멈춤)으로 공급자 설정을 만든다.
// - 값이 있는 공급자만 켜고, 없는 공급자는 끈다(가짜를 섞지 않는다). 공급자 주소는 운영과 같은 고정 주소다(주소 바꾸기 없음).
// - 형식: 한 줄에 `이름=값`. 빈 줄·`#` 줄은 건너뛴다. 맨 앞 `export `, 값 양끝의 같은 따옴표 한 쌍은 허용한다.
// - 문제가 있으면 쉬운 문장을 돌려준다. 문장에는 줄 번호와 (아는 모양의) 이름만 넣고 값은 절대 넣지 않는다.
import { SOCIAL_ENV, readSocialLoginEnv, type SocialProviders } from './providers.ts'

export const LOGIN_ENV_FILE = '.env.login.local'

/** 이 파일에 적을 수 있는 이름 (운영 환경 변수와 같다) */
export const LOGIN_ENV_NAMES: readonly string[] = Object.freeze((['kakao', 'naver', 'google'] as const).flatMap((provider) => [SOCIAL_ENV[provider].id, SOCIAL_ENV[provider].secret]))

export type LoginEnvFileResult = { readonly ok: true; readonly providers: SocialProviders } | { readonly ok: false; readonly message: string }

/** 이름처럼 생긴 글자만 문장에 보인다 (값을 이름 자리에 붙여 넣었을 때 그대로 보이지 않게) */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/

function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) return value.slice(1, -1).trim()
  return value
}

export function parseLoginEnvFile(text: string): LoginEnvFileResult {
  const values: Record<string, string> = {}
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const lineNo = String(index + 1)
    let line = (lines[index] as string).trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()
    const at = line.indexOf('=')
    if (at <= 0) return { ok: false, message: `${LOGIN_ENV_FILE} ${lineNo}번째 줄의 모양이 이상해요. 한 줄에 "이름=값"으로 적어 주세요.` }
    const name = line.slice(0, at).trim()
    if (!LOGIN_ENV_NAMES.includes(name)) {
      const shown = ENV_NAME_RE.test(name) ? `(${name})` : ''
      return { ok: false, message: `${LOGIN_ENV_FILE} ${lineNo}번째 줄의 이름${shown}을 모르겠어요. docs/TRY-IT.md "실제 간편 로그인으로 시험하기"의 이름을 글자 그대로 적어 주세요.` }
    }
    if (Object.hasOwn(values, name)) return { ok: false, message: `${LOGIN_ENV_FILE}에 ${name}이 두 번 적혀 있어요. 한 줄만 남겨 주세요.` }
    const value = unquote(line.slice(at + 1).trim())
    if (value === '') return { ok: false, message: `${LOGIN_ENV_FILE} ${lineNo}번째 줄(${name})의 값이 비어 있어요. 값을 적거나 그 줄을 지워 주세요.` }
    // 예시 글("받은 REST API 키")을 그대로 두었거나 값 중간에 빈칸이 있으면 — 공급자가 주는 값은 영문·숫자·기호뿐이다
    if (!/^[\x21-\x7e]+$/.test(value)) return { ok: false, message: `${LOGIN_ENV_FILE} ${lineNo}번째 줄(${name})의 값에 한글·빈칸이 있어요. 예시 글 대신 받은 값을 그대로 붙여 넣어 주세요.` }
    values[name] = value
  }
  const read = readSocialLoginEnv(values)
  if (!read.ok) return { ok: false, message: `${LOGIN_ENV_FILE}: ${read.message}` }
  return { ok: true, providers: read.providers }
}


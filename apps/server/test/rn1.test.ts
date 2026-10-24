// AC-RN1-07 바꾸지 않는 값 · AC-RN1-09 이름 상수 한 곳 · AC-RN1-10 보이는 소스에 옛 이름 0개 · AC-RN1-11·12 연습 모드·사용자 문서 (UX-01, D-RN1-02·03·07)
// 서버 영역의 "보이는 소스": apps/server/src, scripts/try, 문서 DEPLOY·TRY-IT·OWNER-GUIDE·SETUP-GUIDE(주석이 없어 글 전체).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '../src/auth.ts'
import { BACKUP_FORMAT } from '../src/backup.ts'
import { SERVICE_FILE_PREFIX, SERVICE_NAME } from '../src/brand.ts'
import { BACKUP_NAME_RE } from '../src/db-backup.ts'
import { STATE_COOKIE } from '../src/social/service.ts'

const OLD_NAME = '라이브' + '찜'
const REPO = new URL('../../../', import.meta.url)
const SRC = new URL('apps/server/src/', REPO)
const TRY = new URL('scripts/try/', REPO)
const USER_DOCS = ['docs/DEPLOY.md', 'docs/TRY-IT.md', 'docs/OWNER-GUIDE.md', 'docs/SETUP-GUIDE.md']

/** 줄 주석·블록 주석·HTML 주석·SQL 주석(줄 맨 앞 --)을 지운 글. 문자열·템플릿 안의 // 는 지우지 않는다 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if ((ch === '/' && next === '/') || (ch === '-' && next === '-' && (i === 0 || /\n\s*$/.test(source.slice(Math.max(0, i - 40), i))))) {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== ch && !(ch !== '`' && source[j] === '\n')) j += source[j] === '\\' ? 2 : 1
      out += source.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

const countOutsideComments = (source: string, word: string): number => stripComments(source).split(word).length - 1
const countAll = (text: string, word: string): number => text.split(word).length - 1

function files(dir: URL, base: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir)
    if (entry.isDirectory()) out.push(...files(url, `${base}${entry.name}/`))
    else if (/\.(ts|mjs|js|html|sql|json)$/.test(entry.name)) out.push({ file: `${base}${entry.name}`, text: readFileSync(url, 'utf8') })
  }
  return out
}

const serverSources = files(SRC, 'apps/server/src/')
const trySources = files(TRY, 'scripts/try/')
const read = (path: string): string => readFileSync(new URL(path, REPO), 'utf8')

describe('AC-RN1-09 서버 이름 상수', () => {
  it('SERVICE_NAME = 라이브지니, 대체 파일 이름 앞부분 = livegenie', () => {
    expect(SERVICE_NAME).toBe('라이브지니')
    expect(SERVICE_FILE_PREFIX).toBe('livegenie')
  })

  it('apps/server/src에서 이름 글자는 상수 파일 한 곳에만 있다', () => {
    const holders = serverSources.filter((f) => countOutsideComments(f.text, SERVICE_NAME) > 0).map((f) => f.file)
    expect(holders).toEqual(['apps/server/src/brand.ts'])
    expect(countOutsideComments(read('apps/server/src/brand.ts'), SERVICE_NAME)).toBe(1)
  })

  it('고정 파일(연습 모드 안내)의 이름이 상수와 같다 (AC-RN1-11)', () => {
    const tryScript = read('scripts/try/try.mjs')
    expect(tryScript).toContain(`say('${SERVICE_NAME} 연습 모드를 준비하고 있어요. 처음에는 1~2분 걸려요...')`)
    expect(tryScript).toContain(`say(' ${SERVICE_NAME} 연습 모드가 켜졌어요. (끄려면 이 창에서 Ctrl + C)')`) // RL1: 윈도우에서도 같은 글자(Ctrl + C)로 안내
    const chat = read('scripts/try/chat.html')
    expect(chat).toContain(`${SERVICE_NAME} 방송 화면에서 유튜브 "연습 라이브"를 이어 둔 뒤에 쓰세요.`)
    expect(chat).toContain(`보냈어요. ${SERVICE_NAME} 방송 화면에 몇 초 안에 나타나요.`)
  })
})

describe('AC-RN1-10 서버의 보이는 소스에 옛 이름 0개', () => {
  it('apps/server/src·scripts/try는 주석 밖 0개', () => {
    expect(serverSources.length).toBeGreaterThan(100)
    expect(trySources.length).toBeGreaterThan(0)
    const found = [...serverSources, ...trySources].map((f) => ({ file: f.file, count: countOutsideComments(f.text, OLD_NAME) })).filter((f) => f.count > 0)
    expect(found).toEqual([])
  })

  it('사용자 문서 4개는 글 전체에서 0개 (AC-RN1-12)', () => {
    expect(USER_DOCS.map((doc) => ({ doc, count: countAll(read(doc), OLD_NAME) })).filter((d) => d.count > 0)).toEqual([])
  })

  it('검사가 실제로 잡는다: 문장·HTML 글에 넣으면 세고, 주석에만 있으면 세지 않는다', () => {
    expect(countOutsideComments(`const a = '${OLD_NAME} 백업'`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`say('${OLD_NAME} 연습 모드') // ${OLD_NAME}`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`<p>${OLD_NAME} 방송 화면</p><!-- ${OLD_NAME} -->`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`const url = 'https://x.y/${OLD_NAME}'`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`const n = a -- b + '${OLD_NAME}'`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`// ${OLD_NAME}\n/* ${OLD_NAME} */\n-- ${OLD_NAME}\n  -- ${OLD_NAME}\nselect 1`, OLD_NAME)).toBe(0)
    expect(countAll(`# ${OLD_NAME} 안내`, OLD_NAME)).toBe(1)
  })
})

describe('AC-RN1-07 바꾸지 않는 값 (D-RN1-02)', () => {
  it('쿠키 이름·백업 형식 이름·운영 DB 백업 파일 이름 규칙이 그대로다', () => {
    expect(SESSION_COOKIE).toBe('lj_session')
    expect(STATE_COOKIE).toBe('__Host-lj_oauth')
    expect(BACKUP_FORMAT).toBe('livejjim-seller-backup')
    expect(BACKUP_NAME_RE.test('livejjim-20261023-120000.dump')).toBe(true)
    expect(BACKUP_NAME_RE.test('livegenie-20261023-120000.dump')).toBe(false)
  })

  it('암호화 문맥 문자열이 소스에 그대로 있다', () => {
    const text = (file: string): string => read(`apps/server/src/${file}`)
    expect(text('secrets.ts')).toContain("'livejjim/seller-phone-key/v1/'")
    expect(text('secrets.ts')).toContain('`livejjim/${purpose}/v1/${sellerId}`')
    expect(text('secrets.ts')).toContain("'livejjim/login-limit-key/v1'")
    expect(text('receipt-links.ts')).toContain("'livejjim/receipt-link-key/v1'")
    expect(text('receipt-links.ts')).toContain('`livejjim/receipt-link/v1/${sellerId}/${linkId}`')
    expect(text('deposit/account-seal.ts')).toContain("'livejjim/deposit-account/v1/'")
    expect(text('deposit/account-seal.ts')).toContain("'livejjim/popbill-corp-key/v1'")
    expect(text('youtube/connect.ts')).toContain('`livejjim/youtube-token/v1/${sellerId}/${kind}`')
    expect(text('youtube/connect.ts')).toContain('`livejjim/youtube-verifier/v1/${sellerId}/${stateHash}`')
    expect(text('social/service.ts')).toContain('`livejjim/login-verifier/v1/${provider}/${stateHash}`')
  })

  it('새 마이그레이션이 없다 — 이름 변경은 DB를 바꾸지 않는다', () => {
    const migrations = readdirSync(new URL('apps/server/drizzle/', REPO)).filter((name) => name.endsWith('.sql'))
    expect(migrations.filter((name) => /rn1|genie/i.test(name))).toEqual([])
  })
})

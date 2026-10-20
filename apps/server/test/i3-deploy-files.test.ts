// AC-I3-73·74·83 배포 파일 검사 (SYS-05, D-I3-13·16): 시험 환경엔 도커가 없다 — Dockerfile·.dockerignore·.env.example·docs/DEPLOY.md를 파일로 확인한다.
// 환경변수는 서버 코드에서 이름을 모아 두 파일과 맞대고, 문서의 명령 이름은 패키지 스크립트와, 경보 코드 표는 서버의 경보 코드 목록과 맞댄다.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALERT_CODES } from '../src/ops.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SERVER_SRC = fileURLToPath(new URL('../src', import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** 서버 코드가 읽는 환경변수 (PORT·DATABASE_URL·LIVEJJIM_*) — E2E 기동 전용 파일은 뺀다 */
function codeEnvNames(): Set<string> {
  const names = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (path.endsWith('.ts')) {
        const rel = relative(SERVER_SRC, path)
        if (rel === 'e2e.ts' || rel === join('commands', 'e2e-server.ts')) continue
        for (const match of readFileSync(path, 'utf8').matchAll(/['"](PORT|DATABASE_URL|LIVEJJIM_[A-Z0-9_]+)['"]/g)) names.add(match[1] as string)
      }
    }
  }
  walk(SERVER_SRC)
  return names
}

describe('AC-I3-73 컨테이너 이미지 (파일 검사 — 실제 빌드는 배포 때 사용자 확인)', () => {
  const dockerfile = read('Dockerfile')
  const lines = dockerfile.split('\n').map((line) => line.trim())

  it('여러 단계(빌드 → 실행), Node 24 고정 버전 태그, frozen-lockfile 설치, 화면 운영 빌드를 실행 이미지에, root가 아닌 USER, EXPOSE 3000, HEALTHCHECK /health, 서버 운영 시작', () => {
    const froms = lines.filter((line) => line.startsWith('FROM '))
    expect(froms.length).toBeGreaterThanOrEqual(2)
    const stages = new Set<string>()
    for (const from of froms) {
      const match = /^FROM (\S+)(?: AS (\S+))?$/.exec(from)
      expect(match, from).not.toBeNull()
      const image = match?.[1] ?? ''
      if (!stages.has(image)) expect(image, from).toMatch(/^node:24\.\d+\.\d+-[a-z0-9-]+$/)
      if (match?.[2] !== undefined) stages.add(match[2])
    }
    expect(dockerfile).not.toMatch(/node:(latest|lts|24)(\s|-|$)/)
    expect(dockerfile).toContain('pnpm install --frozen-lockfile')
    expect(dockerfile).toContain('pnpm --filter @livejjim/web build')
    expect(dockerfile).toMatch(/COPY --from=\S+ \/app\/apps\/web\/dist apps\/web\/dist/)
    expect(dockerfile).toContain('LIVEJJIM_WEB_DIR=/app/apps/web/dist')
    const users = lines.filter((line) => line.startsWith('USER '))
    expect(users.length).toBeGreaterThan(0)
    expect(users.at(-1)).not.toMatch(/^USER (root|0)$/)
    expect(lines).toContain('EXPOSE 3000')
    expect(dockerfile).toMatch(/HEALTHCHECK [\s\S]*\/health/)
    expect(lines.filter((line) => line !== '').at(-1)).toBe('CMD ["node", "apps/server/src/main.ts"]')
    // 백업 명령의 pg_dump
    expect(dockerfile).toContain('postgresql-client')
  })

  it('ENV·ARG에 비밀값(마스터 키·DB 주소·구글 비밀·운영 토큰)이 없다', () => {
    const settings = dockerfile.replace(/\\\n/g, ' ').split('\n').filter((line) => /^\s*(ENV|ARG)\s/.test(line)).join('\n')
    for (const secret of ['LIVEJJIM_MASTER_KEY', 'DATABASE_URL', 'LIVEJJIM_GOOGLE_CLIENT_SECRET', 'LIVEJJIM_OPS_TOKEN', 'LIVEJJIM_GOOGLE_CLIENT_ID', 'PASSWORD', 'SECRET', 'TOKEN']) expect(settings, secret).not.toContain(secret)
  })

  it('.dockerignore가 .env*(.env.example 제외)·.git·node_modules·test-results·tests·harness·.claude를 뺀다', () => {
    const ignore = read('.dockerignore').split('\n').map((line) => line.trim())
    for (const entry of ['.env', '.env.*', '!.env.example', '.git', 'test-results', 'tests', 'harness', '.claude']) expect(ignore, entry).toContain(entry)
    expect(ignore.some((line) => line === 'node_modules' || line === '**/node_modules')).toBe(true)
  })
})

describe('AC-I3-74 환경변수·배포 절차 문서', () => {
  const names = codeEnvNames()

  it('서버 코드가 읽는 환경변수가 .env.example에 빠짐없이 있고, 코드가 읽지 않는 변수는 없다 — 값은 비어 있다', () => {
    expect(names.size).toBeGreaterThanOrEqual(20)
    const example = read('.env.example')
    const keys = example
      .split('\n')
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map((line) => line.split('=')[0] as string)
    expect(new Set(keys)).toEqual(names)
    for (const line of example.split('\n').filter((item) => /^[A-Z_][A-Z0-9_]*=/.test(item))) expect(line, line).toMatch(/^[A-Z0-9_]+=$/)
  })

  it('docs/DEPLOY.md에 그 환경변수가 모두 있고, 코드가 읽지 않는 LIVEJJIM_ 변수는 없다', () => {
    const doc = read('docs/DEPLOY.md')
    for (const name of names) expect(doc, name).toContain(`\`${name}\``)
    const mentioned = new Set([...doc.matchAll(/\bLIVEJJIM_[A-Z0-9_]+\b/g)].map((match) => match[0]))
    for (const name of mentioned) expect(names.has(name), name).toBe(true)
  })

  it('문서의 명령 이름은 저장소의 실제 스크립트·명령 파일과 같다', () => {
    const doc = read('docs/DEPLOY.md')
    const scripts = Object.keys((JSON.parse(read('apps/server/package.json')) as { scripts: Record<string, string> }).scripts)
    const pnpm = [...doc.matchAll(/pnpm --filter @livejjim\/server ([a-z][a-z-]*)/g)].map((match) => match[1] as string)
    expect(new Set(pnpm)).toEqual(new Set(['migrate', 'create-account', 'start', 'backup', 'check-replay']))
    for (const name of pnpm) expect(scripts, name).toContain(name)
    const node = [...doc.matchAll(/node apps\/server\/src\/commands\/([a-z][a-z-]*)\.ts/g)].map((match) => match[1] as string)
    expect(node.length).toBeGreaterThan(0)
    for (const name of node) expect(existsSync(join(ROOT, 'apps/server/src/commands', `${name}.ts`)), name).toBe(true)
    expect(doc).toContain('node apps/server/src/main.ts')
  })

  it('필요한 절차가 다 있다: 처음 배포·새 버전·구글 OAuth(돌아오는 주소·권한 둘·방침·약관 주소)·할당량·운영 토큰·프록시·백업 일정·복구·마스터 키', () => {
    const doc = read('docs/DEPLOY.md')
    for (const text of [
      '/api/youtube/oauth/callback',
      'youtube.readonly',
      'youtube.force-ssl',
      '<앱 주소>/privacy',
      '<앱 주소>/terms',
      '표준 입력',
      '/health/ready',
      '04:00(KST)',
      'pg_restore',
      'check-replay',
      '백업과 다른 곳',
      'D-012',
      'D-019',
      'LIVEJJIM_TRUSTED_PROXIES',
      '마이그레이션을 한 번만 먼저',
    ]) {
      expect(doc, text).toContain(text)
    }
  })
})

describe('AC-I3-83 운영 모니터링 문서', () => {
  it('경보 코드 표는 서버의 경보 코드 목록과 같다', () => {
    const doc = read('docs/DEPLOY.md')
    const section = doc.slice(doc.indexOf('### 경보 기록'), doc.indexOf('### 로그에 남기지 않는 것'))
    const codes = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1] as string)
    expect([...codes].sort()).toEqual([...ALERT_CODES].sort())
    expect(doc).toContain('/ops/status')
    expect(doc).toContain('"level":"alert"')
  })
})

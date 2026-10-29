import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureWorkerToken } from '../src/try/worker-token.ts'

const folders: string[] = []
afterEach(() => { for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }) })
const folder = () => { const path = mkdtempSync(join(tmpdir(), 'livejjim-app1-')); folders.push(path); return path }
describe('APP1 연습 일꾼 토큰 파일', () => {
  it('무작위 비밀값을 0600으로 만들고 다시 켜도 같은 파일을 쓴다', () => {
    const path = join(folder(), 'private', 'worker-token')
    const token = ensureWorkerToken(path)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(readFileSync(path, 'utf8')).toBe(`${token}\n`)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(ensureWorkerToken(path)).toBe(token)
  })
  it('다른 파일로 향하는 링크와 손상된 비밀 파일은 값 없이 거절한다', () => {
    const dir = folder(), target = join(dir, 'target'), link = join(dir, 'link')
    writeFileSync(target, 'bad-secret-marker')
    symlinkSync(target, link)
    expect(() => ensureWorkerToken(link)).toThrow('받아쓰기 연결 파일을 확인해 주세요.')
    expect(() => ensureWorkerToken(target)).toThrow('받아쓰기 연결 파일을 확인해 주세요.')
  })
})

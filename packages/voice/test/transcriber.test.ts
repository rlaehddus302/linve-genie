// 받아쓰기 일꾼(파이썬) 단위 시험을 게이트에 넣는다 (D-APP1-02, AC-APP1-01~06·53).
// 일꾼의 자르기·틀 묶기/풀기·설정·흐름 한도·로그에 남는 것은 표준 라이브러리만 쓰므로 모델·silero·websockets 없이 돈다.
// 파이썬 3.9 이상이 필요하다(맥 기본 /usr/bin/python3). 다른 것을 쓰려면 환경변수 LIVEJJIM_PYTHON.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TRANSCRIBER = join(dirname(fileURLToPath(import.meta.url)), '..', 'transcriber')
const PYTHON = process.env.LIVEJJIM_PYTHON ?? 'python3'

describe('받아쓰기 일꾼 파이썬 시험 (python3 -m unittest)', () => {
  it('모든 파이썬 단위 시험이 통과하고 바이트코드 파일을 남기지 않는다', () => {
    const run = spawnSync(PYTHON, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-t', 'tests'], {
      cwd: TRANSCRIBER,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' },
    })
    expect(run.error, `${PYTHON}을 실행하지 못했다 — 파이썬 3.9 이상이 필요하다`).toBeUndefined()
    const output = `${run.stdout}\n${run.stderr}`
    expect(run.status, output).toBe(0)
    const ran = /Ran (\d+) tests?/.exec(output)
    expect(ran, output).not.toBeNull()
    // 시험을 몰래 줄이지 않았는지: 지금 49개
    expect(Number(ran?.[1])).toBeGreaterThanOrEqual(49)
    expect(output).not.toMatch(/skipped|expected failures/)
    const caches = [TRANSCRIBER, join(TRANSCRIBER, 'tests'), join(TRANSCRIBER, 'livegenie_transcriber')].filter((folder) => readdirSync(folder).includes('__pycache__'))
    expect(caches).toEqual([])
  }, 200_000)
})

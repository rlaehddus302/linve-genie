// 연습 모드 전용: 받아쓰기 일꾼 비밀값은 로그·화면 대신 권한 0600 파일 하나로 전달한다.
import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
export function ensureWorkerToken(path: string): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(path, `${randomBytes(32).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('받아쓰기 연결 파일을 만들지 못했어요.', { cause: error })
  }
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('받아쓰기 연결 파일을 확인해 주세요.')
  chmodSync(path, 0o600)
  const value = readFileSync(path, 'utf8').trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('받아쓰기 연결 파일을 확인해 주세요.')
  return value
}

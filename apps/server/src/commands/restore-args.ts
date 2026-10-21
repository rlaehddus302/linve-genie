// 복구 명령 인자 읽기 (I2 AC-I2-62) — 명령 파일(restore.ts)과 시험이 함께 쓴다.

const USAGE = '사용법: restore --seller <판매자 ID> --file <백업 파일 경로> [--replace]'

/** `--seller 값 --file 값 [--replace]` (pnpm이 넘긴 맨 앞 `--`는 건너뛴다) */
export function parseRestoreArgs(argv: readonly string[]): { ok: true; seller: string; file: string; replace: boolean } | { ok: false; message: string } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  let seller: string | undefined
  let file: string | undefined
  let replace = false
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (name === '--replace') {
      replace = true
      continue
    }
    if (name !== '--seller' && name !== '--file') return { ok: false, message: `모르는 인자예요. ${USAGE}` }
    const value = args[i + 1]
    if (value === undefined || value.startsWith('--')) return { ok: false, message: `${name} 뒤에 값을 적어 주세요. ${USAGE}` }
    if (name === '--seller') seller = value
    else file = value
    i++
  }
  if (seller === undefined || file === undefined) return { ok: false, message: USAGE }
  return { ok: true, seller, file, replace }
}

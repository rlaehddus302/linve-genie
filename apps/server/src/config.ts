// 서버 설정 (AC-S00-07, AC-S00-42). S00에서 읽는 환경변수는 PORT 하나다.
// 오류 메시지에 환경변수 값을 넣지 않는다(기동 로그에 값을 찍지 않는다).

export const DEFAULT_PORT = 3000

export type PortSetting =
  | { readonly ok: true; readonly port: number; readonly fromEnv: boolean }
  | { readonly ok: false; readonly message: string }

/** PORT가 없거나 빈 문자열이면 기본값. 있으면 1~65535 사이의 10진 정수여야 한다. */
export function readPort(env: Readonly<Record<string, string | undefined>>): PortSetting {
  const raw = env['PORT']
  if (raw === undefined || raw === '') return { ok: true, port: DEFAULT_PORT, fromEnv: false }
  const port = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'PORT는 1부터 65535 사이의 정수여야 해요.' }
  }
  return { ok: true, port, fromEnv: true }
}

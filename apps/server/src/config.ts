// 서버 설정 (AC-S00-07, AC-S00-42, AC-S04-20). 환경변수: PORT, DATABASE_URL 또는 LIVEJJIM_PGLITE_DIR, LIVEJJIM_MASTER_KEY, LIVEJJIM_APP_ORIGIN, LIVEJJIM_BACKUP_DIR(I2).
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

// ── S04: DB·마스터 키·앱 주소 (AC-S04-20·32·41) ─────────────────────────────

export type DatabaseSetting =
  | { readonly ok: true; readonly kind: 'postgres'; readonly url: string }
  | { readonly ok: true; readonly kind: 'pglite'; readonly dir: string }
  | { readonly ok: false; readonly message: string }

/**
 * DB 연결 설정. 운영은 DATABASE_URL(PostgreSQL)이 필수다. 개발용 파일 PGlite는 LIVEJJIM_PGLITE_DIR로 명시적으로 고를 때만 쓴다.
 * 둘 다 없으면 시작하지 않는다 — 메모리 DB로 조용히 바꾸지 않는다(재시작하면 판매 기록이 사라진다). 값은 문장에 넣지 않는다.
 */
export function readDatabaseSetting(env: Readonly<Record<string, string | undefined>>): DatabaseSetting {
  const url = env['DATABASE_URL']?.trim() ?? ''
  const dir = env['LIVEJJIM_PGLITE_DIR']?.trim() ?? ''
  if (url !== '' && dir !== '') return { ok: false, message: 'DATABASE_URL과 LIVEJJIM_PGLITE_DIR 중 하나만 적어 주세요.' }
  if (url !== '') {
    if (!/^postgres(?:ql)?:\/\//.test(url)) return { ok: false, message: 'DATABASE_URL은 postgres://로 시작해야 해요.' }
    return { ok: true, kind: 'postgres', url }
  }
  if (dir !== '') return { ok: true, kind: 'pglite', dir }
  return {
    ok: false,
    message: '데이터베이스 연결 설정이 없어요. 운영은 DATABASE_URL을, 개발용 파일 데이터베이스는 LIVEJJIM_PGLITE_DIR을 적어 주세요.',
  }
}

export type OriginSetting = { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly message: string }

/** 화면 앱 주소 (상태를 바꾸는 요청의 Origin 검사). 경로 없는 http(s) 주소만 받는다 */
export function readAppOrigin(env: Readonly<Record<string, string | undefined>>): OriginSetting {
  const origin = env['LIVEJJIM_APP_ORIGIN']?.trim() ?? ''
  if (origin === '') return { ok: false, message: '화면 앱 주소(LIVEJJIM_APP_ORIGIN)가 없어요.' }
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) return { ok: false, message: '화면 앱 주소(LIVEJJIM_APP_ORIGIN)는 https://example.com 처럼 경로 없이 적어 주세요.' }
  return { ok: true, origin }
}

// ── I2: 백업 저장소 (D-I2-10) ───────────────────────────────────────────

/** 백업 폴더 (LIVEJJIM_BACKUP_DIR). 없으면 null — 자동 백업이 꺼진다(시작 경보, 판매는 그대로). 값은 출력하지 않는다 */
export function readBackupDir(env: Readonly<Record<string, string | undefined>>): string | null {
  const dir = env['LIVEJJIM_BACKUP_DIR']?.trim() ?? ''
  return dir === '' ? null : dir
}

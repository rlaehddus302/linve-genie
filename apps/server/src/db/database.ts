// 데이터베이스 열기와 마이그레이션 (AC-S04-20).
// - 운영: PostgreSQL (DATABASE_URL, postgres 드라이버). 실제 운영 연결은 배포(S12)에서 확인한다.
// - 시험·개발: PGlite(내장 Postgres). 시험은 메모리, 개발용 파일 PGlite는 명시적으로 고를 때만(LIVEJJIM_PGLITE_DIR) 쓴다.
// 두 경우 모두 같은 마이그레이션(apps/server/drizzle)을 적용한다.
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { schema } from './schema.ts'

/** 서버가 쓰는 DB (PGlite·PostgreSQL 공통 타입). 트랜잭션 안에서도 같은 타입으로 넘긴다 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** 연 DB와 닫기 */
export interface Database {
  readonly db: Db
  readonly kind: 'pglite' | 'postgres'
  /** PGlite일 때만 있다 (시험에서 데이터 폴더 덤프 등에 쓴다) */
  readonly pglite: PGlite | null
  close(): Promise<void>
}

/** 마이그레이션 폴더 (저장소 안 apps/server/drizzle) */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

export interface OpenOptions {
  /** 마이그레이션을 적용한다 (기본 true). 검사 명령처럼 읽기만 할 때는 false */
  readonly migrate?: boolean
}

/**
 * PGlite를 열고 마이그레이션을 적용한다. dataDir를 주지 않으면 메모리 DB다(시험용).
 * 이미 있는 PGlite(복제본 등)를 넘기면 그것을 쓴다.
 */
export async function openPglite(source?: string | PGlite, options: OpenOptions = {}): Promise<Database> {
  const pglite = source instanceof PGlite ? source : await PGlite.create(source === undefined ? {} : { dataDir: source })
  const db = drizzlePglite({ client: pglite, schema }) as unknown as Db
  if (options.migrate !== false) await migratePglite(db as unknown as Parameters<typeof migratePglite>[0], { migrationsFolder: MIGRATIONS_FOLDER })
  return {
    db,
    kind: 'pglite',
    pglite,
    close: () => closePglite(pglite),
  }
}

/**
 * PGlite를 닫는다. 진행 중인 쿼리가 끝난 뒤에 닫는다.
 * PGlite의 close()는 쿼리 잠금을 잡지 않는다. 그래서 다른 쿼리가 파싱·바인드·실행 단계 사이에 있을 때 닫으면,
 * 종료 메시지 뒤에 남은 단계가 닫힌 백엔드로 들어가 WASM 안에서 끝없이 돈다(이벤트 루프가 멈춰 시험 시간 제한도 듣지 않는다).
 * 닫기를 쿼리 잠금 안에서 하면 진행 중인 쿼리는 끝까지 가고, 뒤에 줄 선 쿼리는 "닫혔음" 오류로 끝난다.
 * 예: 서버 close() 직후 DB를 닫을 때 출력 알림(대기열 개수 조회)이 아직 도는 경우.
 */
export async function closePglite(pglite: PGlite): Promise<void> {
  if (pglite.closed) return
  await pglite.runExclusive(async () => {
    if (!pglite.closed) await pglite.close()
  })
}

/** PostgreSQL에 연결하고 마이그레이션을 적용한다. 연결 문자열은 출력하지 않는다 */
export async function openPostgres(url: string, options: OpenOptions = {}): Promise<Database> {
  const client = postgres(url, { max: 10, onnotice: () => {} })
  const db = drizzlePostgres({ client, schema }) as unknown as Db
  if (options.migrate !== false) await migratePostgres(db as unknown as Parameters<typeof migratePostgres>[0], { migrationsFolder: MIGRATIONS_FOLDER })
  return {
    db,
    kind: 'postgres',
    pglite: null,
    close: async () => {
      await client.end({ timeout: 5 })
    },
  }
}

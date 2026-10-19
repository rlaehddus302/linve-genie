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
    close: async () => {
      if (!pglite.closed) await pglite.close()
    },
  }
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

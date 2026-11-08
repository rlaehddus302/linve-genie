// 명령: 계정 만들기(AC-S04-40 — 비밀번호는 명령행 인자가 아니라 표준 입력), 마이그레이션(AC-S04-20),
// 서버 시작 거절(AC-S04-20·32 — DB 연결 설정·마스터 키가 없으면 쉬운 문장으로 시작하지 않고 값은 출력하지 않는다)
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { openPglite } from '../src/db/database.ts'
import { schema } from '../src/db/schema.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { createSellerAccount } from '../src/accounts.ts'
import { FAST_COST, login, startServer } from './support.ts'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const script = (name: string) => fileURLToPath(new URL(`../src/${name}`, import.meta.url))

function run(file: string, args: string[], env: Record<string, string>, stdin = ''): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [file, ...args], { env: { PATH: process.env.PATH ?? '', TZ: process.env.TZ ?? '', ...env }, timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, out: `${stdout}\n${stderr}` })
    })
    child.stdin?.end(stdin)
  })
}

describe('계정 만들기 명령 (AC-S04-40)', () => {
  it('비밀번호는 표준 입력으로 받고, 만든 계정으로 로그인할 수 있다. 출력에 비밀번호·키가 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-account-'))
    dirs.push(dir)
    const masterKey = generateMasterKey()
    const env = { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: masterKey }
    const created = await run(script('commands/create-account.ts'), ['--name', '다육 가게', '--login', 'cmdshop'], env, 'stdin-secret-77\n')
    expect(created.code, created.out).toBe(0)
    expect(created.out).toContain('계정을 만들었어요.')
    expect(created.out).not.toContain('stdin-secret-77')
    expect(created.out).not.toContain(masterKey)
    // 같은 아이디는 다시 만들 수 없다
    const again = await run(script('commands/create-account.ts'), ['--name', '다른 가게', '--login', 'cmdshop'], env, 'stdin-secret-88\n')
    expect(again.code).toBe(1)
    expect(again.out).toContain('이미 있는 아이디예요.')
    // 명령행으로 비밀번호를 받는 인자는 없다
    const viaArg = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'argshop', '--password', 'argv-secret-99'], env)
    expect(viaArg.code).toBe(1)
    expect(viaArg.out).not.toContain('argv-secret-99')
    const database = await openPglite(dir)
    try {
      const world = startServer(database, masterKey)
      expect(await login(world, 'cmdshop', 'stdin-secret-77')).toMatch(/^lj_session=/)
      const sellers = await database.pglite?.query<{ phone_key_enc: string }>(`select phone_key_enc from sellers`)
      expect(sellers?.rows).toHaveLength(1)
      expect(sellers?.rows[0]?.phone_key_enc).toMatch(/^v1\./)
    } finally {
      await database.close()
    }
  }, 120_000)

  it('마스터 키가 없거나 틀리면 만들지 않는다 (값은 출력하지 않는다)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-account-'))
    dirs.push(dir)
    const noKey = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'nokey'], { LIVEJJIM_PGLITE_DIR: dir }, 'secret-secret\n')
    expect(noKey.code).toBe(1)
    expect(noKey.out).toContain('마스터 키')
    const badKey = await run(script('commands/create-account.ts'), ['--name', 'x', '--login', 'badkey'], { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: 'c2hvcnQta2V5' }, 'secret-secret\n')
    expect(badKey.code).toBe(1)
    expect(badKey.out).not.toContain('c2hvcnQta2V5')
  }, 120_000)
})

describe('마이그레이션 명령 (AC-S04-20)', () => {
  it('설정한 DB에 마이그레이션을 적용하고, 설정이 없으면 쉬운 문장으로 실패한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-migrate-'))
    dirs.push(dir)
    const ok = await run(script('commands/migrate.ts'), [], { LIVEJJIM_PGLITE_DIR: dir })
    expect(ok.code, ok.out).toBe(0)
    expect(ok.out).toContain('마이그레이션을 적용했어요.')
    const database = await openPglite(dir, { migrate: false })
    const tables = await database.pglite?.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)
    await database.close()
    // 스키마의 테이블이 모두 생겼다 (판매자·계정·로그인 시도 수·세션·범위·방송·이벤트·발송함·스냅샷 + Y1: 채팅 원문·유튜브 연결·승인 요청·방송 잇기·수집기·우리 메시지·알림·할당량
    //   + I1 출력 기록: 대기열·라벨 키·작업·시도·라벨 템플릿·출력 요청 번호 + I2 포장 기록
    //   + N2: 인스타그램 연결·OAuth state·라이브 연결·라이브 옮긴 기록·이어지지 않은 댓글 수·라이브 요청 번호·DM 발송·DM 행 + N4a 라벨 기능 켬/끔 바꾼 기록
    //   + N5 요금: 이용권·회수·쓴 기록·이용 방식·결제 주문·사업자 정보·증빙 요청·요금 요청 번호
    //   + N3 입금 확인: 원천·입금·연결·처리 기록·기억한 입금자명·요청 번호·판매자에게 묶인 팝빌 사업자번호
    //   + N4b 구매자 확인서 공유 링크·그 요청 번호
    //   + N2b-2: 틱톡 연결·틱톡 동의 기록·틱톡 아이디·붙여넣기 요청 번호
    //   + L1 간편 로그인: 공급자 연결·간편 로그인 state
    //   — 합치기(N5 41 + N3 40, 공통 33)로 33 + 8 + 7 = 48, 통합(track/int-final)에서 N4b 2개·N2b-2 4개(틱톡 연결·동의 기록·아이디·붙여넣기 요청 번호)를 더해 54,
    //   L1에서 표 2개(login_links·login_states)를 더해 56으로 교체 — 약화 아님)
    //   + T1 택배: 배송지·접수 시도·택배 화면 요청 번호·설정 "택배" 4개를 더해 60으로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + A1 AI 제안: 표 3개(assist_settings·assist_cache·assist_calls)를 더해 63으로 교체 — 약화 아님(표 이름 목록 대조는 그대로)
    expect(tables?.rows.map((row) => row.table_name).sort()).toEqual(Object.values(schema).map((table) => getTableConfig(table).name).sort())
    //   + X1 크롬 확장: 연결 코드·토큰·회차 잇기·상태 4개와 감사 올리기 스위치·회차별 상태 2개를 더해 66에, A1 AI 제안 3개를 더해 69로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + BND1 밴드: 계정 연결·연결 시작 표·글 연결·본 댓글 표·알림 5개를 더해 74로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + CRM1 손님 기록: 설정 "손님 관리"·손님 메모 2개를 더해 71로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + CRM1 손님 기록 보관(D-CRM1-12): 날짜 줄·보관 행 2개를 더해 73으로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + 합치기(BND1 74 + CRM1 4개): 밴드 5개와 손님 기록 4개를 모두 세어 78로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + V3 판매자 품종 사전(seller_names) 1개를 더해 70으로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + V3 음성 등록·고침 기록(voice_log, 0021) 1개를 더해 71로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + V3 D-V3-68: 판매자 품종 사전(seller_names)을 0022로 지워 70으로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + V3 합치기(main 78 + V3 voice_log 1개, V3 마이그레이션은 0024~0026으로 다시 매김): 79로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    // APP1b의 계정 별칭 voice_aliases 1개를 더한다. 위의 전체 이름 대조도 유지한다.
    //   + KP1 손님 장부(D-KP1-01): 0031 표 6개(일정 페이지·일정 항목·알림 신청자·알림 동의 + 장부 설정·장부 줄 — 아래 0032 전까지)와 0032 표 4개를 더해 모두 10개
    //     (schedule_pages·schedule_items·alert_subscribers·alert_consents·ledger_settings·ledger_lines·ledger_markers·ledger_consents·ledger_codes·customer_exports)
    //     80에서 90으로 교체 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + SMS3 휴대폰 알림 받기: 받기 설정·받은 id·같은 문자 표지·문자 확인 카드·은행 알림 줄·잔액 기록 6개를 더해 더함 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   int/next 합치기: KP1 90 + SMS3 6 = 96 — 약화 아님
    //   + D-UX3-28 가입 표(login_tickets) 1개 + D-UX3-30 문자 인증(phone_checks·phone_sends) 2개 = 99 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + D-REAL-03·05 영수증 문자: 손님 번호(buyer_phones)·보낸 기록(receipt_sms_sends) 2개 = 101 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + D-REAL-11 방송 뒤 손님 정보 문자 카드(buyer_info_cards) 1개 = 102 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + D-V3-127 내 품종 장부(voice_varieties) 1개 = 103 — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    //   + main 합치기(D-EP1-21): 스키마 묶음에 빠져 있던 voice_varieties(0045)를 넣으니 실제 표 수가 104였다(위 103은 그 표를 빼고 셈) + EP1 우체국 창구소포 사전접수 기록(parcel_epost, D-EP1-02) 1개 = 105
    //     — 약화 아님(위 줄이 표 이름 목록 전부를 스키마와 대조한다)
    expect(tables?.rows).toHaveLength(105)
    const none = await run(script('commands/migrate.ts'), [], {})
    expect(none.code).toBe(1)
    expect(none.out).toContain('데이터베이스 연결 설정이 없어요')
  }, 120_000)
})

describe('서버 시작 거절 (AC-S04-20·32)', () => {
  it('DB 연결 설정·마스터 키·앱 주소가 없거나 틀리면 쉬운 문장으로 시작하지 않는다 — 값은 출력하지 않고 메모리 DB로 바꾸지 않는다', async () => {
    const key = generateMasterKey()
    const origin = 'https://app.livejjim.test'
    const cases: [Record<string, string>, RegExp, string[]][] = [
      [{ LIVEJJIM_APP_ORIGIN: origin }, /마스터 키\(LIVEJJIM_MASTER_KEY\)가 없어요/, []],
      [{ LIVEJJIM_MASTER_KEY: 'dG9vLXNob3J0', LIVEJJIM_APP_ORIGIN: origin }, /길이가 맞지 않아요/, ['dG9vLXNob3J0']],
      [{ LIVEJJIM_MASTER_KEY: key }, /앱 주소\(LIVEJJIM_APP_ORIGIN\)가 없어요/, [key]],
      [{ LIVEJJIM_MASTER_KEY: key, LIVEJJIM_APP_ORIGIN: origin }, /데이터베이스 연결 설정이 없어요/, [key]],
      [{ LIVEJJIM_MASTER_KEY: key, LIVEJJIM_APP_ORIGIN: origin, DATABASE_URL: 'mysql://admin:hunter2@db/prod' }, /postgres:\/\/로 시작해야 해요/, [key, 'hunter2']],
    ]
    for (const [env, message, secrets] of cases) {
      const result = await run(script('main.ts'), [], { PORT: '39999', ...env })
      expect(result.code, result.out).toBe(1)
      expect(result.out).toMatch(/시작하지 못했어요/)
      expect(result.out).toMatch(message)
      expect(result.out).not.toContain('시작했어요.')
      for (const secret of secrets) expect(result.out).not.toContain(secret)
    }
  }, 120_000)
})

describe('팝빌 사업자번호 묶기 명령 (RA-N3-001)', () => {
  it('운영자가 판매자에게 사업자번호를 묶고 푼다 — 판매자마다 하나, 번호마다 한 판매자. 출력에 사업자번호·키가 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejjim-corp-'))
    dirs.push(dir)
    const masterKey = generateMasterKey()
    const env = { LIVEJJIM_PGLITE_DIR: dir, LIVEJJIM_MASTER_KEY: masterKey }
    const setup = await openPglite(dir)
    try {
      for (const loginId of ['corpa', 'corpb']) expect((await createSellerAccount(setup.db, Buffer.from(masterKey, 'base64'), { shopName: loginId, loginId, password: 'correct-horse-1' }, { passwordCost: FAST_COST })).ok).toBe(true)
    } finally {
      await setup.close()
    }
    const corp = (args: string[]) => run(script('commands/popbill-corp.ts'), args, env)
    const outputs: string[] = []
    const bindA = await corp(['--login', 'corpa', '--corp', '123-45-67890'])
    outputs.push(bindA.out)
    expect(bindA.code, bindA.out).toBe(0)
    expect(bindA.out).toContain('사업자번호를 묶었어요.')
    const again = await corp(['--login', 'corpa', '--corp', '1234567890'])
    expect(again.out).toContain('이미 이 계정에 묶인 사업자번호예요.')
    const takenByA = await corp(['--login', 'corpb', '--corp', '1234567890'])
    outputs.push(takenByA.out)
    expect(takenByA.code).toBe(1)
    expect(takenByA.out).toContain('이 사업자번호는 다른 계정에 묶여 있어요.')
    const second = await corp(['--login', 'corpa', '--corp', '2222222222'])
    expect(second.code).toBe(1)
    expect(second.out).toContain('이 계정은 다른 사업자번호에 묶여 있어요.')
    expect((await corp(['--login', 'corpa', '--clear', 'yes'])).out).toContain('사업자번호 묶음을 풀었어요.')
    const bindB = await corp(['--login', 'corpb', '--corp', '1234567890'])
    expect(bindB.code, bindB.out).toBe(0)
    for (const bad of [['--login', 'corpa'], ['--login', 'corpa', '--corp', '12345'], ['--login', 'nobody', '--corp', '1234567890'], ['--login', 'corpa', '--corp', '1234567890', '--clear', 'yes']]) expect((await corp(bad)).code, bad.join(' ')).toBe(1)
    for (const out of outputs) {
      expect(out).not.toContain('1234567890')
      expect(out).not.toContain(masterKey)
    }
    const database = await openPglite(dir)
    try {
      const rows = await database.pglite?.query<{ seller_id: string; corp_key: string }>(`select b.seller_id, b.corp_key from deposit_corp_bindings b`)
      expect(rows?.rows).toHaveLength(1)
      expect(JSON.stringify(rows?.rows)).not.toContain('1234567890')
      const owner = await database.pglite?.query<{ login_id: string }>(`select a.login_id from deposit_corp_bindings b join accounts a on a.seller_id = b.seller_id`)
      expect(owner?.rows.map((row) => row.login_id)).toEqual(['corpb'])
    } finally {
      await database.close()
    }
  }, 120_000)
})

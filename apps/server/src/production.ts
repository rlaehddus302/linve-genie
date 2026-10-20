// 운영 서버 설정 조립 (AC-S04-20·32·41, I1 AC-I1-16). 운영 기동 명령(main.ts)은 이 함수로만 서버 옵션을 만든다.
// - 시험 모드 신호(testPrinter — 화면이 시험용 프린터를 켠다)는 어떤 환경변수·옵션으로도 켜지 않는다: 늘 false (L-11 15, D-I1-06).
//   시험용 프린터는 E2E 기동(e2e.ts startE2eServer)만 켠다.
// - 방송자 조치 대기 시간·리허설 생성기 속도도 운영 값 그대로다(E2E 기동만 바꾼다).
// - 입금 확인(N3): 시험 모드(가짜 원천·시험용 입금 넣기 경로)는 늘 끈다(D-N3-12). 받아 오기 주기는 원천의 1~5분 그대로다.
//   팝빌 연동 키(POPBILL_LINK_ID·POPBILL_SECRET_KEY, 선택 POPBILL_TEST_BED=true)가 둘 다 있을 때만 실제 팝빌 전송을 쓴다 — 없으면 계좌조회 원천을 만들 수 없다.
// - 오류 문장에 환경변수 값을 넣지 않는다.
import { readAppOrigin } from './config.ts'
import type { Database } from './db/database.ts'
import { readMasterKey } from './secrets.ts'
import { popbillHttpTransport, readPopbillKeys } from './deposit/popbill.ts'
import type { ServerOptions } from './server.ts'

export type ProductionOptions = { readonly ok: true; readonly options: ServerOptions } | { readonly ok: false; readonly message: string }

/** 환경변수(LIVEJJIM_MASTER_KEY·LIVEJJIM_APP_ORIGIN·POPBILL_LINK_ID·POPBILL_SECRET_KEY·POPBILL_TEST_BED)와 연 DB로 운영 서버 옵션을 만든다. 그 밖의 환경변수는 읽지 않는다 */
export function productionServerOptions(env: Readonly<Record<string, string | undefined>>, database: Pick<Database, 'db'>): ProductionOptions {
  const masterKey = readMasterKey(env['LIVEJJIM_MASTER_KEY'])
  if (!masterKey.ok) return { ok: false, message: masterKey.message }
  const origin = readAppOrigin(env)
  if (!origin.ok) return { ok: false, message: origin.message }
  const popbill = readPopbillKeys(env)
  return {
    ok: true,
    options: { database, masterKey: masterKey.key, appOrigin: origin.origin, testPrinter: false, deposits: { testMode: false, popbill: popbill === null ? null : popbillHttpTransport(popbill) } },
  }
}

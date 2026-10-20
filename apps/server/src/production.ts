// 운영 서버 설정 조립 (AC-S04-20·32·41, I1 AC-I1-16, N5 AC-N5-11·39·40). 운영 기동 명령(main.ts)은 이 함수로만 서버 옵션을 만든다.
// - 시험 모드 신호(testPrinter — 화면이 시험용 프린터를 켠다)는 어떤 환경변수·옵션으로도 켜지 않는다: 늘 false (L-11 15, D-I1-06).
//   시험용 프린터는 E2E 기동(e2e.ts startE2eServer)만 켠다.
// - 방송자 조치 대기 시간·리허설 생성기 속도도 운영 값 그대로다(E2E 기동만 바꾼다).
// - 요금(N5): LIVEJJIM_BILLING(on|off, 기본 off)·LIVEJJIM_BILLING_PRICES(요금 표 JSON 파일)·PORTONE_*(포트원 V2). 결제 어댑터는 포트원 V2,
//   증빙 발행기는 "없음"(팝빌 자리). 시험 결제(가짜 결제 서버·가짜 발행기·시험 경로)는 운영 구성에 없다.
//   켜져 있는데 요금 표가 자리 표시이거나 포트원 설정이 비어 있으면 기동하지 않는다.
// - 오류 문장에 환경변수 값을 넣지 않는다.
import { readBillingEnv } from './billing/config.ts'
import { noneIssuer } from './billing/documents.ts'
import { PortOneGateway } from './billing/portone.ts'
import type { BillingSetup } from './billing/service.ts'
import { readAppOrigin } from './config.ts'
import type { Database } from './db/database.ts'
import { readMasterKey } from './secrets.ts'
import type { ServerOptions } from './server.ts'

export type ProductionOptions = { readonly ok: true; readonly options: ServerOptions } | { readonly ok: false; readonly message: string }

/**
 * 환경변수(LIVEJJIM_MASTER_KEY·LIVEJJIM_APP_ORIGIN·요금 설정)와 연 DB로 운영 서버 옵션을 만든다. 그 밖의 환경변수는 읽지 않는다.
 * readFile은 요금 표 파일 읽기 (시험에서 바꿔 끼운다)
 */
export function productionServerOptions(
  env: Readonly<Record<string, string | undefined>>,
  database: Pick<Database, 'db'>,
  readFile?: (path: string) => string,
): ProductionOptions {
  const masterKey = readMasterKey(env['LIVEJJIM_MASTER_KEY'])
  if (!masterKey.ok) return { ok: false, message: masterKey.message }
  const origin = readAppOrigin(env)
  if (!origin.ok) return { ok: false, message: origin.message }
  const billingEnv = readBillingEnv(env, readFile)
  if (!billingEnv.ok) return { ok: false, message: billingEnv.message }
  const { enabled, prices, portone } = billingEnv.billing
  const billing: BillingSetup = {
    enabled,
    prices,
    storeId: portone.storeId,
    gateway: new PortOneGateway({ storeId: portone.storeId, apiSecret: portone.apiSecret }),
    issuer: noneIssuer,
    webhookSecret: portone.webhookSecret,
    publicKeys: enabled ? { storeId: portone.storeId, channelKey: portone.channelKey } : null,
    test: null,
  }
  return { ok: true, options: { database, masterKey: masterKey.key, appOrigin: origin.origin, testPrinter: false, billing } }
}

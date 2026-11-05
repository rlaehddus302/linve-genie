// 운영 서버 설정 조립 (AC-S04-20·32·41, I1 AC-I1-16, N5 AC-N5-11·39·40). 운영 기동 명령(main.ts)은 이 함수로만 서버 옵션을 만든다.
// - 시험 모드 신호(testPrinter — 화면이 시험용 프린터를 켠다)는 어떤 환경변수·옵션으로도 켜지 않는다: 늘 false (L-11 15, D-I1-06).
//   시험용 프린터는 E2E 기동(e2e.ts startE2eServer)만 켠다.
// - 방송자 조치 대기 시간·리허설 생성기 속도도 운영 값 그대로다(E2E 기동만 바꾼다).
// - 인스타그램 연동 설정(LIVEJJIM_IG_* — N2, instagram/config.ts)을 읽는다. 필수 값이 없으면 설정 없음(서버는 정상으로 시작, 인스타그램은 NOT_CONFIGURED).
//   운영 기동은 가짜 메타 서버를 쓰지 않는다(가짜 서버는 시험·E2E 기동만, D-N2-11).
// - 요금(N5): LIVEJJIM_BILLING(on|off, 기본 off)·LIVEJJIM_BILLING_PRICES(요금 표 JSON 파일)·PORTONE_*(포트원 V2). 결제 어댑터는 포트원 V2,
//   증빙 발행기는 "없음"(팝빌 자리). 시험 결제(가짜 결제 서버·가짜 발행기·시험 경로)는 운영 구성에 없다.
//   켜져 있는데 요금 표가 자리 표시이거나 포트원 설정이 비어 있으면 기동하지 않는다.
// - 입금 확인(N3): 시험 모드(가짜 원천·시험용 입금 넣기 경로)는 늘 끈다(D-N3-12). 받아 오기 주기는 원천의 1~5분 그대로다.
//   팝빌 연동 키(LIVEJJIM_POPBILL_LINK_ID·LIVEJJIM_POPBILL_SECRET_KEY, 선택 LIVEJJIM_POPBILL_TEST_BED=true)가 둘 다 있을 때만 실제 팝빌 전송을 쓴다 — 없으면 계좌조회 원천을 만들 수 없다.
// - 택배 자동 접수(T1, D-T1-02): 운영 기동에는 택배사 어댑터가 없다(가짜 택배사는 E2E 기동·서버 시험만 — 쓰는 택배사는 고를 수 있지만 자동 접수는 막힌다 — FB1 D-FB1-04).
//   우체국 택배 연동 키(LIVEJJIM_EPOST_API_KEY)는 쓰지 않는다 — 우체국 계약 정보는 판매자마다 설정에 넣는다(D-REAL-04). 값이 있으면 "쓰지 않음" 경고만 남긴다(값은 읽지 않는다).
// - 간편 로그인(L1, D-L1-07): LIVEJJIM_LOGIN_GOOGLE_*·LIVEJJIM_LOGIN_KAKAO_*·LIVEJJIM_LOGIN_NAVER_*. 값이 모두 있는 공급자만 켜고, 반만 적었으면 기동하지 않는다.
//   공급자 주소는 고정값(https)이다 — 주소를 바꾸는 환경 변수는 없다(가짜 OAuth 서버는 시험·E2E·연습 기동만).
// - AI 확인 필요 제안(A1, D-A1-04·D-A1-08): LIVEJJIM_ASSIST_API_KEY(없으면 AI 제안을 쓸 수 없음 — 규칙 제안만)·LIVEJJIM_ASSIST_MODEL·
//   LIVEJJIM_ASSIST_DAILY_CALLS(판매자 하루, 기본 20)·LIVEJJIM_ASSIST_GLOBAL_DAILY_CALLS(서버 전체 하루, 기본 500). 주소는 https://api.anthropic.com 고정이다 —
//   주소를 바꾸는 환경 변수는 없다(다른 이름의 변수를 적어도 읽지 않는다). 가짜 LLM 서버는 시험·E2E·연습 기동만.
// - 오류 문장에 환경변수 값을 넣지 않는다.
import { epostCarrier } from './parcel/epost.ts'
import { PortOneCashReceiptIssuer } from './billing/cash-receipt.ts'
import { readBillingEnv, readReceiptIssuerEnv } from './billing/config.ts'
import { noneIssuer } from './billing/documents.ts'
import { PortOneGateway } from './billing/portone.ts'
import type { BillingSetup } from './billing/service.ts'
import { readAppOrigin, readOldAppOrigins } from './config.ts'
import type { Database } from './db/database.ts'
import { readInstagramConfig } from './instagram/config.ts'
import { readBandConfig } from './band/config.ts'
import { readMasterKey } from './secrets.ts'
import { popbillHttpTransport, readPopbillKeys } from './deposit/popbill.ts'
import type { ServerOptions } from './server.ts'
import { readTikTokSettings } from './tiktok/index.ts'
import { TIKTOK_LIBRARY_ENV_NAMES } from './tiktok-live/live.ts'
import { readSocialLoginEnv } from './social/providers.ts'
import { readSmsEnv, sensSender } from './social/phone.ts'
import { readAssistEnv } from './assist/service.ts'

export type ProductionOptions = { readonly ok: true; readonly options: ServerOptions } | { readonly ok: false; readonly message: string }

/**
 * 환경변수(LIVEJJIM_MASTER_KEY·LIVEJJIM_APP_ORIGIN·LIVEJJIM_IG_*·LIVEJJIM_TIKTOK_*·요금 설정·LIVEJJIM_POPBILL_LINK_ID·LIVEJJIM_POPBILL_SECRET_KEY·LIVEJJIM_POPBILL_TEST_BED)와 연 DB로 운영 서버 옵션을 만든다.
 * 틱톡 연결 라이브러리가 스스로 읽는 환경 변수(SIGN_API_URL·SIGN_API_KEY·WHITELIST_AUTHENTICATED_SESSION_ID_HOST)는 비어 있는지만 본다 —
 * 하나라도 있으면 틱톡을 끈 것으로 보고 서버가 경고를 남긴다(값은 읽지 않는다, D-N2b-2-06). 운영 기동은 실제 감싸개(libraryWebcast)를 쓴다(서버 기본값).
 * 그 밖의 환경변수는 읽지 않는다. readFile은 요금 표 파일 읽기 (시험에서 바꿔 끼운다)
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
  const oldOrigins = readOldAppOrigins(env)
  if (!oldOrigins.ok) return { ok: false, message: oldOrigins.message }
  const instagram = readInstagramConfig(env)
  if (!instagram.ok) return { ok: false, message: instagram.message }
  const billingEnv = readBillingEnv(env, readFile)
  if (!billingEnv.ok) return { ok: false, message: billingEnv.message }
  const { enabled, prices, portone } = billingEnv.billing
  // 증빙 발행기 (BL-8 5, D-PAY-10): 운영 기본 "없음". portone일 때만 포트원 현금영수증(금액 칸 세무 확인 뒤 켠다). 모르는 값이면 기동하지 않는다
  const issuerChoice = readReceiptIssuerEnv(env)
  if (!issuerChoice.ok) return { ok: false, message: issuerChoice.message }
  const billing: BillingSetup = {
    enabled,
    prices,
    storeId: portone.storeId,
    gateway: new PortOneGateway({ storeId: portone.storeId, apiSecret: portone.apiSecret }),
    issuer: issuerChoice.issuer === 'portone' ? new PortOneCashReceiptIssuer({ storeId: portone.storeId, apiSecret: portone.apiSecret, channelKey: portone.channelKey }) : noneIssuer,
    webhookSecret: portone.webhookSecret,
    publicKeys: enabled ? { storeId: portone.storeId, channelKey: portone.channelKey } : null,
    test: null,
  }
  const social = readSocialLoginEnv(env)
  if (!social.ok) return { ok: false, message: social.message }
  // 가입 문자 인증 (D-UX3-30 → D-REAL-07): SENS 인증키 둘·서비스 ID·보내는 번호 넷 다 있을 때만 켠다
  const sms = readSmsEnv(env)
  if (!sms.ok) return { ok: false, message: sms.message }
  const smsSender = sms.setup === null ? null : sensSender(sms.setup)
  const assist = readAssistEnv(env)
  if (!assist.ok) return { ok: false, message: assist.message }
  const libraryEnv = TIKTOK_LIBRARY_ENV_NAMES.filter((name) => (env[name] ?? '').trim() !== '')
  const popbill = readPopbillKeys(env)
  // 밴드 (BND1 D-BND1-13): 셋 중 하나라도 비면 설정 없음, 주소가 https가 아니면 설정 없음 + 경고 BAND_CONFIG_INVALID(값 없이) — 서버는 정상으로 시작
  const band = readBandConfig(env)
  const warnings = [
    ...(instagram.warning === undefined ? [] : [instagram.warning]),
    ...((env['LIVEJJIM_EPOST_API_KEY'] ?? '').trim() === '' ? [] : (['PARCEL_CARRIER_NOT_READY'] as const)),
    ...(band.warning === undefined ? [] : [band.warning]),
  ]
  return {
    ok: true,
    options: {
      database,
      masterKey: masterKey.key,
      appOrigin: origin.origin,
      ...(oldOrigins.origins.length === 0 ? {} : { oldAppOrigins: oldOrigins.origins }),
      testPrinter: false,
      ...((env['LIVEJJIM_TRANSCRIBE_WORKER_TOKEN'] ?? '').trim() === '' ? {} : { transcribeWorkerToken: env['LIVEJJIM_TRANSCRIBE_WORKER_TOKEN']!.trim() }),
      instagram: instagram.settings,
      ...(warnings.length === 0 ? {} : { startupWarnings: warnings }),
      tiktok: { settings: readTikTokSettings(env), libraryEnv },
      band: { settings: band.settings },
      deposits: { testMode: false, popbill: popbill === null ? null : popbillHttpTransport(popbill) },
      billing,
      // 우체국 계약소포 (D-REAL-04 — 판매자마다 설정에 넣은 계약 정보로. 가짜 택배사는 고를 수 없다)
      parcel: { carriers: { EPOST: epostCarrier({ now: () => Date.now() }) } },
      socialLogin: { providers: social.providers },
      sms: smsSender,
      assist: assist.setup,
    },
  }
}

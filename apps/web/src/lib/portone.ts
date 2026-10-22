// 결제 창 (N5, BL-6 2·3, AC-N5-52·58).
// - 운영: 포트원 V2 브라우저 SDK(`PortOne.requestPayment`)를 "결제하기"를 누를 때만 불러온다 — 요금 화면을 열기만 해서는 외부 스크립트를 부르지 않는다.
//   SDK에 넘기는 값은 서버가 만든 주문(결제 ID·주문 이름·금액)과 공개 값(상점 ID·채널 키)뿐이다. 비밀값은 화면에 없다(BL-6 8).
//   휴대폰은 결제 뒤 돌아올 주소 `/billing`으로 돌아온다(SDK가 결제 ID를 쿼리에 붙인다 — 화면은 그 결제 ID만 읽는다).
// - 결제 창이 돌려준 성공 여부로 "결제했어요"를 보이지 않는다. 창이 닫히면(성공·실패·닫기 모두) 서버에 확인을 요청하고 서버 결과만 보인다(BL-6 3).
// - 시험 결제 창은 이 파일이 아니라 화면(TestPaymentDialog)이다 — client-config가 시험 결제를 알릴 때만 열린다(AC-N5-58).
import type { OrderCreated, PayMethod } from '../api/billing-types.ts'

/** 포트원 V2 브라우저 SDK 주소 (운영 결제 창) */
export const PORTONE_SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js'

/** requestPayment에 넘기는 값 (포트원 V2 브라우저 SDK) */
export interface PortOnePaymentRequest {
  readonly storeId: string
  readonly channelKey: string
  readonly paymentId: string
  readonly orderName: string
  readonly totalAmount: number
  readonly currency: 'CURRENCY_KRW'
  readonly payMethod: PayMethod
  /** 휴대폰 결제 뒤 돌아올 주소 */
  readonly redirectUrl: string
}

export interface PortOneSdk {
  requestPayment(request: PortOnePaymentRequest): Promise<unknown>
}

declare global {
  interface Window {
    PortOne?: PortOneSdk
  }
}

/** SDK 스크립트를 한 번만 붙인다 (이미 있으면 그대로) */
export function loadPortOneScript(url: string = PORTONE_SDK_URL): Promise<PortOneSdk> {
  const ready = window.PortOne
  if (ready !== undefined) return Promise.resolve(ready)
  return new Promise<PortOneSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => {
      const sdk = window.PortOne
      if (sdk === undefined) reject(new Error('결제 창을 불러오지 못했어요.'))
      else resolve(sdk)
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('결제 창을 불러오지 못했어요.'))
    }
    document.head.append(script)
  })
}

/** 결제 창을 열지 못했을 때 (스크립트를 받지 못함 — 인터넷 연결·차단) */
export const PAYMENT_WINDOW_FAILED = '결제 창을 열지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.'

export interface PortOneKeys {
  readonly storeId: string
  readonly channelKey: string
}

/** 결제 창 요청 값 (서버 주문 + 공개 값 + 돌아올 주소) */
export function paymentRequest(order: OrderCreated, keys: PortOneKeys, origin: string): PortOnePaymentRequest {
  return {
    storeId: order.storeId ?? keys.storeId,
    channelKey: order.channelKey ?? keys.channelKey,
    paymentId: order.paymentId,
    orderName: order.orderName,
    totalAmount: order.amount,
    currency: 'CURRENCY_KRW',
    payMethod: order.method === 'TRANSFER' ? 'TRANSFER' : 'CARD',
    redirectUrl: `${origin}/billing`,
  }
}

export type PaymentWindowOutcome = { readonly kind: 'closed' } | { readonly kind: 'unavailable' }

/**
 * 운영 결제 창을 열고 닫힐 때까지 기다린다. 결과(성공·실패·닫기)는 보지 않는다 — 부르는 쪽이 서버에 확인한다.
 * SDK를 불러오지 못했으면 'unavailable'(결제 창이 열리지 않았다 — 돈이 나가지 않았다).
 */
export async function openPortOnePayment(
  order: OrderCreated,
  keys: PortOneKeys,
  options: { readonly load?: () => Promise<PortOneSdk>; readonly origin?: string } = {},
): Promise<PaymentWindowOutcome> {
  let sdk: PortOneSdk
  try {
    sdk = await (options.load ?? loadPortOneScript)()
  } catch {
    return { kind: 'unavailable' }
  }
  try {
    await sdk.requestPayment(paymentRequest(order, keys, options.origin ?? window.location.origin))
  } catch {
    // 창 안의 오류도 결과를 믿지 않는다 — 서버 확인으로 간다
  }
  return { kind: 'closed' }
}

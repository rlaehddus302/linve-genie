// HTTP 앱 (AC-S00-40, AC-S00-41). 포트를 열지 않는다: 기동은 main.ts, 노드 HTTP 연결은 node-server.ts가 맡는다.
// 테스트는 app.request(...)로 프로세스 안에서 요청한다.
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { errorResponse } from './errors.ts'

export type ErrorLogger = (error: unknown) => void

export interface AppOptions {
  /** 처리 중 예상하지 못한 오류를 기록한다. 응답에는 오류 내용이 들어가지 않는다. 기본값: 표준 오류 출력 */
  readonly logError?: ErrorLogger
}

export const defaultLogError: ErrorLogger = (error) => {
  console.error('[server] 요청 처리 중 오류가 생겼어요.', error)
}

/** 기록하다 실패해도 응답은 나가야 한다 */
export function safeLogger(log: ErrorLogger): ErrorLogger {
  return (error) => {
    try {
      log(error)
    } catch {
      // 기록 실패는 무시한다
    }
  }
}

/** 경로마다 허용하는 메서드. HEAD는 GET 처리기가 받는다(본문 없이). */
const HEALTH_ALLOW = 'GET, HEAD'

export function createApp(options: AppOptions = {}): Hono {
  const logError = safeLogger(options.logError ?? defaultLogError)
  const app = new Hono()

  // Hono의 onError는 Error 인스턴스만 받는다. 처리기가 Error가 아닌 값을 던져도 JSON 500으로 끝나게 한다.
  app.use(async (_c, next) => {
    try {
      await next()
    } catch (thrown) {
      logError(thrown)
      return errorResponse(500)
    }
    return undefined
  })

  // 헬스체크: DB·외부 서비스·비밀값을 보지 않는다 (D-025)
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.all('/health', () => errorResponse(405, { Allow: HEALTH_ALLOW }))

  app.notFound(() => errorResponse(404))

  app.onError((error) => {
    // 요청 쪽 문제(4xx)는 상태만 살리고, 프레임워크가 붙인 메시지는 버린다
    if (error instanceof HTTPException && error.status >= 400 && error.status < 500) return errorResponse(error.status)
    logError(error)
    return errorResponse(error instanceof HTTPException ? error.status : 500)
  })

  return app
}

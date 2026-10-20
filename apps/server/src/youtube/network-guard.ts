// 시험의 바깥 호출 막기 (AC-Y1-72·91): 시험 어디에서도 실제 구글로 나가는 요청이 생기면 실패한다.
// 서버 시험 설정(vitest.config.ts의 setupFiles)이 설치한다. 적대 시험도 가져다 쓸 수 있게 프로그램 API로 낸다.
import http from 'node:http'
import https from 'node:https'

/** 막는 주소: *.google.com · *.googleapis.com · youtube.com(과 그 아래) · youtu.be */
export const GOOGLE_HOST_RE = /(^|\.)(google\.com|googleapis\.com|youtube\.com|youtu\.be|googleusercontent\.com)$/i

export class BlockedRequestError extends Error {
  constructor() {
    super('시험에서 실제 구글 주소로 요청하려 했다')
    this.name = 'BlockedRequestError'
  }
}

/** 막힌 요청 수 (시험이 0인지 확인한다) */
export const blockedRequests = { count: 0 }

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    if (typeof input === 'object' && input !== null) {
      const record = input as Record<string, unknown>
      if (typeof record.url === 'string') return new URL(record.url).hostname
      if (typeof record.hostname === 'string') return record.hostname
      if (typeof record.host === 'string') return record.host.split(':')[0] ?? null
    }
  } catch {
    return null
  }
  return null
}

let installed = false

/** 전역 fetch와 http(s).request를 감싸 구글 주소로 나가는 요청을 막는다 (한 번만 설치) */
export function installGoogleBlock(): void {
  if (installed) return
  installed = true
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const host = hostOf(input)
    if (host !== null && GOOGLE_HOST_RE.test(host)) {
      blockedRequests.count += 1
      return Promise.reject(new BlockedRequestError())
    }
    return originalFetch(input, init)
  }) as typeof fetch
  for (const module of [http, https]) {
    const original = module.request.bind(module)
    const guarded = (...args: unknown[]) => {
      const host = hostOf(args[0])
      if (host !== null && GOOGLE_HOST_RE.test(host)) {
        blockedRequests.count += 1
        throw new BlockedRequestError()
      }
      return (original as (...a: unknown[]) => http.ClientRequest)(...args)
    }
    ;(module as { request: unknown }).request = guarded
  }
}

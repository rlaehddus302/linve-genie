// 라벨 렌더 환경 (브라우저): 이 앱 번들 안의 내장 글꼴을 한 번 불러온다(@livejjim/label/browser — 인터넷 글꼴이 아니다).
// 글꼴 등록이 끝난 뒤에 그려야 한다. 실패하면 다음에 다시 시도한다.
import type { LabelRenderEnv } from '@livejjim/label'

let envPromise: Promise<LabelRenderEnv> | null = null
let injected: LabelRenderEnv | null = null

/** 렌더 환경 (내장 글꼴을 불러온 뒤). 실패하면 다음에 다시 시도한다 */
export function labelEnv(): Promise<LabelRenderEnv> {
  if (injected !== null) return Promise.resolve(injected)
  envPromise ??= import('@livejjim/label/browser')
    .then(async ({ createBrowserRenderEnv, loadBrowserLabelFont }) => createBrowserRenderEnv(await loadBrowserLabelFont()))
    .catch((error: unknown) => {
      envPromise = null
      throw error
    })
  return envPromise
}

/** 시험: 렌더 환경을 넣는다 (Node 캔버스 등) */
export function setLabelEnv(env: LabelRenderEnv | null): void {
  injected = env
  envPromise = null
}

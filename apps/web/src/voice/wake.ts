// 음성이 켜진 동안 화면 꺼짐 막기 (MOB1 D-MOB1-07, VOC-01, AC-MOB1-10).
// - 음성이 듣는 중(phase 'on')이면 `navigator.wakeLock.request('screen')`를 한 번 요청하고, 음성을 끄면 그 잠금을 놓는다.
// - 화면이 숨으면 브라우저가 잠금을 놓는다 — 다시 보이면(visibilitychange → visible) 음성이 아직 켜져 있을 때만 다시 한 번 요청한다.
// - 지원하지 않거나 거절되면 아무 문장도 띄우지 않는다(음성 동작 그대로).
// - 출력 기기의 화면 꺼짐 막기(D-I1-03, printer-station.ts)와 따로 잠금을 잡는다 — 이쪽이 놓아도 그쪽 잠금은 남는다(브라우저는 잠금이 하나라도 있으면 막는다).
import { useEffect, useRef } from 'react'

export interface WakeSentinelLike {
  release(): Promise<void>
  addEventListener?(type: 'release', listener: () => void): void
}

export type RequestWake = () => Promise<WakeSentinelLike>

/** 보이는지·보임이 바뀔 때 알림 (document와 같은 모양) */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** 브라우저의 화면 꺼짐 막기 요청 (없으면 null) */
export function browserScreenWake(): RequestWake | null {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinelLike> } }
    const lock = nav.wakeLock
    if (lock === undefined || typeof lock.request !== 'function') return null
    return () => lock.request('screen')
  } catch {
    return null
  }
}

export class ScreenWake {
  readonly #request: RequestWake | null
  readonly #doc: VisibilitySource | null
  #active = false
  #sentinel: WakeSentinelLike | null = null
  #asking = false

  constructor(request: RequestWake | null, doc: VisibilitySource | null) {
    this.#request = request
    this.#doc = doc
  }

  /** 음성이 켜졌는가 — 켜지면 요청, 꺼지면 놓는다 */
  set(active: boolean): void {
    if (active === this.#active) return
    this.#active = active
    if (active) {
      this.#doc?.addEventListener('visibilitychange', this.#onVisibility)
      this.#ensure()
    } else {
      this.#doc?.removeEventListener('visibilitychange', this.#onVisibility)
      this.#release()
    }
  }

  /** 다 쓴 뒤 (화면을 떠날 때) */
  dispose(): void {
    this.set(false)
  }

  readonly #onVisibility = (): void => {
    if (this.#doc?.visibilityState === 'visible') this.#ensure()
    // 숨으면 브라우저가 잠금을 놓는다 — 다시 보일 때 새로 요청하게 잡은 것을 잊는다
    else this.#sentinel = null
  }

  #ensure(): void {
    const request = this.#request
    if (request === null || !this.#active || this.#sentinel !== null || this.#asking) return
    if (this.#doc !== null && this.#doc.visibilityState !== 'visible') return
    this.#asking = true
    let pending: Promise<WakeSentinelLike>
    try {
      pending = request()
    } catch {
      this.#asking = false
      return
    }
    pending.then(
      (sentinel) => {
        this.#asking = false
        if (!this.#active) {
          void sentinel.release().catch(() => {})
          return
        }
        this.#sentinel = sentinel
        sentinel.addEventListener?.('release', () => {
          if (this.#sentinel === sentinel) this.#sentinel = null
        })
      },
      () => {
        // 거절됨 — 음성은 그대로, 문장 없음
        this.#asking = false
      },
    )
  }

  #release(): void {
    const sentinel = this.#sentinel
    this.#sentinel = null
    if (sentinel === null) return
    try {
      void sentinel.release().catch(() => {})
    } catch {
      // 이미 풀렸다
    }
  }
}

/** 음성이 켜진 동안(active) 화면 꺼짐 막기 */
export function useScreenWake(active: boolean): void {
  const wake = useRef<ScreenWake | null>(null)
  useEffect(() => {
    const made = new ScreenWake(browserScreenWake(), typeof document === 'undefined' ? null : document)
    wake.current = made
    return () => {
      made.dispose()
      wake.current = null
    }
  }, [])
  useEffect(() => {
    wake.current?.set(active)
  }, [active])
}

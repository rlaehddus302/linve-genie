// PWA (UX-07, AC-S06-50~52, D-093): 서비스 워커 등록·새 버전 안내·설치 안내.
// - 서비스 워커(/sw.js, 범위 /)는 운영용 빌드에서만 등록한다. 새 버전은 기다렸다가 다음에 열 때 바뀐다 — 화면은 "새 버전이 있어요"를 보이고,
//   판매자가 "지금 새로고침"을 누를 때만 바꾸고 다시 연다(치던 입력·5초 대기 조치가 사라지지 않게). 저절로 다시 열지 않는다.
// - 설치: 브라우저가 설치를 제안할 수 있으면(beforeinstallprompt) "앱으로 설치", 아이폰 사파리면 "홈 화면에 추가" 안내.
//   이미 앱으로 열렸으면(display-mode: standalone) 숨긴다. 설치했거나 "닫기"를 누르면 이 기기에서 다시 보이지 않는다(브라우저 저장소 — 실패해도 동작).
import { useSyncExternalStore } from 'react'

interface InstallPromptEvent extends Event {
  prompt?: () => Promise<unknown> | void
  userChoice?: Promise<{ outcome?: string }>
}

interface PwaState {
  /** 브라우저가 준 설치 제안 (누르면 설치 창) */
  readonly prompt: InstallPromptEvent | null
  /** 설치했거나 "닫기"를 눌러 이 기기에서 숨김 */
  readonly hidden: boolean
  /** 기다리는 새 버전 서비스 워커 */
  readonly waiting: ServiceWorker | null
}

const HIDE_KEY = 'livejjim.installHint'
const UPDATE_CHECK_MS = 30 * 60 * 1000

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === 'hidden'
  } catch {
    return false
  }
}

function writeHidden(): void {
  try {
    window.localStorage.setItem(HIDE_KEY, 'hidden')
  } catch {
    // 저장하지 못해도 이번에는 숨긴다
  }
}

let state: PwaState = { prompt: null, hidden: false, waiting: null }
const listeners = new Set<() => void>()
let started = false
let reloading = false

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = (): PwaState => state

/** 이미 앱(홈 화면 아이콘)으로 열렸는가 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneNavigator = (navigator as Navigator & { standalone?: boolean }).standalone === true
  try {
    return standaloneNavigator || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  } catch {
    return standaloneNavigator
  }
}

/** 아이폰·아이패드 사파리 (설치 제안 이벤트가 없다 — 공유 → 홈 화면에 추가) */
export function isIosSafari(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)
  return ios && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)
}

function track(registration: ServiceWorkerRegistration): void {
  const container = navigator.serviceWorker
  const offer = (worker: ServiceWorker | null) => {
    // 처음 설치(이 화면을 아직 아무 워커도 제어하지 않음)는 새 버전이 아니다
    if (worker !== null && container.controller !== null) set({ waiting: worker })
  }
  if (registration.waiting !== null) offer(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (worker === null) return
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker)
    })
  })
  // 방송 중 오래 열어 두는 화면도 새 버전을 알 수 있게 가끔 확인한다(바꾸지는 않는다)
  setInterval(() => {
    registration.update().catch(() => {})
  }, UPDATE_CHECK_MS)
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker
  container.addEventListener('controllerchange', () => {
    // 판매자가 "지금 새로고침"을 눌렀을 때만 다시 연다
    if (reloading) window.location.reload()
  })
  const register = () => {
    container.register('/sw.js', { scope: '/' }).then(track, () => {})
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/** 앱을 띄울 때 한 번 (main.tsx). serviceWorker: 운영용 빌드에서만 등록 */
export function startPwa(options: { readonly serviceWorker: boolean }): void {
  if (started || typeof window === 'undefined') return
  started = true
  set({ hidden: readHidden() })
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    set({ prompt: event as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => {
    writeHidden()
    set({ prompt: null, hidden: true })
  })
  if (options.serviceWorker) registerServiceWorker()
}

export interface InstallHint {
  /** "앱으로 설치" 버튼을 보인다 */
  readonly canInstall: boolean
  /** 아이폰 사파리 안내를 보인다 */
  readonly iosHint: boolean
  install(): Promise<void>
  dismiss(): void
}

export function useInstallHint(): InstallHint {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  const visible = !current.hidden && !isStandalone()
  return {
    canInstall: visible && current.prompt !== null,
    iosHint: visible && current.prompt === null && isIosSafari(),
    install: async () => {
      const event = current.prompt
      if (event === null) return
      try {
        await event.prompt?.()
        const choice = await event.userChoice
        if (choice?.outcome === 'accepted') {
          writeHidden()
          set({ prompt: null, hidden: true })
          return
        }
      } catch {
        // 브라우저가 창을 띄우지 못했다 — 버튼은 남긴다
      }
      // 설치 제안은 한 번만 쓸 수 있다
      set({ prompt: null })
    },
    dismiss: () => {
      writeHidden()
      set({ hidden: true })
    },
  }
}

export interface UpdateNotice {
  readonly available: boolean
  /** "지금 새로고침": 기다리는 새 버전으로 바꾸고 다시 연다 */
  apply(): void
}

export function useUpdateNotice(): UpdateNotice {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  return {
    available: current.waiting !== null,
    apply: () => {
      const worker = current.waiting
      if (worker === null) return
      reloading = true
      worker.postMessage({ type: 'SKIP_WAITING' })
    },
  }
}

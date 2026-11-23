// 출력 기기만 뒤에서 대기열을 확인한다. 서버가 정한 기기·멈춤·출력 시도 규칙은 LabelQueue가 그대로 적용한다.
import { useEffect } from 'react'
import { AppRegistry, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { useServices, useSession } from '../services.tsx'

interface PrintStation {
  addListener(event: 'stationStopped', listener: () => void): { remove(): void }
  setStation(enabled: boolean): void
  isRunning(): boolean
  setFinishingSheet(working: boolean): Promise<void>
}

const station = requireOptionalNativeModule<PrintStation>('LiveGeniePrintStation')
if (Platform.OS === 'android' && station) {
  AppRegistry.registerHeadlessTask('LiveGeniePrintStation', () => () => new Promise<void>(resolve => {
    const done = () => { subscription.remove(); resolve() }
    const subscription = station.addListener('stationStopped', done)
    if (!station.isRunning()) done()
  }))
}

export function PrintBackground() {
  const { labels } = useServices()
  const { session } = useSession()
  const signedIn = session.state === 'in'
  useEffect(() => {
    if (!signedIn) return
    let active = false
    let working = false
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      const view = labels.getSnapshot()
      const linked = view.printer === 'CONNECTED' || view.printer === 'PRINTING'
      const wanted = view.mine && view.queue?.labelsEnabled === true && !view.queue.device?.releasing &&
        view.target === 'bluetooth' && (linked || view.autoReconnect?.kind === 'trying')
      if (active !== wanted) {
        active = wanted
        if (Platform.OS === 'android') station?.setStation(wanted)
        if (timer !== undefined) clearInterval(timer)
        // 20초마다 대기열을 다시 받고 이어 찍는다 — 앱이 앞에 있어도 (D-SSE-STALL-01: 실시간 알림이 조용히 끊기면 앞에 있는 동안
        // 새 라벨을 못 받아 [대기 중인 라벨 모두 출력하기]를 눌러야만 나왔다. 옛: 뒤에 있을 때만)
        timer = wanted ? setInterval(() => labels.resume(), 20_000) : undefined
      }
      const printing = wanted && (view.job !== null || (view.busy && (view.queue?.waiting ?? 0) > 0))
      if (Platform.OS === 'ios' && printing !== working) {
        working = printing
        void station?.setFinishingSheet(printing).catch(() => undefined)
      }
    }
    const unsubscribe = labels.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      if (timer !== undefined) clearInterval(timer)
      if (Platform.OS === 'android' && active) station?.setStation(false)
      if (Platform.OS === 'ios' && working) void station?.setFinishingSheet(false).catch(() => undefined)
    }
  }, [labels, signedIn])
  return null
}

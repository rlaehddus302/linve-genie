// 출력 기기만 뒤에서 대기열을 확인한다. 서버가 정한 기기·멈춤·출력 시도 규칙은 LabelQueue가 그대로 적용한다.
import { useEffect } from 'react'
import { AppRegistry, AppState, Platform } from 'react-native'
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
        timer = wanted ? setInterval(() => { if (AppState.currentState !== 'active') labels.resume() }, 20_000) : undefined
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

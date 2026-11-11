// 앱 화면 새 버전 받기의 실제 구현 (D-OTA-01): expo-updates. 운영 빌드(Release, 업데이트 켜짐)에서만 넣는다 —
// 개발(Metro)·시험 빌드는 Updates.isEnabled가 false라 아무것도 넣지 않는다. 받는 곳·버전 지문은 ios/app/Supporting/Expo.plist·AndroidManifest.xml.
import * as Updates from 'expo-updates'
import { setUpdatesApi } from '../lib/app-update.ts'

export function installAppUpdates(): void {
  if (!Updates.isEnabled || __DEV__) return
  setUpdatesApi({
    fetchNew: async () => {
      const check = await Updates.checkForUpdateAsync()
      if (!check.isAvailable) return false
      const fetched = await Updates.fetchUpdateAsync()
      return fetched.isNew
    },
    reload: () => Updates.reloadAsync(),
  })
}

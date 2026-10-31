// 디자인 견본 경로: 개발 모드에서만 열린다 (배포 빌드에서는 처음 화면으로 돌려보낸다).
import { Redirect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'
import { DesignShowcaseScreen } from '../../src/screens/DesignShowcaseScreen.tsx'

export default function DesignRoute() {
  if (!__DEV__) return <Redirect href="/" />
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <KitInsets>
        <DesignShowcaseScreen />
      </KitInsets>
    </SafeAreaView>
  )
}

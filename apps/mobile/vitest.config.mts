// 휴대폰 앱 단위·화면 시험. test 단계(루트 vitest.config.ts의 projects)가 이 설정을 자동으로 포함한다.
// 화면은 react-native-web(Expo 웹 출력과 같은 구현)으로 jsdom에 그려 역할(role)·이름(aria-label)·글자로 확인한다.
// 네이티브 모듈(마이크·BLE)은 src/native의 가짜 구현을 쓰고, 서버는 가짜 fetch로 대신한다.
import { fileURLToPath } from 'node:url'
import { defineProject } from 'vitest/config'

export default defineProject({
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      // 아래 탭 아이콘(SVG)은 웹 구현으로 그린다 — 기본 진입점은 네이티브 코드를 부른다
      'react-native-svg': fileURLToPath(new URL('./node_modules/react-native-svg/lib/module/elements.web.js', import.meta.url)),
    },
  },
  define: {
    __DEV__: 'false',
  },
  test: {
    name: 'mobile',
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
})

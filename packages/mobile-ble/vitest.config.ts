// 앱 블루투스 라벨 패키지 단위 시험 — 바이트 수준 가짜 B1·가짜 BLE 전송·가짜 BleManager로 돈다(실기기·네이티브 빌드 없음).
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'mobile-ble',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
})

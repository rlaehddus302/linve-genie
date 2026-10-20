// 라벨 패키지 단위 테스트 — 라벨 골든(tests/golden/label/*.json) 포함. 캔버스는 Node 캔버스(@napi-rs/canvas)를 주입한다.
import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'label',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 렌더 시험은 글꼴 등록·30장 렌더가 있어 기본 5초보다 넉넉히 둔다 (속도 기준은 시험 안에서 따로 잰다)
    testTimeout: 30_000,
  },
})

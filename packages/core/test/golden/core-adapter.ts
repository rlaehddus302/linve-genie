// 실제 코어(@livejjim/core)를 골든 러너의 GoldenCore 모양으로 감싼다.
// 파서(S01)·엔진(S02~S03)을 구현하면 이 파일에서 코어 결과를 GoldenSnapshot으로 옮긴다.
import { NotImplementedError, applyEvent, initEngine, parseAmount, parseChat, parseKoreanNumber, parseQuickInput, type EngineState } from '@livejjim/core'
import type { GoldenCore } from './types.ts'

export const realCore: GoldenCore = {
  parser: {
    chat: (text, settings) => parseChat(text, settings),
    amount: (text, settings) => parseAmount(text, settings),
    koreanNumber: (text) => parseKoreanNumber(text),
    quickInput: (text, settings) => parseQuickInput(text, settings),
  },
  engine: {
    start: (setup) => initEngine(setup),
    apply: (state, event) => applyEvent(state as EngineState, event),
    observe: () => {
      // 엔진 상태 → 골든 스냅샷 변환은 엔진 상태 모양이 정해지는 S02에서 붙인다.
      throw new NotImplementedError('골든 관찰 스냅샷(observe)')
    },
  },
}

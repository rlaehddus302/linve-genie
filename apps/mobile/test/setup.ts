// 화면 시험마다 그린 것을 치운다 (vitest는 globals가 없어 @testing-library/react가 스스로 치우지 않는다).
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetDockChoice } from '../src/lib/dock-choice.ts'

afterEach(() => {
  cleanup()
  // 방송 화면 아래 창 고르기는 앱 전체 값이라 시험마다 처음(들린 말)으로
  resetDockChoice()
})

// 화면 시험마다 그린 것을 치운다 (vitest는 globals가 없어 @testing-library/react가 스스로 치우지 않는다).
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

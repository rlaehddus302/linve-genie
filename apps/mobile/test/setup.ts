// 화면 시험마다 그린 것을 치운다 (vitest는 globals가 없어 @testing-library/react가 스스로 치우지 않는다).
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetDockChoice } from '../src/lib/dock-choice.ts'
import { clearCached } from '../src/lib/cached-get.ts'
import { resetNewLinks } from '../src/lib/new-link.ts'

afterEach(() => {
  cleanup()
  // 방송 화면 아래 창 고르기는 앱 전체 값이라 시험마다 처음(들린 말)으로
  resetDockChoice()
  // 기억해 둔 화면 자료는 시험마다 비운다 (D-UX4-77) — 앞 시험의 가짜 서버 자료가 다음 시험에 보이지 않게
  clearCached()
  // 새 라이브 잇기 맡김·시작 표시도 (D-LINK-ASYNC-01·D-DRAFT-02)
  resetNewLinks()
})

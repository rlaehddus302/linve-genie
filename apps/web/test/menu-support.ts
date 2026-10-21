// 휴대폰 메뉴 시험 도우미 (D-NAV-01): jsdom에는 matchMedia가 없어 휴대폰 모양이다 — 앞 네 칸 밖의 메뉴는 "더보기"를 열어야 보인다.
import { fireEvent, screen, within } from '@testing-library/react'

export const menuNav = () => screen.getByRole('navigation', { name: '메뉴' })

/** "더보기"를 열고 목록을 돌려준다 (이미 열려 있으면 그대로) */
export function openMore(): HTMLElement {
  const more = within(menuNav()).getByRole('button', { name: '더보기' })
  if (more.getAttribute('aria-expanded') !== 'true') fireEvent.click(more)
  return within(menuNav()).getByRole('list')
}

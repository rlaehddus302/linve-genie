import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { YoutubeChatText } from '../src/screens/console/YoutubeChatText.tsx'

it('이어지는 유튜브 이모티콘은 각각 그림으로, 주변 글과 일반 이모지는 그대로 표시한다', () => {
  const { container } = render(<YoutubeChatText text="안녕👋:hand-pink-waving::hand-pink-waving::face-red-heart-shape: :내문구:" oneLine={false} />)
  expect(screen.getAllByLabelText('hand pink waving')).toHaveLength(2)
  expect(screen.getByLabelText('face red heart shape')).toBeTruthy()
  expect(container.textContent).toBe('안녕👋 :내문구:')
})

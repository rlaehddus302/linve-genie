// 앱(Hermes)처럼 Intl.Segmenter가 없을 때의 대체 나누기가 Intl.Segmenter와 같은 결과를 내는지 (APP2)
import { describe, expect, it } from 'vitest'
import { splitGraphemesWithoutIntl } from '../src/text.ts'

const reference = (value: string): string[] => [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value)].map((s) => s.segment)

describe('Intl.Segmenter 없는 글자 나누기', () => {
  const samples = [
    '핑크프릴 20,000원',
    '라울 🌵 다육',
    '👍🏽 좋아요',
    '👨‍👩‍👧 가족',
    '🇰🇷🇯🇵 국기',
    '🇰🇷🇰',
    'é é',
    '한 옛한글 자모',
    '❤️ 하트',
    '',
  ]
  for (const sample of samples) {
    it(`"${sample}"`, () => {
      expect(splitGraphemesWithoutIntl(sample)).toEqual(reference(sample))
    })
  }
})

// 음성 코드 불러오기 (AC-I4-04·12, D-I4-09, TE-I4-002): 받지 못한 뒤 다시 받을 주소.
import { describe, expect, it } from 'vitest'
import { VOICE_CHUNK_PLACEHOLDER } from '../src/voice/chunk.ts'
import { loadVoice, retryAddress } from '../src/voice/load.ts'

const BASE = 'https://app.test/assets/index-abc.js'

describe('음성 조각 다시 받기 주소 (TE-I4-002)', () => {
  it('빌드가 넣은 조각 주소를 이 코드가 든 조각의 폴더에서 풀고 retry=N을 붙인다 (다시 받을 때마다 새 주소)', () => {
    expect(retryAddress(1, './src-xyz.js', BASE)).toBe('https://app.test/assets/src-xyz.js?retry=1')
    expect(retryAddress(2, './src-xyz.js', BASE)).toBe('https://app.test/assets/src-xyz.js?retry=2')
    expect(retryAddress(1, '../voice/src-xyz.js', BASE)).toBe('https://app.test/voice/src-xyz.js?retry=1')
  })

  it('자리 글자 그대로(개발 서버·시험)·JS가 아닌 주소·다른 출처·읽을 수 없는 주소는 null (같은 import를 다시 부른다)', () => {
    expect(retryAddress(1, VOICE_CHUNK_PLACEHOLDER, BASE)).toBeNull()
    expect(retryAddress(1)).toBeNull()
    expect(retryAddress(1, './style.css', BASE)).toBeNull()
    expect(retryAddress(1, 'https://other.test/assets/src-xyz.js', BASE)).toBeNull()
    expect(retryAddress(1, '//other.test/src-xyz.js', BASE)).toBeNull()
    expect(retryAddress(1, './src-xyz.js', 'not a url')).toBeNull()
  })

  it('한 번 받으면 같은 모듈을 돌려준다', async () => {
    const first = await loadVoice()
    expect(typeof first.createWebSpeechEngine).toBe('function')
    expect(await loadVoice()).toBe(first)
  })
})

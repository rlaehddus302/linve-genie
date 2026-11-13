import { Platform } from 'react-native'
import type Svg from 'react-native-svg'
import { decodeBase64 } from '../../api/labels.ts'

export function wrap(text: string, maxUnits: number): string[] {
  const lines: string[] = []
  let line = ''
  let units = 0
  for (const ch of text.replace(/\s+/gu, ' ').trim()) {
    const size = /[\x20-\x7e]/u.test(ch) ? 0.68 : 1
    if (line && units + size > maxUnits) { lines.push(line); line = ''; units = 0 }
    line += ch
    units += size
  }
  return [...lines, line]
}

export function snapshot(svg: Svg | null, height: number, width: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (!svg) { reject(new Error('그림을 불러오지 못했어요.')); return }
    const timer = setTimeout(() => reject(new Error('그림을 다시 열어 주세요.')), 10000)
    // iOS의 이미지 렌더러는 기기 배율을 이미 적용한다. 안드로이드의 크기는 픽셀이다.
    const scale = Platform.OS === 'ios' ? 1 : 2
    svg.toDataURL(data => {
      clearTimeout(timer)
      try {
        const bytes = decodeBase64(data.replace(/\s/g, ''))
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('정산서 사진을 만들지 못했어요.')
        resolve(bytes)
      } catch (e) { reject(e) }
    }, { width: width * scale, height: height * scale })
  })
}


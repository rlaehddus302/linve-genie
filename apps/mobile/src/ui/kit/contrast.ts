// 글자-바탕 대비 계산 (WCAG 2.x 상대 휘도). 토큰 쌍이 4.5:1을 넘는지 시험에서 확인한다.
// 순수 함수만 둔다 (화면 없이 node에서 돈다).

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** '#rrggbb' 또는 '#rgb' → [r, g, b] (0~255). 알파·이름 색은 받지 않는다. */
export function parseHex(hex: string): readonly [number, number, number] {
  const raw = hex.trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`색 값이 '#rrggbb' 꼴이 아니에요: ${hex}`)
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** 대비 비율 (1 ~ 21). 순서와 무관하다. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 본문 글자 기준(4.5:1) 통과 여부 */
export function passesAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5
}

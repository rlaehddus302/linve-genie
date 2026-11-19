// 방송 상품 줄 아래 꼬리표 (D-UX3-78): [찜 닉네임](금색) → 대기 손님(회색) → 대기 밖 손님(흐린 회색, D-UX4-142) → 한 줄에 다 못 놓으면 [+N].
// 화면 폭을 재서(onLayout) 한 줄에 들어가는 만큼만 놓는다. 글자 폭은 어림한다(한글·이모지 = 글자 크기, 그 밖 = 0.62배).
import type { Buyer } from '@livejjim/web/src/api/types.ts'

/**
 * out: 대기 인원이 차서 대기에 들지 못한 찜(품절) — 판정은 그대로, 보이기만 흐리게 (D-UX4-142).
 * hold: 공개 전 상품(확인 중 — 품종·가격 듣는 중 포함)에 들어와 확정을 기다리는 찜 — 아직 1등·대기가 정해지지 않아 회색으로만 (D-CLAIMLAT-01)
 */
export type ProductTagKind = 'win' | 'wait' | 'badge' | 'out' | 'hold'

export interface ProductTag {
  readonly kind: ProductTagKind
  readonly text: string
}

/** 꼬리표 안 좌우 여백 (dp) */
export const TAG_PAD_X = 8
/** 꼬리표 사이 (dp) */
export const TAG_GAP = 4

/**
 * 손님 꼬리표 낱말 (D-UX4-24, 사용자 지시 2026-11-09 "각 상품마다 찜 목록에서 닉네임만 보여줘. 문자는 [문자-0937]"):
 * 유튜브 손님은 닉네임만, 문자 손님은 "문자-끝4자리"(전화번호 전체는 보이지 않는다, 찜 기록과 같은 꼴). 끝자리가 없는 문자 손님은 문자에 적힌 이름.
 * 1등·대기는 낱말이 아니라 색(금색·회색)으로만 나눈다 — 옛 "찜 닉네임"·"문자찜 0937"(D-UX3-78). winner는 색을 정하는 쪽이 쓴다.
 */
// 끝 네 자리 없는 문자 손님은 제 이름("문자찜"·"문자찜(이름)")만 — 같은 이름 손님을 가르는 "· 문자 17:48:38"은 상품 화면에 붙이지 않는다
// (D-SMSNAME-01, 사용자 2026-11-18 "문자찜 넣기 했는데 왜 저따구로 등록됨?"). 찜 기록·손님별 합계는 손님을 갈라야 해서 그대로
export function buyerTagText(buyer: (Pick<Buyer, 'kind' | 'phoneLast4'> & { readonly display?: string }) | undefined, name: string, _winner?: boolean): string {
  if (buyer?.kind === 'sms') return buyer.phoneLast4 !== null && buyer.phoneLast4.trim() !== '' ? `문자-${buyer.phoneLast4}` : buyer.display !== undefined && buyer.display.trim() !== '' ? buyer.display : name
  return name
}

/** 글자 폭 어림 (dp) — 넉넉하게 잡아 한 줄을 넘지 않게 */
export function textWidth(text: string, size: number): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    width += code >= 0x1100 ? size : char === ' ' ? size * 0.3 : size * 0.62
  }
  return width
}

export function tagWidth(text: string, size: number): number {
  return Math.ceil(textWidth(text, size) + TAG_PAD_X * 2)
}

/**
 * 한 줄에 놓을 꼬리표와 남은 수. 폭을 아직 모르면(0 이하) 모두 놓는다(넘치는 쪽은 잘린다).
 * 다 못 놓으면 [+N] 자리를 남기고 앞에서부터 들어가는 만큼만 놓는다. 앞 keep개(1등·손님 꼬리표)는 넘쳐도 놓는다(글이 잘릴 뿐).
 */
export function fitTags(tags: readonly ProductTag[], width: number, size: number, keep = 1): { readonly shown: readonly ProductTag[]; readonly more: number } {
  if (width <= 0 || tags.length === 0) return { shown: tags, more: 0 }
  const widths = tags.map((tag) => tagWidth(tag.text, size))
  const total = widths.reduce((sum, w) => sum + w, 0) + TAG_GAP * (tags.length - 1)
  if (total <= width) return { shown: tags, more: 0 }
  const moreWidth = tagWidth(`+${String(tags.length)}`, size) + TAG_GAP
  let used = moreWidth
  let count = 0
  for (const w of widths) {
    const next = used + w + (count === 0 ? 0 : TAG_GAP)
    if (next > width) break
    used = next
    count++
  }
  count = Math.min(tags.length, Math.max(keep, count))
  return { shown: tags.slice(0, count), more: tags.length - count }
}

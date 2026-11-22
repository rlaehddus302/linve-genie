// 찜 감사 채팅 양식을 올리는 글에 입히기 (D-THANKS-FMT-01).
// 엔진의 감사 문구는 늘 기본 모양(`{번호}번 {품종} {금액} {구매자}님 구매 감사합니다`)이다 — 기록·재생·여러 계정 견주기·게시 뒤 정정의 비교가 그대로다.
// 글을 올리는 쪽(유튜브 발송함·틱톡 봇·크롬 확장·감사 정정)만 바로 올리기 전에 판매자 양식으로 바꾼다:
// 지금 엔진 상태의 찜(번호·옵션·수량·단가)·상품(품종)과, 엔진 문구 끝의 구매자 이름(효과가 나온 때의 이름 — R-13)으로 다시 그린다.
// 엔진 문구가 지금 값으로 만든 앞머리로 시작하지 않으면(고침을 따라가지 않는 옛 방송 등) 짐작하지 않고 엔진 문구를 그대로 올린다.
import { formatThanksHead, isDefaultThanksTemplate, listClaims, listEffects, listProducts, parseThanksTemplate, renderThanks, thanksTemplateSuffix, type EngineState, type ThanksTemplate } from '@livejjim/core'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { sellers } from '../db/schema.ts'
import { THANKS_SUFFIX } from './texts.ts'

const NAME_TAIL = `님${THANKS_SUFFIX}`

/** 판매자의 감사 양식 (없거나 깨졌으면 기본 양식) */
export async function sellerThanksTemplate(db: Db, sellerId: string): Promise<ThanksTemplate> {
  const rows = await db.select({ template: sellers.thanksTemplate }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  return parseThanksTemplate(rows[0]?.template ?? null)
}

/** 양식 저장 (기본 양식이면 비운다 — 기본이 바뀌어도 따라가게). 검사는 부르는 쪽이 한다 */
export async function saveThanksTemplate(db: Db, sellerId: string, template: ThanksTemplate): Promise<void> {
  const stored = isDefaultThanksTemplate(template) ? null : JSON.stringify(template)
  await db.update(sellers).set({ thanksTemplate: stored }).where(eq(sellers.id, sellerId))
}

/** 효과 ID와 엔진 문구 → 올릴 글. 기본 양식이면 엔진 문구 그대로 */
export type ThanksRender = (effectId: string, text: string) => string

export const PLAIN_RENDER: ThanksRender = (_id, text) => text

/** 지금 엔진 상태로 양식을 입히는 함수 */
export function thanksRenderer(state: EngineState, template: ThanksTemplate): ThanksRender {
  if (isDefaultThanksTemplate(template)) return PLAIN_RENDER
  let maps: { effects: Map<string, ReturnType<typeof listEffects>[number]>; claims: Map<string, ReturnType<typeof listClaims>[number]>; products: Map<string, ReturnType<typeof listProducts>[number]> } | null = null
  return (effectId, text) => {
    maps ??= {
      effects: new Map(listEffects(state).map((effect) => [effect.id, effect])),
      claims: new Map(listClaims(state).map((claim) => [claim.id, claim])),
      products: new Map(listProducts(state).map((product) => [product.key, product])),
    }
    const effect = maps.effects.get(effectId)
    if (effect === undefined || effect.kind !== 'POST_THANKS' || !text.endsWith(NAME_TAIL)) return text
    const claim = maps.claims.get(effect.claim)
    if (claim === undefined || claim.price === null) return text
    const product = maps.products.get(claim.product)
    if (product === undefined) return text
    for (const no of new Set([product.no, claim.no])) {
      const values = { no, name: product.name, price: claim.price, optionText: claim.variant, qty: claim.qty }
      const head = formatThanksHead(values)
      if (!text.startsWith(head) || text.length < head.length + NAME_TAIL.length) continue
      const buyerName = text.slice(head.length, -NAME_TAIL.length)
      return renderThanks(template, { ...values, buyerName })
    }
    return text
  }
}

/** 지금 엔진 상태의 게시 직전 감사 글 표 (texts.ts currentThanksTexts에 양식을 입힌 것) */
export function templatedThanksTexts(state: EngineState, template: ThanksTemplate): Map<string, string> {
  const render = thanksRenderer(state, template)
  const texts = new Map<string, string>()
  for (const effect of listEffects(state)) if (effect.kind === 'POST_THANKS' && effect.text !== null) texts.set(effect.id, render(effect.id, effect.text))
  return texts
}

/** 여러 감사를 한 글로 묶을 때의 끝말 (기본 양식은 ` 구매 감사합니다`) */
export function batchSuffix(template: ThanksTemplate): string {
  return thanksTemplateSuffix(template)
}

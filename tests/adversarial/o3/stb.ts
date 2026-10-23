// D-STB-01 공용 도구 (test-domain, AC-O3-30 (1)). 테스트 파일이 아니다.
// 기본 상품 템플릿(50×20·30·40·50) 날짜 칸이 x 292→290 · 폭 88→90으로 바뀌었다(D-STB-01).
// - revertedLabel: 지금 @livejjim/label에서 그 두 값만 옛 값으로 되돌린 기본 템플릿을 쓰는 모듈 — BASE 고정값을 그대로 맞춘다.
// - 새 기본 템플릿으로 달라진 상품 라벨 그림 해시만 fixtures/base-strict-stb.json(gen-stb.ts)에 새 고정값으로 더한다.
import type * as LabelModule from '@livejjim/label'

export const STB_DATE_SIZES: readonly string[] = ['50x20', '50x30', '50x40', '50x50']
export const STB_DATE_BOX = { now: { x: 290, width: 90 }, before: { x: 292, width: 88 } } as const

/** 씨앗 → 찜 ID → 새 상품 라벨 그림 해시 */
export type StbFixture = Record<string, Record<string, string>>

/** 지금 라벨 모듈에서 기본 상품 템플릿 날짜 칸 두 값만 옛 값으로 되돌린다. 지금 값이 D-STB-01 값이 아니면 던진다 */
export function revertedLabel(label: typeof LabelModule): typeof LabelModule {
  const defaultTemplate = ((kind: 'product' | 'packing', size?: LabelModule.LabelSizeId) => {
    const t = label.defaultTemplate(kind, size)
    if (t.kind !== 'product' || !STB_DATE_SIZES.includes(t.size)) return t
    const date = t.items.date
    if (date.x !== STB_DATE_BOX.now.x || date.width !== STB_DATE_BOX.now.width) throw new Error(`${t.size} 날짜 칸이 D-STB-01 값이 아니다`)
    return { ...t, items: { ...t.items, date: { ...date, ...STB_DATE_BOX.before } } }
  }) as typeof label.defaultTemplate
  return { ...label, defaultTemplate }
}

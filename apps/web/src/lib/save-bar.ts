// 설정 화면 아래 저장 막대 하나 (FB1 D-FB1-06, AC-FB1-22~25, SPEC §7 화면 8).
// 맡는 칸: 가게 · 판매 규칙 · 배송비 · 구매 감사 메시지(만들기) · 택배 · 손님 관리(CRM1 D-CRM1-05). 연결·동의·켜기처럼 누르면 바로 되는 칸은 맡지 않는다.
// 요청은 지금 API를 차례로: 가게(PUT /api/shop) → 판매 규칙·배송비·만들기의 바뀐 키를 한 번의 PATCH /api/settings → 택배(PUT /api/parcels/settings)
// → 손님 관리(PUT /api/customer-settings).
// 하나가 실패해도 나머지는 보낸다. 각 칸 묶음(단계)이 자기 바뀐 칸과 보내기를 알린다(registerStep).
import { createContext, useContext, useEffect, useRef } from 'react'

/** 막대가 맡는 칸 이름 (화면 순서) */
export const SAVE_BLOCKS = ['가게', '판매 규칙', '배송비', '구매 감사 메시지', '택배', '손님 관리'] as const
export type SaveBlock = (typeof SAVE_BLOCKS)[number]

/** 단계 (요청 차례): 가게 → 설정 하나 → 택배 → 손님 관리 */
export const SAVE_STEPS = ['shop', 'settings', 'parcel', 'customers'] as const
export type SaveStepId = (typeof SAVE_STEPS)[number]

export const NOTHING_CHANGED = '바꾼 칸이 없어요.'
export const SAVE_LABEL = '저장'
export const SAVING_LABEL = '저장하는 중…'
export const SAVED_ALL = '저장했어요.'
export const SAVED_RULES_SUFFIX = ' 바꾼 규칙은 다음에 시작하는 라이브부터 적용돼요.'
export const SAVED_SHIPPING_SUFFIX = ' 오늘 라이브를 이미 시작했으면 배송비는 내일부터 적용돼요.'

export interface StepResult {
  /** 저장한 칸 */
  readonly saved: readonly SaveBlock[]
  /** 저장하지 못한 칸 (값은 그대로 남는다) */
  readonly failed: readonly SaveBlock[]
}

export interface SaveStep {
  /** 저장하지 않은 칸 (화면 순서) */
  readonly dirty: readonly SaveBlock[]
  /** 보낸다 (바뀐 것이 없으면 요청 없이 빈 결과) */
  readonly save: () => Promise<StepResult>
}

/** 칸 묶음이 자기 단계를 알린다 (null이면 뺀다) */
export type RegisterStep = (id: SaveStepId, step: SaveStep | null) => void

export const SaveBarContext = createContext<RegisterStep | null>(null)

/** 화면 순서로 줄 세운다 (같은 이름은 한 번) */
export function orderBlocks(names: Iterable<SaveBlock>): SaveBlock[] {
  const set = new Set(names)
  return SAVE_BLOCKS.filter((name) => set.has(name))
}

/** "저장하지 않은 칸: 판매 규칙 · 택배" (없으면 "바꾼 칸이 없어요.") */
export function dirtyLine(names: readonly SaveBlock[]): string {
  return names.length === 0 ? NOTHING_CHANGED : `저장하지 않은 칸: ${orderBlocks(names).join(' · ')}`
}

/** 모두 성공한 뒤의 문장: "저장했어요." + 규칙(판매 규칙·만들기)·배송비 안내 */
export function savedMessage(saved: readonly SaveBlock[]): string {
  const rules = saved.includes('판매 규칙') || saved.includes('구매 감사 메시지')
  const shipping = saved.includes('배송비')
  return `${SAVED_ALL}${rules ? SAVED_RULES_SUFFIX : ''}${shipping ? SAVED_SHIPPING_SUFFIX : ''}`
}

/**
 * "저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요. 저장한 칸: 택배." (FB1 D-FB1-18 (d)) —
 * 저장한 칸이 없으면 앞 두 문장만, 둘 이상이면 화면 순서로 " · "
 */
export function failedMessage(failed: readonly SaveBlock[], saved: readonly SaveBlock[] = []): string {
  const head = `저장하지 못한 칸이 있어요: ${orderBlocks(failed).join(' · ')}. 빨간 글을 확인해 주세요.`
  return saved.length === 0 ? head : `${head} 저장한 칸: ${orderBlocks(saved).join(' · ')}.`
}

/** 단계들을 차례로 보낸다 (하나가 실패해도 다음 단계는 보낸다) */
export async function runSteps(steps: Partial<Record<SaveStepId, SaveStep>>): Promise<StepResult> {
  const saved: SaveBlock[] = []
  const failed: SaveBlock[] = []
  for (const id of SAVE_STEPS) {
    const step = steps[id]
    if (step === undefined || step.dirty.length === 0) continue
    try {
      const result = await step.save()
      saved.push(...result.saved)
      failed.push(...result.failed)
    } catch {
      // 단계가 던지면(예상 밖의 오류) 그 단계의 칸은 저장하지 못한 것으로 — 다음 단계는 그대로 보낸다
      failed.push(...step.dirty)
    }
  }
  return { saved: orderBlocks(saved), failed: orderBlocks(failed) }
}

/**
 * 칸 묶음 하나가 저장 막대에 자기 단계를 알린다. 바뀐 칸이 달라질 때만 다시 알리고, 보내기는 늘 마지막 그림의 함수를 부른다.
 * 저장 막대 밖(시작 마법사 등)에서는 아무 일도 하지 않는다.
 */
export function useSaveStep(id: SaveStepId, dirty: readonly SaveBlock[], save: () => Promise<StepResult>): void {
  const register = useContext(SaveBarContext)
  const saveRef = useRef(save)
  saveRef.current = save
  const key = dirty.join('|')
  useEffect(() => {
    if (register === null) return
    const names = key === '' ? [] : (key.split('|') as SaveBlock[])
    register(id, { dirty: names, save: () => saveRef.current() })
  }, [register, id, key])
  useEffect(() => {
    if (register === null) return
    return () => register(id, null)
  }, [register, id])
}

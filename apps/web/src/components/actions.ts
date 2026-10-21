// 사유가 필요한 방송자 조치 열기 (AC-S05-34): 사유 창 → 5초 대기 조치. 서버가 사유를 거절하면(휴대폰 번호 등)
// 같은 창을 친 사유와 서버 문장으로 다시 연다(D-079 ⑥) — 판매자가 치는 중이면 되돌리기 띠의 "사유 고치기"로.
import type { ApiError } from '../api/client.ts'
import type { Claim, Product } from '../api/types.ts'
import { claimOptionWords, claimOptionsField } from '../lib/derive.ts'
import { productLabel, type ConsoleApi } from './console-context.ts'

export interface ReasonActionInput {
  readonly title: string
  readonly submitLabel: string
  readonly warning?: string
  /** 되돌리기 띠의 이름 ("15번 홍길동 취소") */
  readonly label: string
  readonly claims?: readonly string[]
  readonly products?: readonly string[]
  readonly build: (reason: string) => Readonly<Record<string, unknown>>
}

export function openReasonAction(api: ConsoleApi, input: ReasonActionInput, initialReason?: string, error?: ApiError | null): void {
  api.openDialog({
    kind: 'reason',
    spec: {
      title: input.title,
      submitLabel: input.submitLabel,
      ...(input.warning === undefined ? {} : { warning: input.warning }),
      ...(initialReason === undefined ? {} : { initialReason }),
      ...(error === undefined ? {} : { error }),
      onSubmit: (reason) => {
        api.queueHost({
          label: input.label,
          event: input.build(reason),
          ...(input.claims === undefined ? {} : { claims: input.claims }),
          ...(input.products === undefined ? {} : { products: input.products }),
          reopen: { label: '사유 고치기', open: (rejected) => openReasonAction(api, input, reason, rejected) },
        })
        api.closeAll()
      },
    },
  })
}

/** 찜 조치의 낱말: 되돌리기 띠·창 제목의 낱말과 보내기 버튼의 동사 (AC-S06-60) */
export const CLAIM_ACTION_WORDS = {
  'host.cancel': { word: '취소', verb: '찜 취소하기' },
  'host.reject': { word: '무효', verb: '무효로 하기' },
  'host.promote': { word: '1등으로', verb: '1등으로 올리기' },
} as const

/** 찜 하나에 대한 사유 필수 조치: 취소(host.cancel) · 무효(host.reject) · 1등으로(host.promote) */
export function openClaimAction(api: ConsoleApi, claim: Claim, type: 'host.cancel' | 'host.reject' | 'host.promote'): void {
  const { word, verb } = CLAIM_ACTION_WORDS[type]
  const name = api.names.name(claim.currentBuyer)
  const label = `${productLabel(api, claim.broadcast, claim.no)}${claimOptionWords(claim)} ${name} ${word}`
  openReasonAction(api, {
    title: label,
    submitLabel: verb,
    label,
    claims: [claim.id],
    products: [claim.product],
    // 옵션을 가진 찜은 그 변형을 함께 보낸다 — 같은 구매자의 다른 변형 찜은 그대로 (AC-O2-43)
    build: (reason) => ({ type, b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, ...claimOptionsField(claim), reason }),
  })
}

/** 차단 확인 문장 (AC-S05-34). 리허설 방송이면 다음 날짜 문장은 없다(D-081) */
export function blockWarning(rehearsal: boolean): string {
  const base = '차단하면 이 사람의 대기·보류 찜이 모두 거절되고 다시 풀어도 돌아오지 않아요. 1등 찜은 그대로예요.'
  return rehearsal ? base : `${base} 다음 날짜 방송에서도 차단돼요.`
}

/** 차단 / 차단 풀기 (host.blockBuyer·unblockBuyer — 방송 필드가 없어 날짜 범위로 보낸다) */
export function openBlockAction(api: ConsoleApi, buyer: string, block: boolean): void {
  const name = api.names.name(buyer)
  const word = block ? '차단' : '차단 풀기'
  openReasonAction(api, {
    title: `${name} ${word}`,
    submitLabel: block ? '차단하기' : '차단 풀기',
    ...(block ? { warning: blockWarning(api.rehearsal) } : {}),
    label: `${name} ${word}`,
    build: (reason) => ({ type: block ? 'host.blockBuyer' : 'host.unblockBuyer', buyer, reason }),
  })
}

/** 대기자 정리하고 다시 판매 (host.reopen, 사유 필수, AC-S05-33) */
export function openReopenAction(api: ConsoleApi, product: Product): void {
  const label = `${productLabel(api, product.broadcast, product.no)} 다시 판매(대기자 정리)`
  openReasonAction(api, {
    title: label,
    submitLabel: '다시 판매하기',
    warning: `대기자 ${String(product.waitlist.length)}명이 모두 정리돼요`,
    label,
    products: [product.key],
    build: (reason) => ({ type: 'host.reopen', b: product.broadcast, no: product.no, reason }),
  })
}

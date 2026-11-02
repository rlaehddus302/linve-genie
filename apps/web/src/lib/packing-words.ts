// 포장 상태 말·색 (D-102) — 무거운 모듈을 끌어오지 않는 조각(앱 택배 화면이 parcel-words로 같이 쓴다, D-APPX-01).
import type { PackingWord } from '../api/types.ts'

/** 상태 말의 뜻 (D-102): 포장 대기 = 보통, 포장 완료·배송 완료 = 성공, 포장 다시 확인·배송 뒤 바뀜 = 주의 */
export const PACKING_TONE: Readonly<Record<PackingWord, 'info' | 'success' | 'warning'>> = {
  '포장 대기': 'info',
  '포장 완료': 'success',
  '배송 완료': 'success',
  '포장 다시 확인': 'warning',
  '배송 뒤 바뀜': 'warning',
}

/** 품목이 포장 때와 달라진 상태 (목록 맨 앞에 둔다) */
export function isChanged(status: PackingWord): boolean {
  return status === '포장 다시 확인' || status === '배송 뒤 바뀜'
}

/** 상태 말 + 송장번호 ("배송 완료 · 송장 123456789012") */
export function packingWords(status: PackingWord, invoice: string | null): string {
  return (status === '배송 완료' || status === '배송 뒤 바뀜') && invoice !== null ? `${status} · 송장 ${invoice}` : status
}

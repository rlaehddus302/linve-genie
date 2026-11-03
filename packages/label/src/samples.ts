// 견본·최악값 라벨 데이터 (AC-I1-25·26) — 웹 라벨 설정 미리 보기와 서버 초안 미리 보기(D-UX3-19)가 같은 값을 쓴다.
import type { ProductLabelData } from './data.ts'

/** 판매자 샘플 라벨 (194번 · 왕비뇌신금 · 8,000원 · 26.10.08 · 우주천사) */
export const SAMPLE_PRODUCT: ProductLabelData = { no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } }
/** 가장 넓은 날짜: 2000~2099의 모든 YY.MM.DD 중 내장 글꼴로 가장 넓은 `04.04.04` (L-11 13, D-STB-01) */
export const WIDEST_DATE = '2004-04-04'
/** 가장 긴 값 (번호 9999 · 가격 99,999,999원 · 날짜 04.04.04 · 긴 품종·닉네임) */
export const LONGEST_PRODUCT: ProductLabelData = {
  no: 9999,
  // 음성 기본 사전의 표지 낱말('블루엘프')은 넣지 않는다 — 첫 화면 JS에 음성 사전이 없는지 그 낱말로 확인한다(AC-I4-10)
  name: '아주 긴 이름의 다육식물 품종명 핑크프릴 왕비뇌신금 금황환 미니마 라즈베리아이스',
  price: 99_999_999,
  date: WIDEST_DATE,
  buyer: { kind: 'youtube', name: '다육이사랑하는우주천사님반가워요길고긴닉네임' },
}

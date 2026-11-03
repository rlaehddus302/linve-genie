// 앱 화면의 라벨 예시 (D-UX4-03, 사용자 지시 2026-11-03 "이 예시는 뒤에도 써줘"): 라벨 단계 그림·안내에 늘 이 값을 쓴다.
// 서버가 그리는 미리 보기의 견본 값(packages/label SAMPLE_PRODUCT)도 같은 값이다 (D-UX4-07 — 시험이 둘이 같은지 본다).

export const EXAMPLE_LABEL = {
  shop: '라이브다육',
  date: '26.11.03',
  no: 365,
  price: '30만원',
  name: '삼광색금',
  buyer: '지니다육',
} as const

/** 라벨 그림의 줄 (가게 이름은 양쪽에 줄표 — 실제 라벨과 같은 모양) */
export const EXAMPLE_LINES = {
  shop: `-${EXAMPLE_LABEL.shop}-`,
  number: `번호: ${String(EXAMPLE_LABEL.no)}`,
  price: `가격: ${EXAMPLE_LABEL.price}`,
  date: EXAMPLE_LABEL.date,
  name: `품종: ${EXAMPLE_LABEL.name}`,
  buyer: `닉네임: ${EXAMPLE_LABEL.buyer}`,
} as const

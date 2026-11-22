// 라벨 패키지의 오류 코드와 화면 문장 (UX-01·UX-03, AC-P1-04·14·20·32·62).
// 화면에 그대로 쓰는 쉬운 한국어다. 오류에는 값(닉네임·메모·전화번호 같은 라벨 내용)을 담지 않는다.

export type LabelErrorCode = 'INVALID_DATA' | 'INVALID_TEMPLATE' | 'DOES_NOT_FIT' | 'MIXED_SIZES' | 'NO_LABELS' | 'INVALID_IMAGE'

export interface TemplateProblem {
  /** 문제가 있는 곳 (예: `items.number.visible`, `size`) — 개발용 위치, 화면에는 message를 쓴다 */
  readonly path: string
  /** 쉬운 한국어 한 문장 */
  readonly message: string
}

export interface LabelError {
  readonly code: LabelErrorCode
  /** 화면에 보일 쉬운 한국어 문장 */
  readonly message: string
  /** INVALID_DATA: 어느 칸인지 (예: `no`, `buyer.memo`) */
  readonly field?: string
  /** DOES_NOT_FIT: 어느 항목인지 */
  readonly item?: string
  /** INVALID_TEMPLATE: 문제 목록 */
  readonly problems?: readonly TemplateProblem[]
}

export type LabelResult<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: LabelError }

/** 항목 이름 (화면 문장용) */
export const ITEM_NAMES: Readonly<Record<string, string>> = {
  shop: '가게 이름',
  number: '번호',
  price: '가격',
  date: '날짜',
  time: '시간',
  name: '품종',
  buyer: '구매자',
  page: '쪽 표시',
  broadcast: '방송 제목',
  count: '상품 수',
  subtotal: '상품 합계',
  numbers: '번호 목록',
  title: '라벨 제목',
  check: '한글 확인',
  digits: '숫자 확인',
}

/** 라벨 데이터 칸 이름 (INVALID_DATA 문장용) */
const DATA_FIELD_NAMES: Readonly<Record<string, string>> = {
  no: '번호',
  name: '품종',
  price: '가격',
  date: '날짜',
  buyer: '구매자',
  broadcasts: '방송',
  subtotal: '상품 합계',
  variant: '옵션',
  qty: '수량',
  time: '시간',
}

export const LABEL_MESSAGES = {
  /** INVALID_DATA 문장의 앞부분. 뒤에 칸 이름이 붙는다 — "라벨에 넣을 수 없는 값이 있어요: 번호" */
  invalidDataPrefix: '라벨에 넣을 수 없는 값이 있어요: ',
  unknownField: '알 수 없는 칸',
  labelData: '라벨 데이터',
  invalidTemplate: '라벨 설정에 고칠 곳이 있어요.',
  mixedSizes: '크기가 다른 라벨은 한 PDF에 넣을 수 없어요. 같은 크기끼리 모아 주세요.',
  noLabels: 'PDF에 넣을 라벨이 없어요.',
  invalidImage: '라벨 그림을 읽을 수 없어요. 라벨을 다시 만들어 주세요.',
} as const

/** "가격 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요." */
export function doesNotFitMessage(item: string): string {
  return `${ITEM_NAMES[item] ?? item} 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.`
}

export function invalidDataError(field: string): LabelError {
  const top = field.split('.')[0] ?? field
  const name = field === '' ? LABEL_MESSAGES.labelData : (DATA_FIELD_NAMES[top] ?? LABEL_MESSAGES.unknownField)
  return { code: 'INVALID_DATA', message: `${LABEL_MESSAGES.invalidDataPrefix}${name}`, field }
}

export function doesNotFitError(item: string): LabelError {
  return { code: 'DOES_NOT_FIT', message: doesNotFitMessage(item), item }
}

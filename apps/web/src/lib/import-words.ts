// 상품 목록 가져오기 낱말·줄 문제 문장 (PRD-05, AC-I2-52) — 웹 ImportDialog와 앱 ImportSheet가 같이 쓴다 (D-V3-128).
import type { ImportRowError } from '../api/types.ts'

export const IMPORT_GUIDE = '엑셀에서 번호·품종·가격 세 칸을 복사해 붙여 넣거나 파일을 골라 주세요.'
export const IMPORT_CHANGED = '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.'
export const IMPORT_EMPTY = '가져올 상품이 없어요.'
export const IMPORT_TOO_MANY = '한 번에 500개까지 가져올 수 있어요.'
/** 파일 크기 상한 (서버와 같은 2MB — 큰 파일은 올리기 전에 막는다) */
export const IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024
export const IMPORT_FILE_TOO_LARGE = '파일이 너무 커요(2MB까지).'
/** 옵션 방송의 가져오기 안내 (D-O2-15) — 가져오기는 옵션 없이 등록한다 */
export const IMPORT_OPTIONS_NOTE = "옵션은 가져온 뒤 상품마다 '옵션 고치기'로 넣어 주세요 — 찜이 들어오기 전에요."

/** 줄 문제의 말 (AC-I2-52) — 번호 범위는 그 방송의 최대 번호 */
export function importProblemWords(error: ImportRowError, maxNumber: number): string {
  switch (error) {
    case 'CELLS':
      return '번호, 품종, 가격 세 칸이 필요해요.'
    case 'NUMBER_INVALID':
      return `번호를 확인해 주세요(1~${String(maxNumber)}).`
    case 'DUPLICATE':
      return '목록에 같은 번호가 또 있어요.'
    case 'EXISTS':
      return '이 방송에 이미 있는 번호예요.'
    case 'NAME_CONTROL':
      return '품종에 보이지 않는 글자가 있어요. 품종을 다시 적어 주세요.'
    case 'NAME_PHONE':
      return '품종에 전화번호처럼 보이는 숫자가 있어요.'
    case 'PRICE_MISSING':
      return '가격이 비었어요.'
    case 'PRICE_INVALID':
      return '가격을 읽지 못했어요.'
    case 'PRICE_TOO_LOW':
      return '가격이 100원보다 적어요.'
  }
}

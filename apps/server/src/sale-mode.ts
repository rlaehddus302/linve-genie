// 아직 쓸 수 없는 판매 방식 (O1, RA-O1-01).
// 옵션 방송(claim.parseMode=OPTIONS — 상품명·옵션도 받기, R-19·R-20)은 O1에서 코어만 안다. 서버·화면·라벨은 아직 옵션·수량을 모르므로
// (변형 키·수량·확인 필요 목록을 보여 주거나 적지 못한다) 판매자가 고르면 방송 중 판매 기록을 바르게 다룰 수 없다.
// 그래서 O2가 들어오기 전까지 서버 입구 세 곳에서 막는다 — 판매 규칙 설정 저장, 백업 복원(파일의 설정·방송 스냅샷), 방송 만들기.
// 코어는 그대로 둔다(골든·적대 시험이 옵션 방송을 계속 돌린다).
// O2에서 풂: 이 파일과 부르는 곳(service.ts updateSettings·createBroadcast, backup.ts walkBackup·ScopeReplay)을 함께 뺀다.

/** 아직 쓸 수 없는 claim.parseMode 값 (O2에서 풂) */
export const NOT_YET_PARSE_MODES: readonly string[] = ['OPTIONS']

/** 거절 문장 (쉬운 한국어) */
export const SALE_MODE_NOT_YET_MESSAGE = '아직 쓸 수 없는 판매 방식이에요.'
/** 칸 문제 문장 */
export const SALE_MODE_NOT_YET_FIELD_MESSAGE = '아직 쓸 수 없어요. 엄격하게나 느슨하게 중에서 골라 주세요.'
/** 백업 복원 거절 문장 */
export const SALE_MODE_NOT_YET_BACKUP_MESSAGE = '백업 파일에 아직 쓸 수 없는 판매 방식이 있어요.'

/** 설정(일부·전체·방송 스냅샷)이 아직 쓸 수 없는 판매 방식을 쓰는가. 자기 속성만 본다 */
export function usesNotYetSaleMode(settings: object): boolean {
  if (!Object.hasOwn(settings, 'claim.parseMode')) return false
  const mode: unknown = (settings as Readonly<Record<string, unknown>>)['claim.parseMode']
  return typeof mode === 'string' && NOT_YET_PARSE_MODES.includes(mode)
}

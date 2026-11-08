// 앱 안 웹 화면 로그인 세션 지키기 — JS에 보이는 모양 (EP1 D-EP1-17). 쿠키 값은 JS로 오지 않는다(개수만).
export interface WebSession {
  /** 그 도메인의 세션 쿠키를 기기 키체인에 둔다 → 둔 개수 */
  save(domain: string): Promise<number>
  /** 둔 지 maxAgeSeconds가 지나지 않았으면 다시 넣는다 → 넣은 개수 */
  restore(domain: string, maxAgeSeconds: number): Promise<number>
  /** 둔 것을 지운다 */
  clear(domain: string): Promise<void>
}

export const NATIVE_MODULE_NAME = 'LivejjimWebSession'

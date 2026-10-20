// 판매자 동의 확인 자리 (D-904 "판매자가 위험 고지를 읽고 명시적으로 켤 때만", D-N2b-1-06, AC-N2b-1-41).
// 동의 기록은 N2b-2가 만든다. 여기서는 인터페이스와 기본 구현(모두 거절)만 둔다.

/**
 * 판매자 ID → 허용 여부 (비동기). 정확히 `true`일 때만 허용이다.
 * 거절·예외·거부·20초 안에 끝나지 않음은 모두 동의 없음으로 본다(연결 객체가 처리한다).
 */
export type TikTokConsentCheck = (sellerId: string) => Promise<boolean>

/** 기본 구현: 어떤 판매자에게도 거절 */
export const denyAllTikTokConsent: TikTokConsentCheck = () => Promise.resolve(false)

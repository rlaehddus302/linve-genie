// 테스트 단계(test·golden·adversarial·coverage)의 고정 시간대 (D-026).
// KST도 UTC도 아닌 시간대로 고정해, 어느 쪽을 가정한 코드든 드러나게 한다.
export const TEST_TIME_ZONE = 'Pacific/Honolulu'

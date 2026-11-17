// 라이브 화면 아래 떠 있는 것들의 자리 (D-FLOATLEFT-01, 사용자 지시 2026-11-17 "+, 프린트 버튼 등 원래 있던 플로팅 아이콘은 맨 왼쪽으로 옮겨줘.
// 그래서 현재 매출, 오류 문구 등의 크기를 다 통일하는거지."):
// - 둥근 단추((+)·인쇄)는 왼쪽 아래. 캡슐(현재 매출·손님별 합계·오류 알림)은 오른쪽에 같은 높이·같은 글 크기로 쌓인다.
// - 맨 아래 캡슐은 둥근 단추와 위아래 가운데를 맞춘다.
import { SPACE } from '../../ui/kit/tokens.ts'

/** 둥근 단추((+)·인쇄) 지름 */
export const FAB_SIZE = 58
/** 캡슐 높이 — 매출·합계·오류 알림 모두 같다 */
export const FLOAT_PILL_HEIGHT = 48
/** 캡슐 사이 */
export const FLOAT_PILL_GAP = SPACE.sm
/** 맨 아래 캡슐의 아래 자리 (둥근 단추 아래 자리 → 그 단추와 위아래 가운데) */
export const pillBottom = (fabBottom: number): number => fabBottom + (FAB_SIZE - FLOAT_PILL_HEIGHT) / 2

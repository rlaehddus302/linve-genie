// 손글씨 읽기 — JS에 보이는 모양 (D-HANDWRITE-02). 획은 휴대폰 안에서만 읽는다(서버로 보내지 않는다).
/** 획 하나: [x0, y0, t0, x1, y1, t1, …] — 쓰는 판 안 자리(점)와 시각(ms) */
export type FlatStroke = readonly number[]

export interface InkNative {
  /** 그 말을 읽을 준비 (안드로이드는 처음 한 번 모델을 받는다) → 읽을 수 있으면 true */
  prepare(language: string): Promise<boolean>
  /** 쓴 획을 읽는다 → 후보 글 (가장 그럴듯한 것부터). hints: 자주 쓰는 말(품종 이름) — 아이폰이 맞춤법 고칠 때 참고 */
  recognize(strokes: readonly FlatStroke[], width: number, height: number, language: string, hints: readonly string[]): Promise<string[]>
}

export const NATIVE_MODULE_NAME = 'LivejjimInk'

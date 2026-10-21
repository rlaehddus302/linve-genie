// BASE 코어(O1 전, harness/sprints/O1/BASE)의 parseChat 결과 기록을 만든다 (AC-O1-03 적대 — STRICT·LOOSE 회귀 비교용).
// 쓰는 법: BASE의 packages/core/src를 따로 풀어 그 경로를 첫 인자로 준다.
//   git archive $(cat harness/sprints/O1/BASE) packages/core/src | tar -x -C <임시 폴더>
//   node tests/adversarial/o1/fixtures/make-parse-chat-base.ts <임시 폴더>/packages/core/src > tests/adversarial/o1/fixtures/parse-chat-base.json
// 글은 고정 시드 의사 난수로 만든다(시험 쪽 도구 — 코어 순수성 규칙과 상관없다).
const src = process.argv[2]
if (src === undefined) throw new Error('BASE packages/core/src 경로를 주세요')
const { parseChat } = (await import(`${src}/parser.ts`)) as { parseChat: (text: string, settings: Record<string, unknown>) => unknown }

let seed = 20261022
const rand = (n: number): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return (((t ^ (t >>> 14)) >>> 0) % n)
}
const PIECES = [
  '15', '7', '021', '1000', '99999', '3', '15번', '번', ' ', '  ', ',', '/', '·', '찜', '요', '주세요', '취소', '취소요', '구매', '할게요',
  '!', '~', '.', 'ㅎㅎ', 'ㅋ', '👍', '❤️', '🙏🏻', '?', '？', '１５', '12,000', '1.5', '반바지', 'M', '엠', '흰색', '대형', '2개', '세개', '초코 과자',
  '\n', '\t', '​', '﻿', '<b>', '</b>', '010-1234-5678', '이요', '님', '저', '15,28,31', '0', '00', '9999',
]
const SETTINGS = [
  { 'claim.parseMode': 'STRICT' },
  { 'claim.parseMode': 'LOOSE' },
  { 'claim.parseMode': 'STRICT', 'claim.multiNumber': 'FIRST' },
  { 'claim.parseMode': 'LOOSE', 'claim.multiNumber': 'IGNORE' },
  { 'claim.parseMode': 'STRICT', 'claim.maxNumber': 50 },
]
const cases: { text: string; settings: Record<string, unknown>; out: unknown }[] = []
for (let i = 0; i < 2500; i++) {
  const count = 1 + rand(5)
  let text = ''
  for (let j = 0; j < count; j++) text += PIECES[rand(PIECES.length)]
  const settings = SETTINGS[i % SETTINGS.length] as Record<string, unknown>
  cases.push({ text, settings, out: parseChat(text, settings) })
}
process.stdout.write(`${JSON.stringify({ base: 'harness/sprints/O1/BASE', cases })}\n`)

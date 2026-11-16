// 손글씨 숫자 읽기 (D-HANDWRITE-01): 방송 중 휴대폰을 책상에 눕혀 두면 자판보다 손가락으로 쓰는 편이 쉽다.
// 휴대폰 안에서만 읽는다 — 서버·인터넷·네이티브 모듈 없이 바로(한 글자 1ms 안팎), 아이폰·갤럭시가 같은 코드.
// - 글자 나누기: 획을 쓴 차례대로 보고, 가로로 많이 겹치는 획은 한 글자(4·5·7의 둘째 획), 아니면 새 글자. 왼쪽부터 읽는다.
// - 글자 읽기: $P 점 구름 맞추기(Vatavu·Anthony·Wobbrock 2012) — 획 차례·방향·개수와 상관없이 모양만 본다. 기본 모양(handwriting-templates.ts)
//   + 판매자가 고친 글씨(이 휴대폰에만, 숫자마다 몇 개)와 비교해 가장 가까운 숫자.
// - 후보: 가장 그럴듯한 글 하나 + 덜 확실한 자리를 둘째 숫자로 바꾼 글 몇 개.
// 순수 함수 — 시계·난수·저장소를 쓰지 않는다(저장은 handwriting-store.ts).

export interface InkPoint {
  readonly x: number
  readonly y: number
}
export type InkStroke = readonly InkPoint[]

/** 비교용 점 구름 한 점 (id = 몇 번째 획) */
interface CloudPoint {
  readonly x: number
  readonly y: number
  readonly id: number
}

/** 정규화한 모양 하나: 이 숫자(digit)를 이렇게 쓴다 */
export interface DigitTemplate {
  readonly digit: string
  readonly cloud: readonly CloudPoint[]
}

/** 점 구름의 점 수 — $P 논문 기본값 32 */
export const CLOUD_SIZE = 32

/** 너무 짧아 글씨가 아닌 획(살짝 닿음)의 길이 — 쓰는 칸 높이에 대한 비율. 그보다 짧고 점 몇 개뿐이면 버린다 */
export const TAP_STROKE_RATIO = 0.035

const dist = (a: InkPoint, b: InkPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function strokeLength(stroke: InkStroke): number {
  let total = 0
  for (let i = 1; i < stroke.length; i += 1) total += dist(stroke[i - 1] as InkPoint, stroke[i] as InkPoint)
  return total
}

/** 획들을 CLOUD_SIZE 점으로 고르게 다시 찍는다(획 사이는 잇지 않는다). 점 하나짜리 획도 받는다 */
function resample(strokes: readonly InkStroke[], n: number): CloudPoint[] {
  const points: CloudPoint[] = []
  strokes.forEach((stroke, id) => {
    for (const point of stroke) points.push({ x: point.x, y: point.y, id })
  })
  if (points.length === 0) return []
  const total = strokes.reduce((sum, stroke) => sum + strokeLength(stroke), 0)
  if (total === 0) return Array.from({ length: n }, () => ({ ...(points[0] as CloudPoint) }))
  const step = total / (n - 1)
  let gap = 0
  const out: CloudPoint[] = [points[0] as CloudPoint]
  const pts = [...points]
  for (let i = 1; i < pts.length; i += 1) {
    const prev = pts[i - 1] as CloudPoint
    const cur = pts[i] as CloudPoint
    if (cur.id !== prev.id) continue
    const d = dist(prev, cur)
    if (gap + d >= step && d > 0) {
      const t = (step - gap) / d
      const q: CloudPoint = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y), id: cur.id }
      out.push(q)
      pts.splice(i, 0, q)
      gap = 0
    } else {
      gap += d
    }
  }
  while (out.length < n) out.push({ ...(pts[pts.length - 1] as CloudPoint) })
  return out.slice(0, n)
}

/** 크기를 1로(가로세로 비율은 그대로), 무게중심을 0으로 */
function normalize(cloud: readonly CloudPoint[]): CloudPoint[] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of cloud) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1
  const scaled = cloud.map((p) => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, id: p.id }))
  const cx = scaled.reduce((sum, p) => sum + p.x, 0) / scaled.length
  const cy = scaled.reduce((sum, p) => sum + p.y, 0) / scaled.length
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }))
}

/** 획들 → 비교용 점 구름 */
export function toCloud(strokes: readonly InkStroke[]): CloudPoint[] {
  const kept = strokes.filter((stroke) => stroke.length > 0)
  return kept.length === 0 ? [] : normalize(resample(kept, CLOUD_SIZE))
}

export function makeTemplate(digit: string, strokes: readonly InkStroke[]): DigitTemplate {
  return { digit, cloud: toCloud(strokes) }
}

function cloudDistance(points: readonly CloudPoint[], template: readonly CloudPoint[], start: number): number {
  const n = points.length
  const matched = new Array<boolean>(n).fill(false)
  let sum = 0
  let i = start
  do {
    let min = Infinity
    let index = -1
    const p = points[i] as CloudPoint
    for (let j = 0; j < n; j += 1) {
      if (matched[j] === true) continue
      const q = template[j] as CloudPoint
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
      if (d < min) {
        min = d
        index = j
      }
    }
    matched[index] = true
    const weight = 1 - ((i - start + n) % n) / n
    sum += weight * Math.sqrt(min)
    i = (i + 1) % n
  } while (i !== start)
  return sum
}

/** $P 욕심 맞추기: 작을수록 닮았다 */
export function cloudMatch(points: readonly CloudPoint[], template: readonly CloudPoint[]): number {
  const n = points.length
  if (n === 0 || template.length !== n) return Infinity
  const step = Math.max(1, Math.floor(Math.sqrt(n)))
  let best = Infinity
  for (let i = 0; i < n; i += step) best = Math.min(best, cloudDistance(points, template, i), cloudDistance(template, points, i))
  return best
}

/** 한 글자 자리의 숫자별 거리 (가까운 순) */
export interface DigitGuess {
  readonly digit: string
  readonly distance: number
}

/** 한 글자(획 묶음)를 읽는다: 숫자마다 가장 가까운 모양의 거리, 가까운 순 */
export function rankDigit(strokes: readonly InkStroke[], templates: readonly DigitTemplate[]): DigitGuess[] {
  const cloud = toCloud(strokes)
  const best = new Map<string, number>()
  for (const template of templates) {
    const d = cloudMatch(cloud, template.cloud)
    if (d < (best.get(template.digit) ?? Infinity)) best.set(template.digit, d)
  }
  return [...best.entries()].map(([digit, distance]) => ({ digit, distance })).sort((a, b) => a.distance - b.distance || a.digit.localeCompare(b.digit))
}

interface Box {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function boxOf(strokes: readonly InkStroke[]): Box {
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const stroke of strokes)
    for (const p of stroke) {
      left = Math.min(left, p.x)
      right = Math.max(right, p.x)
      top = Math.min(top, p.y)
      bottom = Math.max(bottom, p.y)
    }
  return { left, right, top, bottom }
}

/** 살짝 닿은 점·아주 짧은 획을 뺀다 (쓰는 칸 높이 기준) */
export function dropTaps(strokes: readonly InkStroke[], padHeight: number): InkStroke[] {
  const min = Math.max(4, padHeight * TAP_STROKE_RATIO)
  return strokes.filter((stroke) => {
    if (stroke.length === 0) return false
    const box = boxOf([stroke])
    return strokeLength(stroke) >= min || Math.max(box.right - box.left, box.bottom - box.top) >= min
  })
}

/**
 * 획을 글자로 나눈다 (왼쪽 → 오른쪽). 쓴 차례대로 보며, 이미 있는 글자와 가로로 충분히 겹치면(좁은 쪽 폭의 35% 이상) 그 글자에 붙인다.
 * 1처럼 가는 획은 폭을 글자 높이의 15%로 쳐서 옆 글자에 잘못 붙지 않게 한다. 둘 이상과 겹치면 가장 많이 겹친 글자.
 */
export function splitCharacters(strokes: readonly InkStroke[]): InkStroke[][] {
  const kept = strokes.filter((stroke) => stroke.length > 0)
  if (kept.length === 0) return []
  const heights = kept.map((stroke) => {
    const box = boxOf([stroke])
    return box.bottom - box.top
  })
  const lineHeight = Math.max(1, ...heights)
  const minWidth = lineHeight * 0.15
  const span = (box: Box): readonly [number, number] => {
    const width = box.right - box.left
    if (width >= minWidth) return [box.left, box.right]
    const mid = (box.left + box.right) / 2
    return [mid - minWidth / 2, mid + minWidth / 2]
  }
  // 획 끝이 글자의 잉크에 닿아 있으면(9의 꼬리를 따로 그음) 겹침이 적어도 같은 글자
  const touchGap = lineHeight * 0.12
  const touches = (stroke: InkStroke, group: readonly InkStroke[]): boolean => {
    const ends = [stroke[0], stroke[stroke.length - 1]].filter((p): p is InkPoint => p !== undefined)
    return ends.some((end) => group.some((other) => other.some((p) => dist(p, end) <= touchGap)))
  }
  const groups: InkStroke[][] = []
  for (const stroke of kept) {
    const [l1, r1] = span(boxOf([stroke]))
    let bestIndex = -1
    let bestShare = 0
    groups.forEach((group, index) => {
      const [l2, r2] = span(boxOf(group))
      const overlap = Math.min(r1, r2) - Math.max(l1, l2)
      if (overlap <= 0) return
      const share = overlap / Math.min(r1 - l1, r2 - l2)
      const score = share >= 0.35 ? share : touches(stroke, group) ? 0.35 : 0
      if (score > bestShare) {
        bestShare = score
        bestIndex = index
      }
    })
    if (bestIndex >= 0 && bestShare >= 0.35) (groups[bestIndex] as InkStroke[]).push(stroke)
    else groups.push([stroke])
  }
  // 한 획이 두 글자를 이어 붙였으면(겹침으로 합쳐진 글자가 다른 글자와 다시 겹침) 한 번 더 합친다
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < groups.length; i += 1)
      for (let j = i + 1; j < groups.length; j += 1) {
        const [l1, r1] = span(boxOf(groups[i] as InkStroke[]))
        const [l2, r2] = span(boxOf(groups[j] as InkStroke[]))
        const overlap = Math.min(r1, r2) - Math.max(l1, l2)
        if (overlap > 0 && overlap / Math.min(r1 - l1, r2 - l2) >= 0.6) {
          groups[i] = [...(groups[i] as InkStroke[]), ...(groups[j] as InkStroke[])]
          groups.splice(j, 1)
          merged = true
          break outer
        }
      }
  }
  return groups.sort((a, b) => {
    const [la, ra] = span(boxOf(a))
    const [lb, rb] = span(boxOf(b))
    return (la + ra) / 2 - (lb + rb) / 2
  })
}

/** 읽은 결과: 가장 그럴듯한 글, 고를 후보(첫째가 text), 글자 자리마다 순위·획 */
export interface InkReading {
  readonly text: string
  readonly options: readonly string[]
  readonly places: readonly { readonly guesses: readonly DigitGuess[]; readonly strokes: readonly InkStroke[] }[]
}

/** 후보 수 (첫째 포함) */
export const OPTION_COUNT = 4
/** 둘째 숫자가 첫째 거리의 이 배 안이면 후보로 보인다 */
const CLOSE_RATIO = 1.6

/** 손글씨 획 → 숫자 글 + 후보 */
export function readDigits(strokes: readonly InkStroke[], templates: readonly DigitTemplate[], padHeight = 0): InkReading {
  const kept = padHeight > 0 ? dropTaps(strokes, padHeight) : strokes.filter((stroke) => stroke.length > 0)
  const places = splitCharacters(kept).map((group) => ({ guesses: rankDigit(group, templates), strokes: group }))
  const top = places.map((place) => place.guesses[0]?.digit ?? '')
  const text = top.join('')
  // 덜 확실한 자리부터: 둘째 / 첫째 거리 비가 작을수록 헷갈린다
  const swaps = places
    .map((place, index) => {
      const [first, second] = place.guesses
      if (first === undefined || second === undefined) return null
      const ratio = first.distance === 0 ? Infinity : second.distance / first.distance
      return { index, digit: second.digit, ratio }
    })
    .filter((swap): swap is { index: number; digit: string; ratio: number } => swap !== null && swap.ratio <= CLOSE_RATIO)
    .sort((a, b) => a.ratio - b.ratio)
  const options = [text]
  for (const swap of swaps) {
    if (options.length >= OPTION_COUNT) break
    const next = top.map((digit, index) => (index === swap.index ? swap.digit : digit)).join('')
    if (!options.includes(next)) options.push(next)
  }
  // 한 글자만 쓴 때는 셋째 숫자도 (자리가 하나라 바꿔 볼 곳이 적다)
  if (places.length === 1) {
    for (const guess of places[0]?.guesses.slice(1) ?? []) {
      if (options.length >= OPTION_COUNT) break
      if (!options.includes(guess.digit)) options.push(guess.digit)
    }
  }
  return { text, options: text === '' ? [] : options, places }
}

/**
 * 판매자가 후보를 골라 고쳤을 때 배울 모양: 자리 수가 같고 숫자가 다른 자리의 획을 고른 숫자의 모양으로 (자리 수가 다르면 배우지 않는다)
 */
export function correctionsOf(reading: InkReading, chosen: string): { readonly digit: string; readonly strokes: readonly InkStroke[] }[] {
  if (chosen.length !== reading.places.length || chosen === reading.text) return []
  const out: { digit: string; strokes: readonly InkStroke[] }[] = []
  reading.places.forEach((place, index) => {
    const digit = chosen[index] ?? ''
    if (/^[0-9]$/.test(digit) && digit !== reading.text[index]) out.push({ digit, strokes: place.strokes })
  })
  return out
}

/** 숫자마다 배운 모양 수 (오래된 것부터 버린다) */
export const LEARNED_PER_DIGIT = 5

/** 배운 모양 더하기 — 같은 숫자는 LEARNED_PER_DIGIT까지(새 것이 뒤) */
export function addLearned(learned: readonly DigitTemplate[], add: readonly DigitTemplate[]): DigitTemplate[] {
  let next = [...learned]
  for (const template of add) {
    if (template.cloud.length !== CLOUD_SIZE) continue
    next.push(template)
    const same = next.filter((item) => item.digit === template.digit)
    if (same.length > LEARNED_PER_DIGIT) {
      const drop = same[0]
      next = next.filter((item) => item !== drop)
    }
  }
  return next
}

/** 저장 모양: [숫자, [x, y, 획] × 32] — 소수 셋째 자리까지 */
export function packLearned(learned: readonly DigitTemplate[]): string {
  return JSON.stringify(learned.map((template) => [template.digit, template.cloud.map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, p.id])]))
}

/** 저장 값 → 배운 모양 (깨진 줄은 건너뛴다) */
export function unpackLearned(raw: string | null): DigitTemplate[] {
  if (raw === null || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: DigitTemplate[] = []
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 2) continue
    const [digit, points] = row as [unknown, unknown]
    if (typeof digit !== 'string' || !/^[0-9]$/.test(digit) || !Array.isArray(points) || points.length !== CLOUD_SIZE) continue
    const cloud: CloudPoint[] = []
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 3) break
      const [x, y, id] = point as [unknown, unknown, unknown]
      if (typeof x !== 'number' || typeof y !== 'number' || typeof id !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 2 || Math.abs(y) > 2) break
      cloud.push({ x, y, id })
    }
    if (cloud.length === CLOUD_SIZE) out.push({ digit, cloud })
  }
  return out
}

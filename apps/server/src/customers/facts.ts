// 손님 기록의 날짜별 재료 (CRM1 D-CRM1-02·D-CRM1-03·D-CRM1-04·D-CRM1-11). 판정은 하지 않는다 — 코어 조회 결과(구매자·찜 상태·정산 묶음)를 옮겨 담는다.
// - 날짜 하나 = 판매자의 실제 범위 하나. 리허설 범위는 읽지 않는다.
// - 표지 (D-CRM1-02, 지난 구매 D-I2-08과 같은 규칙): 채팅 구매자(유튜브·인스타그램 `ig:`·틱톡 `tt:`)는 구매자 키 그대로 `c:<키>`,
//   휴대폰 번호가 있는 문자 구매자는 그 구매자를 만든 문자찜의 전화번호 키 `p:<키>`(그 범위의 문자찜 이벤트 본문에서 — 응답·화면·로그에 내지 않는다).
//   전화번호 없는 문자 구매자는 표지가 없다. 음성 문자찜의 "끝자리만"(last4)·"새 손님으로 넣기"(newBuyer) 구매자도 전화번호 없는 문자 구매자다(TD-CRM1-001):
//   그 phoneKey는 전체 번호가 아니라 그날 범위·끝자리(·ref)로 만든 키(sms-last4.ts)라, 판매자 키로 같은 키를 다시 만들어 보고 같으면 표지를 주지 않는다
//   (이벤트 본문 형식을 바꾸지 않아 이미 쌓인 기록에도 맞다).
// - 묶음 = 그날 지금의 구매자(root)의 정산 묶음. items = 확정 찜 수량 합, subtotal = 코어 정산 상품 합계, payment = 코어 입금 상태,
//   cancels = 1등(확정)이었던 적이 있고(가격 스냅샷이 있다) 지금 취소·무효(방송자)인 찜 수,
//   noPay = 그중 방송자 조치(취소·무효·교체 취소)의 사유가 '입금 안 함'으로 끝난 찜 수,
//   mine = 그중 방송자 조치의 사유가 손님 패스 사유(isPassReason)가 아닌 찜 수 (D-PASS-01 — 패스 횟수 = cancels − mine).
//   사유는 엔진 상태에 없어 그 범위의 이벤트 기록을 코어 applyEvent로 다시 적용해 어느 확정 찜이 그 조치로 끝났는지 본다(사유 후보 이벤트가 있는 범위만).
// - 봉인 날짜(30일, D-PL1-04)는 봉인 장부로 다시 세운 상태로 센다(D-CRM1-02). 장부에는 끝난 찜·조치 사유가 없어,
//   그 날짜의 cancels·noPay는 봉인 전에 남긴 보관 행(archive.ts, D-CRM1-12)에서 더한다 — 같은 뿌리 구매자면 같은 묶음,
//   장부에 없는 뿌리면 보관 행만으로 기록 묶음(품목 0·상품 합계 0, archived — 그날 자세히는 열 수 없다)이 된다. 보관 행이 없으면 장부만으로 센다(지어내지 않는다).
//   장부를 읽을 수 없으면 그 날짜를 빼고 오류 로그(코드·날짜만)를 남긴다.
// - 캐시 (D-CRM1-11): (판매자, 범위 ID, 범위 seq, 봉인 여부)가 같으면 그 날짜의 재료를 다시 쓴다. 판매자·범위가 키에 들어 있어 섞이지 않는다.
//   한 범위엔 한 벌만 둔다(RA-CRM1-01): 캐시 자리 = (판매자, 범위 ID), seq·봉인 여부는 값에 — 방송 중 seq가 바뀌면 같은 자리를 덮어쓴다.
//   상한은 자리 수와 크기(구매자·묶음 수 합) 둘 다. 같은 재료를 동시에 세우는 요청은 하나의 약속을 함께 쓴다(RA-CRM1-02).
// - '입금 안 함' 찜 찾기는 범위마다 이어 센다(RA-CRM1-02): 어디까지 다시 적용했는지·찾은 찜 ID를 두고, 새 후보가 생기면 그 뒤만 적용한다.
//   이어 갈 상태가 없으면(처음·밀려남) 첫 새 후보보다 앞선 스냅샷에서 시작한다. 이벤트는 나눠 읽고, 나눌 때마다 이벤트 루프에 양보해 방송 판정과 번갈아 돈다.
import { STATE_FORMAT, applyEvent, currentBuyerOf, getBuyer, getSettlement, listBuyers, listClaims, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { customerArchiveRows, events, scopes } from '../db/schema.ts'
import type { LogSink } from '../log.ts'
import { platformOfKey, type Platform } from '../platform.ts'
import { emptyState, usableSnapshot } from '../runtime.ts'
import { phoneKeyOf } from '../secrets.ts'
import { readSealed } from '../sealed-state.ts'
import { last4KeyText, newBuyerKeyText } from '../sms-last4.ts'
import { eventsBetween, snapshotBefore } from '../store.ts'
import type { ScopeWriter } from '../writer.ts'
import { isNoPayReason, isPassReason, type SummaryBundle } from './summary.ts'

const SMS_PREFIX = 'sms:'

/** 그날 구매자 하나 */
export interface DayBuyer {
  readonly id: string
  /** 지금의 구매자 */
  readonly root: string
  /** 채팅 구매자의 플랫폼, 문자 구매자는 null */
  readonly platform: Platform | null
  readonly display: string
  readonly nameHistory: readonly string[]
  readonly phoneLast4: string | null
  readonly blocked: boolean
  /** 표지 (`c:<키>` · `p:<전화번호 키>`), 없으면 null */
  readonly marker: string | null
  /** 봉인 날짜의 보관 행에서만 나온 구매자 (장부에 없다 — 그날 자세히는 열 수 없다, D-CRM1-12) */
  readonly archived: boolean
}

/** 그날 묶음 하나 (지금의 구매자마다) */
export interface DayBundle extends SummaryBundle {
  /** 지금의 구매자의 표시 이름 */
  readonly name: string
  /** 묶음 구성원 (root와 그 아래 합쳐진 구매자, 합친 순서) */
  readonly members: readonly string[]
  /** 기록 묶음인지 (D-CRM1-03: 품목이 있거나, 입금 기록이 있거나, 1등이었다가 끝난 찜이 있다) */
  readonly record: boolean
  /** 봉인 날짜의 보관 행만으로 된 묶음 (장부에 없다 — 날짜 줄은 보이되 누르는 것이 아니다, D-CRM1-12) */
  readonly archived: boolean
}

export interface DayFacts {
  readonly date: string
  readonly scopeId: string
  /** 이 재료를 세운 범위 상태의 seq (봉인 날짜는 범위 줄의 seq) */
  readonly seq: number
  readonly buyers: ReadonlyMap<string, DayBuyer>
  readonly bundles: ReadonlyMap<string, DayBundle>
  /** 표지 → 그날 그 표지의 구매자 ID */
  readonly markers: ReadonlyMap<string, string>
}

/** 사유 후보 이벤트: 방송자 취소·무효, 교체 취소(직접 배정 replaceTo=CANCEL) */
const ACTION_TYPES = ['host.cancel', 'host.reject', 'host.assign'] as const

/** 사유 후보 하나의 갈래: '입금 안 함'(판매자 쪽이기도 하다), 그 밖의 판매자 쪽 조치, 아니면 null(손님 패스 사유·후보 아님) */
type ActionKind = 'noPay' | 'mine'

function actionKind(type: string, body: string): ActionKind | null {
  try {
    const event = JSON.parse(body) as { reason?: unknown; replaceTo?: unknown }
    if (type === 'host.assign' && event.replaceTo !== 'CANCEL') return null
    if (isNoPayReason(event.reason)) return 'noPay'
    return isPassReason(event.reason) ? null : 'mine'
  } catch {
    return null
  }
}

/** 방송자 조치로 끝난 확정 찜 ID — '입금 안 함'으로 끝난 것, 손님 패스가 아닌 사유로 끝난 것('입금 안 함' 포함) */
export interface EndedClaims {
  readonly noPay: ReadonlySet<string>
  readonly mine: ReadonlySet<string>
}

const NO_ENDED: EndedClaims = { noPay: new Set(), mine: new Set() }

const isEnded = (status: string, reason: string | null) => status === 'CANCELLED' || (status === 'REJECTED' && reason === 'BY_HOST')

/** 범위 하나의 '입금 안 함' 찾기 진행 (판매자·범위마다 한 벌) */
interface NoPayProgress {
  /** 여기까지(이 seq까지) 다시 적용했다 */
  replayed: number
  /** 여기까지 후보를 찾아봤다 (replayed 이상) */
  checked: number
  /** 찾은 '입금 안 함' 찜 ID (replayed까지의 후보로) */
  ids: ReadonlySet<string>
  /** 찾은 판매자 쪽 조치 찜 ID (D-PASS-01) */
  mine: ReadonlySet<string>
  /** replayed 시점의 상태 — 메모리를 아끼려 최근 것 몇 벌만 둔다(없으면 다음에 스냅샷에서 시작) */
  state: EngineState | null
}

/** 한 번에 읽는 이벤트 수, 그만큼 적용할 때마다 이벤트 루프에 양보한다 */
export const NO_PAY_CHUNK = 500
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * 그 범위에서 '입금 안 함' 조치로 끝난 확정 찜 ID (후보 이벤트 앞뒤의 찜 상태를 코어 applyEvent로 비교한다).
 * 이어 센다: 지난번 다시 적용한 곳 뒤의 새 후보만 본다. 앞선 후보의 결과는 뒤 이벤트로 바뀌지 않는다(그 조치 앞뒤 비교라서).
 */
async function noPayClaims(db: Db, sellerId: string, scopeId: string, upto: number, log: LogSink, date: string): Promise<EndedClaims> {
  const key = JSON.stringify([sellerId, scopeId])
  return oneAtATime(noPayRunning, key, async () => {
    const known = noPayProgress.get(key)
    const progress: NoPayProgress = known ?? { replayed: 0, checked: 0, ids: new Set(), mine: new Set(), state: null }
    if (upto <= progress.checked) return { noPay: progress.ids, mine: progress.mine }
    const rows = await db
      .select({ seq: events.seq, type: events.type, body: events.body })
      .from(events)
      .where(
        and(
          eq(events.sellerId, sellerId),
          eq(events.scopeId, scopeId),
          eq(events.failed, false),
          inArray(events.type, [...ACTION_TYPES]),
          gt(events.seq, progress.checked),
          lte(events.seq, upto),
        ),
      )
      .orderBy(asc(events.seq))
    const kinds = new Map<number, ActionKind>()
    for (const row of rows) {
      const kind = actionKind(row.type, row.body)
      if (kind !== null) kinds.set(row.seq, kind)
    }
    const candidates = [...kinds.keys()]
    const first = candidates[0]
    const last = candidates.at(-1)
    if (first === undefined || last === undefined) {
      progress.checked = upto
      remember(noPayProgress, key, progress, NO_PAY_CACHE_MAX)
      return { noPay: progress.ids, mine: progress.mine }
    }
    // 시작 상태: 이어 갈 상태, 없으면 첫 새 후보보다 앞선 스냅샷, 그것도 없으면 빈 상태(0번부터)
    let state: EngineState
    let from: number
    if (progress.state !== null) {
      state = progress.state
      from = progress.replayed
    } else {
      const snapshot = await snapshotBefore(db, sellerId, scopeId, STATE_FORMAT, first)
      const usable = snapshot === null ? null : usableSnapshot(snapshot.state, snapshot.attention)
      if (snapshot !== null && usable !== null) {
        state = usable.state
        from = snapshot.seq
      } else {
        state = emptyState()
        from = 0
      }
    }
    const ids = new Set(progress.ids)
    const mine = new Set(progress.mine)
    while (from < last) {
      const chunk = await eventsBetween(db, sellerId, scopeId, from, last, NO_PAY_CHUNK)
      if (chunk.length === 0) break
      for (const row of chunk) {
        from = row.seq
        if (row.failed) continue
        const kind = kinds.get(row.seq)
        const before = kind !== undefined ? new Set(listClaims(state).filter((claim) => claim.status === 'CONFIRMED').map((claim) => claim.id)) : null
        try {
          state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
        } catch {
          // 재생이 건너뛴 입력과 같다 (runtime.ts replayRow) — 코드·날짜·seq만
          log({ level: 'warn', code: 'REPLAY_SKIPPED', date, seq: row.seq })
          continue
        }
        if (before === null) continue
        for (const claim of listClaims(state)) {
          if (!before.has(claim.id) || !isEnded(claim.status, claim.reason)) continue
          mine.add(claim.id)
          if (kind === 'noPay') ids.add(claim.id)
        }
      }
      noPayReplayed += chunk.length
      if (from < last) await yieldTurn()
    }
    const next: NoPayProgress = { replayed: last, checked: upto, ids, mine, state }
    remember(noPayProgress, key, next, NO_PAY_CACHE_MAX)
    keepState(key)
    return { noPay: ids, mine }
  })
}

/** 이어 갈 상태는 최근 NO_PAY_STATE_MAX 범위만 (나머지는 찾은 ID만 두고 상태를 버린다) */
function keepState(key: string): void {
  noPayStates.delete(key)
  noPayStates.add(key)
  while (noPayStates.size > NO_PAY_STATE_MAX) {
    const oldest = noPayStates.values().next().value as string
    noPayStates.delete(oldest)
    const progress = noPayProgress.get(oldest)
    if (progress !== undefined) progress.state = null
  }
}

/** 판매자 키로 다시 만든 "끝자리만"·"새 손님으로 넣기" 키인지 (TD-CRM1-001 — 전체 번호에서 나온 키가 아니다) */
function isLast4Key(sellerKey: Buffer, date: string, ref: string, phoneKey: string, last4: unknown): boolean {
  if (typeof last4 !== 'string') return false
  return phoneKey === phoneKeyOf(sellerKey, last4KeyText(date, false, last4)) || phoneKey === phoneKeyOf(sellerKey, newBuyerKeyText(date, false, last4, ref))
}

/** 그 범위의 문자찜 ref → 전체 전화번호 키 (문자찜 이벤트 본문의 phoneKey — 끝자리만으로 만든 키는 뺀다). 범위마다 이어 읽는다 */
async function phoneKeys(deps: FactsDeps, sellerId: string, scope: ScopeRow): Promise<ReadonlyMap<string, string>> {
  const cacheKey = JSON.stringify([sellerId, scope.id])
  const known = phoneKeyCache.get(cacheKey)
  if (known !== undefined && known.seq >= scope.seq) return known.keys
  const after = known?.seq ?? 0
  const rows = await deps.db
    .select({ ref: events.smsRef, body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scope.id), eq(events.type, 'sms'), gt(events.seq, after), lte(events.seq, scope.seq)))
  const keys = new Map(known?.keys ?? [])
  let sellerKey: Buffer | null = null
  for (const row of rows) {
    if (row.ref === null) continue
    let body: { phoneKey?: unknown; phoneLast4?: unknown }
    try {
      body = JSON.parse(row.body) as typeof body
    } catch {
      continue // 읽을 수 없는 본문은 표지 없음
    }
    const key = body.phoneKey
    if (typeof key !== 'string' || key === '') continue
    sellerKey ??= await deps.sellerKey(sellerId)
    if (isLast4Key(sellerKey, scope.date, row.ref, key, body.phoneLast4)) continue
    keys.set(row.ref, key)
  }
  remember(phoneKeyCache, cacheKey, { seq: scope.seq, keys }, FACTS_CACHE_MAX)
  return keys
}

/** 범위 상태 하나 → 그날 재료 (판정 없음 — 코어 조회 결과만) */
export function factsOf(date: string, scopeId: string, seq: number, state: EngineState, keys: ReadonlyMap<string, string>, ended: ReadonlySet<string>, mineEnded: ReadonlySet<string> = new Set()): DayFacts {
  const buyers = new Map<string, DayBuyer>()
  const markers = new Map<string, string>()
  for (const buyer of listBuyers(state)) {
    let marker: string | null = null
    if (buyer.kind === 'youtube') marker = `c:${buyer.id}`
    else if (buyer.phoneLast4 !== null && buyer.id.startsWith(SMS_PREFIX)) {
      const key = keys.get(buyer.id.slice(SMS_PREFIX.length))
      if (key !== undefined) marker = `p:${key}`
    }
    const root = currentBuyerOf(state, buyer.id) ?? buyer.id
    buyers.set(buyer.id, {
      id: buyer.id,
      root,
      platform: buyer.kind === 'youtube' ? platformOfKey(buyer.id) : null,
      display: buyer.display,
      nameHistory: buyer.nameHistory,
      phoneLast4: buyer.phoneLast4,
      blocked: buyer.blocked,
      marker,
      archived: false,
    })
    if (marker !== null && !markers.has(marker)) markers.set(marker, buyer.id)
  }
  const counts = new Map<string, { items: number; cancels: number; noPay: number; mine: number }>()
  for (const claim of listClaims(state)) {
    const entry = counts.get(claim.currentBuyer) ?? { items: 0, cancels: 0, noPay: 0, mine: 0 }
    if (claim.status === 'CONFIRMED') entry.items += claim.qty
    else if (claim.price !== null && isEnded(claim.status, claim.reason)) {
      entry.cancels += 1
      if (ended.has(claim.id)) entry.noPay += 1
      if (ended.has(claim.id) || mineEnded.has(claim.id)) entry.mine += 1
    }
    counts.set(claim.currentBuyer, entry)
  }
  const bundles = new Map<string, DayBundle>()
  for (const buyer of buyers.values()) {
    if (buyer.root !== buyer.id) continue
    const settlement = getSettlement(state, buyer.id, date)
    const count = counts.get(buyer.id) ?? { items: 0, cancels: 0, noPay: 0, mine: 0 }
    const paid = settlement.records.some((record) => record.kind === 'payment' || record.kind === 'refund')
    const info = getBuyer(state, buyer.id)
    bundles.set(buyer.id, {
      date,
      buyer: buyer.id,
      items: count.items,
      subtotal: settlement.subtotal,
      payment: settlement.payment,
      cancels: count.cancels,
      noPay: count.noPay,
      mine: count.mine,
      name: buyer.display,
      members: [buyer.id, ...(info?.merged ?? [])],
      record: count.items > 0 || paid || count.cancels > 0,
      archived: false,
    })
  }
  return { date, scopeId, seq, buyers, bundles, markers }
}

/** 보관 행의 구성원 하나 (그날 구매자 ID·표지·그날 표시 이름·끝자리) */
export interface ArchiveMember {
  readonly id: string
  readonly marker: string | null
  readonly display: string
  readonly phoneLast4: string | null
}

/** 보관 행 하나 (그날 기록 묶음 하나, D-CRM1-12) */
export interface ArchiveRow {
  readonly root: string
  /** 뿌리 먼저 */
  readonly members: readonly ArchiveMember[]
  readonly cancels: number
  readonly noPay: number
  /** 판매자 쪽 조치로 끝난 찜 수 (D-PASS-01 — 옛 행은 0) */
  readonly mine: number
}

/** 그날 재료 → 보관 행 (기록 묶음 중 표지가 있는 구성원이 있는 것만 — 다른 날과 이어질 수 없는 묶음은 남길 까닭이 없다) */
export function archiveRowsOf(facts: DayFacts): ArchiveRow[] {
  const out: ArchiveRow[] = []
  for (const bundle of facts.bundles.values()) {
    if (!bundle.record) continue
    const members = bundle.members
      .map((id) => facts.buyers.get(id))
      .filter((buyer) => buyer !== undefined)
      .map((buyer) => ({ id: buyer.id, marker: buyer.marker, display: buyer.display, phoneLast4: buyer.phoneLast4 }))
    if (!members.some((member) => member.marker !== null)) continue
    out.push({ root: bundle.buyer, members, cancels: bundle.cancels, noPay: bundle.noPay, mine: bundle.mine ?? 0 })
  }
  return out
}

/**
 * 봉인 날짜 재료(장부) + 그 날짜의 보관 행 (D-CRM1-12). 장부의 품목·금액·입금은 그대로, 취소 수·'입금 안 함'만 보관 행에서 더한다.
 * 장부에 없는 뿌리는 보관 행만으로 묶음이 된다(품목 0·상품 합계 0·미입금 — archived). 장부에 없는 구성원은 그 묶음 아래 구매자로 넣어 표지로 잇는다
 */
export function mergeArchive(facts: DayFacts, rows: readonly ArchiveRow[]): DayFacts {
  if (rows.length === 0) return facts
  const buyers = new Map(facts.buyers)
  const bundles = new Map(facts.bundles)
  const markers = new Map(facts.markers)
  for (const row of rows) {
    // 보관 행의 뿌리 구매자 키 (코어 영속 맵이 아니다 — AC-S05-80 소스 검사에 걸리지 않게 이름을 둔다)
    const archivedRoot = row.root
    const target = buyers.get(archivedRoot)?.root ?? archivedRoot
    const existing = bundles.get(target)
    const ids = row.members.map((member) => member.id)
    if (existing !== undefined) {
      const cancels = existing.cancels + row.cancels
      const members = [...existing.members, ...ids.filter((id) => !existing.members.includes(id))]
      bundles.set(target, { ...existing, cancels, noPay: existing.noPay + row.noPay, mine: (existing.mine ?? 0) + row.mine, members, record: existing.record || cancels > 0 })
    } else {
      bundles.set(target, {
        date: facts.date,
        buyer: target,
        items: 0,
        subtotal: 0,
        payment: 'UNPAID',
        cancels: row.cancels,
        noPay: row.noPay,
        mine: row.mine,
        name: row.members[0]?.display ?? '',
        members: ids.includes(target) ? ids : [target, ...ids],
        record: row.cancels > 0,
        archived: true,
      })
    }
    for (const member of row.members) {
      if (!buyers.has(member.id)) {
        buyers.set(member.id, {
          id: member.id,
          root: target,
          platform: member.id.startsWith(SMS_PREFIX) ? null : platformOfKey(member.id),
          display: member.display,
          nameHistory: [],
          phoneLast4: member.phoneLast4,
          blocked: false,
          marker: member.marker,
          archived: true,
        })
      }
      if (member.marker !== null && !markers.has(member.marker)) markers.set(member.marker, member.id)
    }
  }
  return { ...facts, buyers, bundles, markers }
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** 저장한 구성원 글 → 구성원 목록 (읽을 수 없으면 null) */
export function readArchiveMembers(text: string): ArchiveMember[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const out: ArchiveMember[] = []
  for (const item of parsed as unknown[]) {
    if (typeof item !== 'object' || item === null) return null
    const { id, marker, display, phoneLast4 } = item as Record<string, unknown>
    if (!isText(id) || !isText(display) || !(marker === null || isText(marker)) || !(phoneLast4 === null || isText(phoneLast4))) return null
    out.push({ id, marker, display, phoneLast4 })
  }
  return out
}

/** 그 날짜의 보관 행 (판매자 ID 조건). 읽을 수 없는 행은 빼고 경고(코드·날짜만) */
async function archiveRows(db: Db, sellerId: string, date: string, log: LogSink): Promise<ArchiveRow[]> {
  const rows = await db
    .select({ root: customerArchiveRows.root, members: customerArchiveRows.members, cancels: customerArchiveRows.cancels, noPay: customerArchiveRows.noPay, mine: customerArchiveRows.mine })
    .from(customerArchiveRows)
    .where(and(eq(customerArchiveRows.sellerId, sellerId), eq(customerArchiveRows.date, date)))
    .orderBy(asc(customerArchiveRows.id))
  const out: ArchiveRow[] = []
  for (const row of rows) {
    const members = readArchiveMembers(row.members)
    if (members === null || row.cancels < 0 || row.noPay < 0 || row.mine < 0) {
      log({ level: 'warn', code: 'CUSTOMER_ARCHIVE_UNREADABLE', date })
      continue
    }
    out.push({ root: row.root, members, cancels: row.cancels, noPay: row.noPay, mine: row.mine })
  }
  return out
}

// ── 캐시 ─────────────────────────────────────────────────────────────────

/** 날짜 재료 캐시 자리 수 (판매자 여럿 × 날짜 수백 — 범위마다 한 자리, 넘으면 오래 안 쓴 것부터 버린다) */
export const FACTS_CACHE_MAX = 4000
/** 날짜 재료 캐시 크기 상한 (모든 자리의 구매자 수 + 묶음 수 합 — 넘으면 오래 안 쓴 것부터 버린다) */
export const FACTS_CACHE_WEIGHT_MAX = 400_000
const NO_PAY_CACHE_MAX = 4000
const NO_PAY_STATE_MAX = 16

interface FactsEntry {
  readonly seq: number
  readonly sealed: boolean
  readonly facts: DayFacts
  readonly weight: number
}

/** (판매자, 범위 ID) → 그 범위의 재료 한 벌 */
const factsCache = new Map<string, FactsEntry>()
let factsWeight = 0
/** 세우고 있는 재료 (판매자, 범위 ID, seq, 봉인 여부) → 약속 */
const factsBuilding = new Map<string, Promise<DayFacts | null>>()
const noPayProgress = new Map<string, NoPayProgress>()
const noPayStates = new Set<string>()
const noPayRunning = new Map<string, Promise<unknown>>()
const phoneKeyCache = new Map<string, { seq: number; keys: ReadonlyMap<string, string> }>()
let factsBuilds = 0
let noPayReplayed = 0

function remember<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > max) cache.delete(cache.keys().next().value as string)
}

function rememberFacts(key: string, entry: FactsEntry): void {
  const old = factsCache.get(key)
  if (old !== undefined) {
    factsWeight -= old.weight
    factsCache.delete(key)
  }
  factsCache.set(key, entry)
  factsWeight += entry.weight
  while (factsCache.size > FACTS_CACHE_MAX || (factsWeight > FACTS_CACHE_WEIGHT_MAX && factsCache.size > 1)) {
    const oldest = factsCache.keys().next().value as string
    factsWeight -= factsCache.get(oldest)?.weight ?? 0
    factsCache.delete(oldest)
  }
}

/** 같은 키의 일은 차례로 (앞 일이 끝난 뒤 시작 — 앞 일이 남긴 진행을 이어 쓴다) */
function oneAtATime<T>(running: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
  const before = running.get(key) ?? Promise.resolve()
  const next = before.then(task, task)
  const tail = next.then(
    () => undefined,
    () => undefined,
  )
  running.set(key, tail)
  void tail.then(() => {
    if (running.get(key) === tail) running.delete(key)
  })
  return next
}

/** 시험용: 날짜 재료를 새로 만든 횟수 (캐시를 쓰는지 본다) */
export function factsBuildCount(): number {
  return factsBuilds
}

/** 시험용: '입금 안 함' 찾기로 다시 적용한 이벤트 수 (이어 세는지 본다) */
export function noPayReplayCount(): number {
  return noPayReplayed
}

/** 시험용: 이어 갈 '입금 안 함' 상태를 모두 버린다 (밀려난 뒤처럼 — 찾은 ID는 남는다) */
export function forgetNoPayStates(): void {
  for (const key of noPayStates) {
    const progress = noPayProgress.get(key)
    if (progress !== undefined) progress.state = null
  }
  noPayStates.clear()
}

/** 시험용: 손님 기록 캐시를 모두 버린다 (서버를 막 켠 것처럼 — 성능 시험의 차가운 첫 조회) */
export function forgetCustomerCaches(): void {
  factsCache.clear()
  factsWeight = 0
  noPayProgress.clear()
  noPayStates.clear()
  phoneKeyCache.clear()
}

/** 시험용: 날짜 재료 캐시의 (판매자, 범위) 자리 수와 크기 */
export function factsCacheStats(): { entries: number; weight: number } {
  return { entries: factsCache.size, weight: factsWeight }
}

export interface FactsDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly log: LogSink
  /** 판매자 전화번호 키 (끝자리만으로 만든 키를 가려낸다 — 응답·로그에 내지 않는다) */
  readonly sellerKey: (sellerId: string) => Promise<Buffer>
}

export interface ScopeRow {
  readonly id: string
  readonly date: string
  readonly seq: number
  readonly sealedAt: Date | null
}

/** 판매자의 실제 범위 (이벤트가 있는 것만, 날짜 순) */
export async function realScopes(db: Db, sellerId: string): Promise<ScopeRow[]> {
  const rows = await db
    .select({ id: scopes.id, date: scopes.date, seq: scopes.seq, sealedAt: scopes.sealedAt })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), gt(scopes.seq, 0)))
    .orderBy(asc(scopes.date))
  return rows
}

/** 재료 읽기 방식 — quiet: 캐시에 있으면 쓰되 순서를 바꾸지 않고, 없으면 세워 쓰고 캐시에 넣지 않는다 (정리 작업이 방송 중 판매자 재료를 밀어내지 않게, RA-KP1-009) */
export interface FactsReadOptions {
  readonly quiet?: boolean
}

/** 범위 하나의 재료 (캐시). 봉인 장부를 읽을 수 없으면 null */
export async function factsFor(deps: FactsDeps, sellerId: string, scope: ScopeRow, options: FactsReadOptions = {}): Promise<DayFacts | null> {
  const sealed = scope.sealedAt !== null
  const slot = JSON.stringify([sellerId, scope.id])
  const hit = factsCache.get(slot)
  if (hit !== undefined && hit.seq === scope.seq && hit.sealed === sealed) {
    if (options.quiet !== true) rememberFacts(slot, hit)
    return hit.facts
  }
  const buildKey = JSON.stringify([sellerId, scope.id, scope.seq, sealed])
  const building = factsBuilding.get(buildKey)
  if (building !== undefined) return building
  if (options.quiet === true) return buildFacts(deps, sellerId, scope, sealed, null)
  const promise = buildFacts(deps, sellerId, scope, sealed, slot).finally(() => factsBuilding.delete(buildKey))
  factsBuilding.set(buildKey, promise)
  return promise
}

/** slot = 캐시 자리 (null이면 캐시에 넣지 않는다 — quiet 읽기) */
async function buildFacts(deps: FactsDeps, sellerId: string, scope: ScopeRow, sealed: boolean, slot: string | null): Promise<DayFacts | null> {
  let state: EngineState
  let seq = scope.seq
  let ended: EndedClaims = NO_ENDED
  if (sealed) {
    const read = await readSealed(deps.db, sellerId, scope.date)
    if (!read.sealed || read.state === null) {
      deps.log({ level: 'error', code: 'LEDGER_UNREADABLE', date: scope.date })
      return null
    }
    state = read.state
  } else {
    const runtime = await deps.writer.readDetached(sellerId, scope.date, false)
    if (runtime.scopeId !== scope.id) return null
    state = runtime.state
    seq = runtime.seq
    ended = await noPayClaims(deps.db, sellerId, scope.id, runtime.seq, deps.log, scope.date)
  }
  let facts = factsOf(scope.date, scope.id, seq, state, await phoneKeys(deps, sellerId, { ...scope, seq }), ended.noPay, ended.mine)
  // 봉인 날짜: 봉인 전에 남긴 보관 행을 더한다 (D-CRM1-12 — 봉인한 날짜의 행은 바뀌지 않아 (범위, seq, 봉인) 캐시가 그대로 맞다)
  if (sealed) facts = mergeArchive(facts, await archiveRows(deps.db, sellerId, scope.date, deps.log))
  factsBuilds += 1
  if (slot === null) return facts
  // 읽은 상태의 seq로 둔다 — 범위 줄의 seq보다 앞서 읽었으면 다음 조회가 다시 세운다
  const current = factsCache.get(slot)
  if (current === undefined || current.seq <= seq) rememberFacts(slot, { seq, sealed, facts, weight: facts.buyers.size + facts.bundles.size })
  return facts
}

/** 판매자의 모든 실제 날짜 재료 (날짜 순). 봉인 장부를 읽지 못한 날은 빠진다 — 그 수는 allFactsCounted로 */
export async function allFacts(deps: FactsDeps, sellerId: string, options: FactsReadOptions = {}): Promise<DayFacts[]> {
  return (await allFactsCounted(deps, sellerId, options)).days
}

/** allFacts + 읽지 못한(null) 날 수 (장부 정리가 그런 판매자를 건너뛴다, RA-KP1-002) */
export async function allFactsCounted(deps: FactsDeps, sellerId: string, options: FactsReadOptions = {}): Promise<{ days: DayFacts[]; unreadable: number }> {
  const days: DayFacts[] = []
  let unreadable = 0
  for (const scope of await realScopes(deps.db, sellerId)) {
    const facts = await factsFor(deps, sellerId, scope, options)
    if (facts !== null) days.push(facts)
    else unreadable += 1
  }
  return { days, unreadable }
}

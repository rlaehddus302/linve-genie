export const meta = {
  name: 'sprint',
  description: '라이브찜 스프린트 1회: 스펙 → 영역별 개발 → 영역별 테스트 → 스펙·위험 감사 → 수정 루프 → 리포트',
  whenToUse: 'harness/backlog.yaml의 스프린트 하나를 실행할 때. args: { sprintId: "S01", devs: ["core"], tests: ["domain"], uxReview?: bool, maxFixRounds?: 2, useAgentTypes?: bool }',
  phases: [
    { title: 'Spec', detail: 'spec-keeper: 수용 기준 + 골든 + 자율 결정' },
    { title: 'Build', detail: '영역별 개발자 순차: core → device → server → web' },
    { title: 'Test', detail: 'test-domain → test-e2e (→ ux-reviewer): 버그를 실패하는 테스트로 고정' },
    { title: 'Audit', detail: 'spec-auditor(게이트·추적성·규칙) ‖ risk-auditor(보안·정책·동시성)' },
    { title: 'Fix', detail: '지적을 담당 개발자에게 배정 → 분쟁 판정 → 재검증 (최대 N라운드)' },
    { title: 'Report', detail: '리포트 작성 + 백로그 상태 갱신' },
  ],
}

// ───────────────────────── 설정 ─────────────────────────
const A = args || {}
const S = A.sprintId
if (!S) throw new Error('args.sprintId가 필요합니다. 예: { sprintId: "S01", devs: ["core"], tests: ["domain"] }')
const ORDER = ['core', 'device', 'server', 'web'] // 의존 순서
const AREA_DESC = {
  core: 'packages/core (판정 엔진·파서·정산·골든 러너) + 저장소 공용 도구',
  device: 'packages/label · packages/printer · packages/documents · packages/voice',
  server: 'apps/server',
  web: 'apps/web',
}
const DEVS = ORDER.filter((a) => (A.devs || []).includes(a))
const TESTS = ['domain', 'e2e'].filter((t) => (A.tests || []).includes(t))
if (!DEVS.length) throw new Error('args.devs가 필요합니다 (core/device/server/web 중 하나 이상)')
const MAX_FIX = typeof A.maxFixRounds === 'number' ? A.maxFixRounds : 2
const USE_TYPES = A.useAgentTypes === true
const UX = A.uxReview === true
const DIR = `harness/sprints/${S}`
const TEST_PREFIX = { domain: 'TD-', e2e: 'TE-' }

// ───────────────────────── 스키마 ─────────────────────────
const AREA_ENUM = { type: 'string', enum: ['core', 'device', 'server', 'web'] }
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'SA-/RA-/TD-/TE-/UX- + 스프린트 + 번호. 재검토 시 같은 ID 유지' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
    category: { type: 'string' },
    area: Object.assign({ description: '고칠 담당 영역 (모르면 비움)' }, AREA_ENUM),
    specRef: { type: 'string' },
    file: { type: 'string', description: '원인으로 보이는 제품 코드 경로' },
    line: { type: 'number' },
    title: { type: 'string' },
    detail: { type: 'string' },
    repro: { type: 'string' },
    suggestedFix: { type: 'string' },
    confidence: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE'] },
  },
  required: ['id', 'severity', 'title', 'detail', 'confidence'],
}
const DECISION = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    question: { type: 'string' },
    applied: { type: 'string', description: '적용한 값' },
    rationale: { type: 'string' },
    blocking: { type: 'boolean', description: '사용자만 할 수 있는 일 없이는 진행 불가일 때만 true' },
  },
  required: ['id', 'question', 'blocking'],
}
const SPEC_OUT = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    summary: { type: 'string', description: '이번 스프린트에서 만들 것과 만들지 않을 것, 영역별 몫' },
    acceptanceCount: { type: 'number' },
    goldenChanged: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: DECISION },
  },
  required: ['ready', 'summary', 'decisions'],
}
const RESPONSE = {
  type: 'object',
  properties: {
    findingId: { type: 'string' },
    action: { type: 'string', enum: ['FIXED', 'DISPUTED', 'NOT_MINE', 'DEFERRED'] },
    reassignTo: Object.assign({ description: 'NOT_MINE일 때 원인 영역' }, AREA_ENUM),
    note: { type: 'string' },
  },
  required: ['findingId', 'action', 'note'],
}
const BUILD_OUT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    handoff: { type: 'string', description: '다음 개발자·테스터가 알아야 할 인터페이스, 실행 명령, 테스트용 기동 방법' },
    verify: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_AVAILABLE'] },
    verifyTail: { type: 'string' },
    othersFailures: { type: 'string', description: '남의 몫이라 판단한 실패' },
    commits: { type: 'array', items: { type: 'string' } },
    responses: { type: 'array', items: RESPONSE },
    disputesWithSpec: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'verify'],
}
const TEST_OUT = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
    resolvedIds: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' }, description: '추가한 테스트 파일·이름 (실패/회귀 구분)' },
    attacksTried: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings'],
}
const GATE = {
  type: 'object',
  properties: {
    verify: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_AVAILABLE'] },
    protectedPaths: { type: 'string', enum: ['PASS', 'FAIL'] },
    details: { type: 'string' },
  },
  required: ['verify', 'protectedPaths', 'details'],
}
const SPEC_AUDIT_OUT = {
  type: 'object',
  properties: {
    gate: GATE,
    findings: { type: 'array', items: FINDING },
    resolvedIds: { type: 'array', items: { type: 'string' } },
    traceability: {
      type: 'array',
      items: { type: 'object', properties: { ref: { type: 'string' }, impl: { type: 'string' }, test: { type: 'string' } }, required: ['ref'] },
    },
  },
  required: ['gate', 'findings'],
}
const RISK_OUT = {
  type: 'object',
  properties: { findings: { type: 'array', items: FINDING }, resolvedIds: { type: 'array', items: { type: 'string' } } },
  required: ['findings'],
}
const UX_OUT = {
  type: 'object',
  properties: { findings: { type: 'array', items: FINDING }, screenshots: { type: 'array', items: { type: 'string' } } },
  required: ['findings'],
}
const ARB_OUT = {
  type: 'object',
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          ruling: { type: 'string', enum: ['UPHOLD', 'DISMISS', 'NEEDS_DECISION'] },
          reason: { type: 'string' },
        },
        required: ['findingId', 'ruling', 'reason'],
      },
    },
    decisions: { type: 'array', items: DECISION },
  },
  required: ['rulings'],
}

// ───────────────────────── 도우미 ─────────────────────────
const j = (x) => JSON.stringify(x, null, 1)
const isSerious = (f) => f && (f.severity === 'blocker' || f.severity === 'major')
const isGate = (f) => f.id.startsWith('GATE-')
function role(name, opts) {
  return Object.assign(USE_TYPES ? { agentType: name } : {}, opts || {})
}
function head(name) {
  return [
    `[역할] ${name} — 규칙: .claude/agents/${name}.md (시스템 프롬프트로 이미 받았다면 다시 읽지 않아도 된다).`,
    `[스프린트] ${S} — 정의: harness/backlog.yaml 의 ${S} 항목. 작업 폴더: ${DIR}/. 이번 스프린트 개발 영역: ${DEVS.join(', ')} / 테스트: ${TESTS.join(', ') || '없음'}`,
    `[진행 방식] 사용자는 자율 진행을 원한다. 질문하지 말고 스펙과 판매자 안전을 기준으로 스스로 판단해 끝까지 진행한다.`,
  ].join('\n')
}

const reassign = new Map() // findingId → area (NOT_MINE 응답 반영)
function areaOf(f) {
  if (reassign.has(f.id)) return reassign.get(f.id)
  if (f.area && ORDER.includes(f.area)) return f.area
  const p = f.file || ''
  if (p.startsWith('packages/core')) return 'core'
  if (/^packages\/(label|printer|documents|voice)/.test(p)) return 'device'
  if (p.startsWith('apps/server')) return 'server'
  if (p.startsWith('apps/web')) return 'web'
  return DEVS[DEVS.length - 1]
}

function gateFindings(sa) {
  if (!sa) return [{ id: `GATE-${S}-NOAUDIT`, severity: 'blocker', title: '스펙 감사 결과 없음', detail: 'spec-auditor가 결과를 반환하지 못했다', confidence: 'CONFIRMED' }]
  const g = sa.gate || {}
  const out = []
  if (g.verify !== 'PASS') out.push({ id: `GATE-${S}-VERIFY`, severity: 'blocker', category: 'test', title: `pnpm verify ${g.verify || '결과 없음'}`, detail: g.details || '', confidence: 'CONFIRMED' })
  if (g.protectedPaths !== 'PASS') out.push({ id: `GATE-${S}-PROTECTED`, severity: 'blocker', category: 'test', title: '보호 경로·금지 패턴 게이트 실패', detail: g.details || '', confidence: 'CONFIRMED' })
  return out
}

// 열린 지적 = (이번 지적 ∪ 아무도 해결 확인 안 한 이전 지적) − 해결 − 기각/상정
function mergeOpen(prevOpen, r, closed) {
  const reviewers = [r.spec, r.risk, r.ux].concat(Object.values(r.tests))
  const resolved = new Set(reviewers.flatMap((x) => (x && x.resolvedIds) || []))
  const byId = new Map()
  for (const f of gateFindings(r.spec)) byId.set(f.id, f)
  for (const x of reviewers) for (const f of (x && x.findings) || []) byId.set(f.id, f)
  for (const f of prevOpen) if (!isGate(f) && !byId.has(f.id) && !resolved.has(f.id)) byId.set(f.id, f)
  const all = [...byId.values()].filter((f) => !resolved.has(f.id) && !closed.has(f.id))
  return { serious: all.filter(isSerious), minor: all.filter((f) => !isSerious(f)) }
}

let handoffs = []
async function review(round, prevOpen, opt) {
  const ph = round === 0 ? 'Test' : 'Fix'
  const out = { tests: {}, ux: null, spec: null, risk: null }
  const ho = handoffs.length ? `\n\n[개발자 handoff]\n${handoffs.join('\n---\n')}` : ''
  for (const t of opt.tests) {
    const mine = prevOpen.filter((f) => f.id.startsWith(TEST_PREFIX[t]))
    const prev = mine.length ? `\n\n[내 이전 지적 — 다시 공격해 resolvedIds 또는 같은 ID로 응답]\n${j(mine)}` : ''
    out.tests[t] = await agent(
      `${head('test-' + t)}\n\n[할 일] 라운드 ${round}. 이번 스프린트 범위(${DIR}/acceptance.md)를 깨뜨려라. 재현한 버그는 실패하는 테스트로 남기고 [test:${t}] ${S}: 로 커밋. 끝날 때 커밋 안 된 변경이 없어야 한다.${round > 0 ? ' 수정으로 생긴 새 구멍도 찾아라.' : ''}${ho}${prev}`,
      role('test-' + t, { phase: ph, label: `test-${t}:r${round}`, schema: TEST_OUT }),
    )
  }
  if (opt.ux) {
    out.ux = await agent(
      `${head('ux-reviewer')}\n\n[할 일] 이번 스프린트에서 바뀐 화면과 흐름을 실제로 띄워 점검하고 스크린샷을 ${DIR}/ux/ 에 남겨 [ux] ${S}: 로 커밋.${ho}`,
      role('ux-reviewer', { phase: ph, label: 'ux', schema: UX_OUT }),
    )
  }
  const added = Object.values(out.tests).flatMap((x) => (x && x.testsAdded) || [])
  const addedNote = added.length ? `\n\n[테스터가 이번 라운드에 추가한 테스트 — 게이트에 포함됨]\n${j(added)}` : ''
  const prevAll = prevOpen.length ? `\n\n[이전 라운드 열린 지적(접두어 무관) — 각각 해결 여부를 확인해 resolvedIds 또는 같은 ID로 응답]\n${j(prevOpen)}` : ''
  const prevRisk = prevOpen.filter((f) => f.id.startsWith('RA-'))
  const aph = round === 0 ? 'Audit' : 'Fix'
  const res = await parallel([
    () => agent(
      `${head('spec-auditor')}\n\n[할 일] 라운드 ${round} 스펙 검증 감사.\n1) 게이트: pnpm verify / node scripts/harness/check-protected.mjs $(cat ${DIR}/BASE). 실패하면 원인별로 SA- 지적을 file(원인 코드 경로)과 함께 따로 올려라 — 담당 개발자 배정에 쓰인다.\n2) ${DIR}/acceptance.md 기준·스프린트 spec ID마다 구현·테스트 추적(traceability).\n3) DOMAIN_RULES·DECISIONS 준수, 4) 스펙 이탈.\n변경 범위: git diff $(cat ${DIR}/BASE)..HEAD${addedNote}${prevAll}`,
      role('spec-auditor', { phase: aph, label: `spec-audit:r${round}`, schema: SPEC_AUDIT_OUT, effort: 'high' }),
    ),
    () => (opt.risk
      ? agent(
        `${head('risk-auditor')}\n\n[할 일] 라운드 ${round} 위험 감사. 변경 범위 git diff $(cat ${DIR}/BASE)..HEAD 를 보안·개인정보·외부 정책·동시성·내구성·성능·테스트 품질 관점에서 본다. pnpm verify·테스트 실행 금지(스펙 감사자가 동시에 돌린다).${prevRisk.length ? `\n\n[내 이전 지적 — resolvedIds 또는 같은 ID로 응답]\n${j(prevRisk)}` : ''}`,
        role('risk-auditor', { phase: aph, label: `risk-audit:r${round}`, schema: RISK_OUT, effort: 'high' }),
      )
      : Promise.resolve(null)),
  ])
  out.spec = res[0]
  out.risk = res[1]
  return out
}

// ───────────────────────── ① Spec ─────────────────────────
phase('Spec')
const spec = await agent(
  `${head('spec-keeper')}\n\n[할 일]\n1) ${DIR}/BASE 가 없으면 git rev-parse HEAD 기록.\n2) 백로그의 ${S} 범위를 ${DIR}/acceptance.md 수용 기준으로 작성 (AC-${S}-번호, spec ID, 담당 영역 태그 [core]/[device]/[server]/[web], Given/When/Then, 확인 방법, 범위 밖 항목).\n3) 판정·정산·파서 관련은 tests/golden/ 에 시나리오 추가·보강 (기존 약화 금지).\n4) 모호한 점은 스스로 판매자에게 안전한 쪽으로 정해 docs/DECISIONS.md 에 AUTO 로 기록. blocking 은 사용자만 할 수 있는 일 없이는 진행 불가일 때만.\n5) [spec] ${S}: 로 커밋.`,
  role('spec-keeper', { phase: 'Spec', label: `spec:${S}`, schema: SPEC_OUT }),
)
if (!spec) return { status: 'ERROR', sprint: S, stage: 'spec' }
const blocking = (spec.decisions || []).filter((d) => d.blocking)
if (!spec.ready || blocking.length) {
  log(`스펙 단계에서 멈춤: 사용자 확인 필요 ${blocking.length}건`)
  return { status: 'BLOCKED', sprint: S, stage: 'spec', decisions: blocking, specSummary: spec.summary }
}
log(`수용 기준 ${spec.acceptanceCount || '?'}개, 골든 변경 ${(spec.goldenChanged || []).length}개, 자율 결정 ${(spec.decisions || []).length}건`)

// ───────────────────────── ② Build ─────────────────────────
phase('Build')
const builds = []
for (let i = 0; i < DEVS.length; i++) {
  const area = DEVS[i]
  const prior = builds.length ? `\n\n[앞선 개발자 결과]\n${builds.map((b) => `(${b.area}) ${b.summary}\nhandoff: ${b.handoff || '-'}`).join('\n---\n')}` : ''
  const b = await agent(
    `${head('dev-' + area)}\n\n[할 일] ${DIR}/acceptance.md 에서 [${area}] 기준(태그가 없으면 네 영역에 해당하는 것)을 구현한다. 네 영역: ${AREA_DESC[area]}.\n- 이번 스프린트 개발 순서: ${DEVS.join(' → ')} (너는 ${i + 1}번째).\n- 작게 나눠 [dev:${area}] ${S}: 로 커밋, 끝날 때 커밋 안 된 변경 없음.\n- 마지막에 pnpm verify 실행. 남의 몫 실패는 othersFailures 로 구분.\n- 다음 개발자·테스터가 알아야 할 인터페이스·명령·테스트용 기동 방법을 handoff 에 적어라.\n\n[spec-keeper 요약]\n${spec.summary}${prior}`,
    role('dev-' + area, { phase: 'Build', label: `dev-${area}`, schema: BUILD_OUT }),
  )
  if (!b) return { status: 'ERROR', sprint: S, stage: `build:${area}` }
  builds.push(Object.assign({ area, round: 0 }, b))
  if (b.handoff) handoffs.push(`(${area}) ${b.handoff}`)
}

// ───────────────────────── ③ Test + ④ Audit ─────────────────────────
phase('Test')
const closed = new Set()
const decisions = (spec.decisions || []).slice()
const escalated = []
let r = await review(0, [], { tests: TESTS, ux: UX, risk: true })
let open = mergeOpen([], r, closed)
log(`1차 검증: blocker/major ${open.serious.length}건, minor/nit ${open.minor.length}건`)

// ───────────────────────── ⑤ Fix ─────────────────────────
let round = 0
while (open.serious.length && round < MAX_FIX) {
  round++
  phase('Fix')
  const gate = open.serious.filter(isGate)
  const groups = {}
  for (const f of open.serious.filter((x) => !isGate(x))) {
    const a = areaOf(f)
    ;(groups[a] = groups[a] || []).push(f)
  }
  let fixAreas = ORDER.filter((a) => groups[a])
  if (!fixAreas.length) fixAreas = DEVS.slice() // 게이트만 실패: 이번 스프린트 개발자 전원
  const responses = []
  for (const area of fixAreas) {
    const mine = (groups[area] || []).concat(gate)
    const fx = await agent(
      `${head('dev-' + area)}\n\n[할 일] 수정 라운드 ${round}/${MAX_FIX}. 너에게 배정된 지적 각각에 FIXED / DISPUTED(스펙 인용 필수) / NOT_MINE(reassignTo 필수) / DEFERRED(minor·nit만)로 응답하라. GATE- 지적은 네 영역 원인만 고친다(테스트를 약화시키는 방식 금지).\n[dev:${area}] ${S}: 로 커밋, 마지막에 pnpm verify.\n\n[배정된 지적]\n${j(mine)}`,
      role('dev-' + area, { phase: 'Fix', label: `fix-${area}:r${round}`, schema: BUILD_OUT }),
    )
    if (!fx) continue
    builds.push(Object.assign({ area, round }, fx))
    if (fx.handoff) handoffs.push(`(${area}, r${round}) ${fx.handoff}`)
    for (const x of fx.responses || []) {
      responses.push(x)
      if (x.action === 'NOT_MINE' && x.reassignTo) reassign.set(x.findingId, x.reassignTo)
    }
  }
  const disputes = responses.filter((x) => x.action === 'DISPUTED')
  if (disputes.length) {
    const pairs = disputes.map((d) => ({ finding: open.serious.find((f) => f.id === d.findingId) || { id: d.findingId }, developerArgument: d.note }))
    const arb = await agent(
      `${head('spec-keeper')}\n\n[할 일] 분쟁 판정. 각 지적에 대해 SPEC/DOMAIN_RULES 문장을 인용해 UPHOLD / DISMISS / NEEDS_DECISION 으로 판정하라. 스펙이 침묵하면 판매자에게 안전한 쪽으로 정해 DECISIONS(AUTO)·스펙에 반영하고 UPHOLD/DISMISS 로 판정한다. NEEDS_DECISION 은 사용자만 정할 수 있는 사안에만. 수정했다면 [spec] ${S}: 로 커밋.\n\n${j(pairs)}`,
      role('spec-keeper', { phase: 'Fix', label: `arbitrate:r${round}`, schema: ARB_OUT }),
    )
    for (const x of (arb && arb.rulings) || []) {
      if (x.ruling === 'DISMISS') closed.add(x.findingId)
      if (x.ruling === 'NEEDS_DECISION') { closed.add(x.findingId); escalated.push(x) }
    }
    decisions.push(...((arb && arb.decisions) || []))
    log(`분쟁 ${disputes.length}건 판정`)
  }
  const prevOpen = open.serious.concat(open.minor)
  const retests = TESTS.filter((t) => open.serious.some((f) => f.id.startsWith(TEST_PREFIX[t])))
  const rerisk = open.serious.some((f) => f.id.startsWith('RA-'))
  r = await review(round, prevOpen, { tests: retests, ux: false, risk: rerisk })
  open = mergeOpen(prevOpen, r, closed)
  log(`라운드 ${round} 재검증: blocker/major ${open.serious.length}건`)
}
if (open.serious.length && round >= MAX_FIX) log(`수정 라운드 상한(${MAX_FIX}) 도달 — 남은 blocker/major ${open.serious.length}건은 오케스트레이터가 판단`)

const status = escalated.length || decisions.some((d) => d.blocking) ? 'BLOCKED' : open.serious.length ? 'FAIL' : 'PASS'

// ───────────────────────── ⑥ Report ─────────────────────────
phase('Report')
const result = {
  status,
  sprint: S,
  devs: DEVS,
  tests: TESTS,
  rounds: round,
  openSerious: open.serious,
  minors: open.minor,
  decisions,
  escalated,
  specSummary: spec.summary,
  builds: builds.map((b) => ({ area: b.area, round: b.round, summary: b.summary, verify: b.verify })),
  traceability: (r.spec && r.spec.traceability) || [],
  testsAdded: Object.values(r.tests).flatMap((x) => (x && x.testsAdded) || []),
}
await agent(
  `너는 하네스 리포터다. 아래 결과로 ${DIR}/report.md 를 한국어로 작성하라. 구성: 결과(${status}) 한 줄 → 영역별로 만든 것 → 남은 blocker/major → 자율 결정·사용자 확인 필요 사항 → minor/nit 백로그 → 추적성 표 → 다음 스프린트 제안.\n그리고 harness/backlog.yaml 의 ${S} 항목 status 를 ${status === 'PASS' ? 'done' : status.toLowerCase()} 로 바꾸고, minor/nit 는 같은 파일의 techDebt 목록에 "ID: 제목" 형태로 추가하라.\n그 두 파일만 수정하고 [harness] ${S}: report 로 커밋하라.\n\n${j(result)}`,
  { phase: 'Report', label: 'report', effort: 'low' },
)
return result

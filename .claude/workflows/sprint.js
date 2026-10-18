export const meta = {
  name: 'sprint',
  description: '라이브찜 스프린트 1회: 스펙 구체화 → 구현 → 감사·파괴 테스트 → 수정 루프 → 리포트',
  whenToUse: 'harness/backlog.yaml의 스프린트 하나를 실행할 때. args: { sprintId: "S01", maxFixRounds?: 2, uxReview?: bool, useAgentTypes?: bool }',
  phases: [
    { title: 'Spec', detail: 'spec-keeper: 수용 기준 + 골든 시나리오 + 결정 항목' },
    { title: 'Build', detail: 'developer: 구현 → verify → 커밋' },
    { title: 'Review', detail: 'qa-breaker → (ux-reviewer) → auditor 독립 검증 + 게이트' },
    { title: 'Fix', detail: '지적 응답·분쟁 판정·재검토 (최대 N라운드)' },
    { title: 'Report', detail: '리포트 작성 + 백로그 상태 갱신' },
  ],
}

// ───────────────────────── 설정 ─────────────────────────
const A = args || {}
const S = A.sprintId
if (!S) throw new Error('args.sprintId가 필요합니다. 예: { sprintId: "S01" }')
const MAX_FIX = typeof A.maxFixRounds === 'number' ? A.maxFixRounds : 2
const USE_TYPES = A.useAgentTypes !== false
const UX = A.uxReview === true
const DIR = `harness/sprints/${S}`

// ───────────────────────── 스키마 ─────────────────────────
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'A-/Q-/U- 접두어 + 스프린트 + 번호. 재검토 시 같은 ID 유지' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
    category: { type: 'string' },
    specRef: { type: 'string' },
    file: { type: 'string' },
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
    options: { type: 'array', items: { type: 'string' } },
    proposedDefault: { type: 'string' },
    blocking: { type: 'boolean' },
  },
  required: ['id', 'question', 'blocking'],
}
const SPEC_OUT = {
  type: 'object',
  properties: {
    ready: { type: 'boolean', description: '구현을 시작해도 되는가' },
    summary: { type: 'string', description: '이번 스프린트에서 만들 것과 만들지 않을 것' },
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
    action: { type: 'string', enum: ['FIXED', 'DISPUTED', 'DEFERRED'] },
    note: { type: 'string', description: 'FIXED: 어떻게+어떤 테스트로 확인 / DISPUTED: 스펙 인용 근거' },
  },
  required: ['findingId', 'action', 'note'],
}
const BUILD_OUT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    verify: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_AVAILABLE'] },
    verifyTail: { type: 'string', description: 'verify 출력 마지막 30줄 정도' },
    commits: { type: 'array', items: { type: 'string' } },
    responses: { type: 'array', items: RESPONSE },
    disputesWithSpec: { type: 'array', items: { type: 'string' }, description: '구현 중 스펙과 다르게 해야 한다고 판단한 점' },
  },
  required: ['summary', 'verify'],
}
const GATE = {
  type: 'object',
  properties: {
    verify: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_AVAILABLE'] },
    protectedPaths: { type: 'string', enum: ['PASS', 'FAIL'] },
    details: { type: 'string', description: '실패 시 핵심 출력' },
  },
  required: ['verify', 'protectedPaths', 'details'],
}
const AUDIT_OUT = {
  type: 'object',
  properties: {
    gate: GATE,
    findings: { type: 'array', items: FINDING },
    resolvedIds: { type: 'array', items: { type: 'string' } },
    traceability: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ref: { type: 'string' }, impl: { type: 'string' }, test: { type: 'string' } },
        required: ['ref'],
      },
    },
  },
  required: ['gate', 'findings'],
}
const QA_OUT = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
    failingTestsAdded: { type: 'array', items: { type: 'string' } },
    attacksTried: { type: 'array', items: { type: 'string' } },
  },
  required: ['findings'],
}
const UX_OUT = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: FINDING },
    screenshots: { type: 'array', items: { type: 'string' } },
  },
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
          reason: { type: 'string', description: '스펙 문장 인용 포함' },
        },
        required: ['findingId', 'ruling', 'reason'],
      },
    },
    decisions: { type: 'array', items: DECISION },
  },
  required: ['rulings'],
}

// ───────────────────────── 도우미 ─────────────────────────
function role(name, opts) {
  return Object.assign(USE_TYPES ? { agentType: name } : {}, opts || {})
}
function head(name) {
  return [
    `[역할] ${name} — 규칙은 .claude/agents/${name}.md (시스템 프롬프트로 이미 받았다면 다시 읽지 않아도 된다).`,
    `[스프린트] ${S} — 정의: harness/backlog.yaml 의 ${S} 항목. 작업 폴더: ${DIR}/`,
    `[공통 규칙] 판정·금액은 docs/spec/DOMAIN_RULES.md, 기능은 docs/spec/SPEC.md, 하네스 규약은 docs/HARNESS.md.`,
  ].join('\n')
}
const j = (x) => JSON.stringify(x, null, 1)
const isSerious = (f) => f && (f.severity === 'blocker' || f.severity === 'major')

function gateFindings(audit) {
  if (!audit) return [{ id: `GATE-${S}-NOAUDIT`, severity: 'blocker', title: '감사 에이전트 결과 없음', detail: 'auditor가 결과를 반환하지 못했다', confidence: 'CONFIRMED' }]
  const out = []
  const g = audit.gate || {}
  if (g.verify !== 'PASS') out.push({ id: `GATE-${S}-VERIFY`, severity: 'blocker', category: 'test', title: `pnpm verify ${g.verify || '결과 없음'}`, detail: g.details || '', confidence: 'CONFIRMED' })
  if (g.protectedPaths !== 'PASS') out.push({ id: `GATE-${S}-PROTECTED`, severity: 'blocker', category: 'test', title: '보호 경로·금지 패턴 게이트 실패', detail: g.details || '', confidence: 'CONFIRMED' })
  return out
}

// 열린 지적 = (새 지적 ∪ 언급 안 된 이전 지적) − 해결 − 기각/상정
function mergeOpen(prevOpen, r, closed) {
  const byId = new Map()
  const resolved = new Set(((r.audit && r.audit.resolvedIds) || []))
  for (const f of gateFindings(r.audit)) byId.set(f.id, f)
  for (const src of [r.audit, r.qa, r.ux]) for (const f of ((src && src.findings) || [])) byId.set(f.id, f)
  for (const f of prevOpen) {
    if (f.id.startsWith('GATE-')) continue // 게이트는 매 라운드 새로 판정
    if (!byId.has(f.id) && !resolved.has(f.id)) byId.set(f.id, f) // 아무도 해결 확인 안 함 → 유지
  }
  const all = [...byId.values()].filter((f) => !resolved.has(f.id) && !closed.has(f.id))
  return { serious: all.filter(isSerious), minor: all.filter((f) => !isSerious(f)) }
}

// 검토는 순차: qa-breaker → ux-reviewer → auditor.
// 셋 다 같은 작업 트리에서 커밋하므로 병렬이면 git 잠금 충돌·미커밋 변경 오탐이 난다.
// auditor가 마지막에 돌아야 qa가 추가한 실패 테스트까지 포함해 게이트를 판정한다.
async function review(round, prevOpen, withQa) {
  const ph = round === 0 ? 'Review' : 'Fix'
  const prev = prevOpen.length ? `\n\n[이전 라운드 열린 지적 — 각각 해결 여부를 확인해 resolvedIds 또는 findings(같은 ID)로 반드시 응답]\n${j(prevOpen)}` : ''
  let qa = null
  let ux = null
  if (withQa) {
    qa = await agent(
      `${head('qa-breaker')}\n\n[할 일] 라운드 ${round}. 이번 스프린트 범위를 깨뜨려라. 재현한 버그는 tests/adversarial/ 에 실패하는 테스트로 남기고 [qa] ${S}: 로 커밋. 끝날 때 커밋 안 된 변경이 없어야 한다.${round > 0 ? ' 이전 Q- 지적이 정말 고쳐졌는지 다시 공격하고, 수정으로 생긴 새 구멍을 찾아라.' : ''}${prev}`,
      role('qa-breaker', { phase: ph, label: `qa:r${round}`, schema: QA_OUT }),
    )
  }
  if (UX && round === 0) {
    ux = await agent(
      `${head('ux-reviewer')}\n\n[할 일] 이번 스프린트에서 바뀐 화면과 흐름을 실제로 띄워 점검하고 스크린샷을 ${DIR}/ux/ 에 남겨 [ux] ${S}: 로 커밋.`,
      role('ux-reviewer', { phase: ph, label: 'ux', schema: UX_OUT }),
    )
  }
  const qaNote = qa && (qa.failingTestsAdded || []).length ? `\n\n[qa-breaker가 이번 라운드에 추가한 실패 테스트 — 게이트에 포함됨]\n${j(qa.failingTestsAdded)}` : ''
  const audit = await agent(
    `${head('auditor')}\n\n[할 일] 라운드 ${round} 감사.\n1) 게이트 실행: pnpm verify / node scripts/harness/check-protected.mjs $(cat ${DIR}/BASE)\n2) ${DIR}/acceptance.md 의 기준과 스프린트 spec ID마다 구현·테스트 위치를 추적(traceability).\n3) DOMAIN_RULES 불변식·규칙, 금액, 멱등성, 보안·개인정보·유튜브 정책, 테스트 품질 감사.\n변경 범위는 git diff $(cat ${DIR}/BASE)..HEAD 로 본다. qa-breaker의 지적과 중복되는 지적은 새로 만들지 말고 그 ID를 인용하라.${qaNote}${prev}`,
    role('auditor', { phase: ph, label: `audit:r${round}`, schema: AUDIT_OUT, effort: 'high' }),
  )
  return { audit, qa, ux }
}

// ───────────────────────── ① Spec ─────────────────────────
phase('Spec')
const spec = await agent(
  `${head('spec-keeper')}\n\n[할 일]\n1) ${DIR}/BASE 가 없으면 git rev-parse HEAD 기록.\n2) 백로그의 ${S} 범위를 ${DIR}/acceptance.md 수용 기준으로 작성 (AC-${S}-번호, spec ID, Given/When/Then, 확인 방법, 범위 밖 항목).\n3) 판정·정산·파서 관련은 tests/golden/ 에 시나리오 추가·보강 (기존 약화 금지).\n4) 모호한 점은 docs/DECISIONS.md 에 추가. 판정·금액·외부 게시·개인정보·비용에 영향 → blocking.\n5) [spec] ${S}: 로 커밋.`,
  role('spec-keeper', { phase: 'Spec', label: `spec:${S}`, schema: SPEC_OUT }),
)
if (!spec) return { status: 'ERROR', sprint: S, stage: 'spec' }
const blocking = (spec.decisions || []).filter((d) => d.blocking)
if (!spec.ready || blocking.length) {
  log(`스펙 단계에서 멈춤: 결정 필요 ${blocking.length}건`)
  return { status: 'BLOCKED', sprint: S, stage: 'spec', decisions: blocking, specSummary: spec.summary }
}
log(`수용 기준 ${spec.acceptanceCount || '?'}개, 골든 변경 ${(spec.goldenChanged || []).length}개`)

// ───────────────────────── ② Build ─────────────────────────
phase('Build')
const builds = []
const build = await agent(
  `${head('developer')}\n\n[할 일] ${DIR}/acceptance.md 와 관련 골든 시나리오를 모두 통과하도록 구현한다.\n- 작게 나눠 [dev] ${S}: 로 커밋, 끝날 때 커밋 안 된 변경 없음.\n- 마지막에 pnpm verify 실행, 결과를 그대로 보고.\n- 스펙과 다르게 해야 한다고 판단되면 구현하지 말고 ${DIR}/dev-notes.md 에 적고 disputesWithSpec 으로 보고.\n\n[spec-keeper 요약]\n${spec.summary}`,
  role('developer', { phase: 'Build', label: `dev:${S}` , schema: BUILD_OUT }),
)
if (!build) return { status: 'ERROR', sprint: S, stage: 'build' }
builds.push(build)

// ───────────────────────── ③ Review ─────────────────────────
phase('Review')
const closed = new Set()
const decisions = []
const escalated = []
let r = await review(0, [], true)
let qaHadFindings = ((r.qa && r.qa.findings) || []).some(isSerious)
let open = mergeOpen([], r, closed)
log(`1차 검토: blocker/major ${open.serious.length}건, minor/nit ${open.minor.length}건`)

// ───────────────────────── ④ Fix ─────────────────────────
let round = 0
while (open.serious.length && round < MAX_FIX) {
  round++
  phase('Fix')
  const fix = await agent(
    `${head('developer')}\n\n[할 일] 수정 라운드 ${round}/${MAX_FIX}. 아래 blocker/major 지적 각각에 FIXED / DISPUTED(스펙 인용 필수) / DEFERRED(minor·nit만)로 responses 에 응답하라. GATE- 지적은 게이트를 통과시키는 것으로 해결한다(테스트를 약화시키는 방식 금지).\n[dev] ${S}: 로 커밋, 마지막에 pnpm verify.\n\n[열린 지적]\n${j(open.serious)}`,
    role('developer', { phase: 'Fix', label: `fix:r${round}`, schema: BUILD_OUT }),
  )
  if (fix) builds.push(fix)
  const disputes = ((fix && fix.responses) || []).filter((x) => x.action === 'DISPUTED')
  if (disputes.length) {
    const pairs = disputes.map((d) => ({ finding: open.serious.find((f) => f.id === d.findingId) || { id: d.findingId }, developerArgument: d.note }))
    const arb = await agent(
      `${head('spec-keeper')}\n\n[할 일] 분쟁 판정. 각 지적에 대해 SPEC/DOMAIN_RULES 문장을 인용해 UPHOLD / DISMISS / NEEDS_DECISION 으로 판정하라. NEEDS_DECISION 은 docs/DECISIONS.md 에 항목을 추가하고 decisions 로도 돌려줘라. 수정했다면 [spec] ${S}: 로 커밋.\n\n${j(pairs)}`,
      role('spec-keeper', { phase: 'Fix', label: `arbitrate:r${round}`, schema: ARB_OUT }),
    )
    for (const x of ((arb && arb.rulings) || [])) {
      if (x.ruling === 'DISMISS') closed.add(x.findingId)
      if (x.ruling === 'NEEDS_DECISION') { closed.add(x.findingId); escalated.push(x) }
    }
    decisions.push(...((arb && arb.decisions) || []))
    log(`분쟁 ${disputes.length}건 판정 완료`)
  }
  const qaOpen = open.serious.some((f) => f.id.startsWith('Q-')) || qaHadFindings
  r = await review(round, open.serious.concat(open.minor), qaOpen)
  qaHadFindings = ((r.qa && r.qa.findings) || []).some(isSerious)
  open = mergeOpen(open.serious.concat(open.minor), r, closed)
  log(`라운드 ${round} 재검토: blocker/major ${open.serious.length}건`)
}
if (open.serious.length && round >= MAX_FIX) log(`수정 라운드 상한(${MAX_FIX}) 도달 — 남은 blocker/major ${open.serious.length}건은 오케스트레이터 판단으로 넘김`)

const status = escalated.length || decisions.some((d) => d.blocking) ? 'BLOCKED' : open.serious.length ? 'FAIL' : 'PASS'

// ───────────────────────── ⑤ Report ─────────────────────────
phase('Report')
const result = {
  status,
  sprint: S,
  rounds: round,
  openSerious: open.serious,
  minors: open.minor,
  decisions,
  escalated,
  specSummary: spec.summary,
  buildSummaries: builds.map((b) => b.summary),
  lastVerify: builds.length ? builds[builds.length - 1].verify : null,
  traceability: (r.audit && r.audit.traceability) || [],
  qaTestsAdded: ((r.qa && r.qa.failingTestsAdded) || []),
}
await agent(
  `너는 하네스 리포터다. 아래 결과로 ${DIR}/report.md 를 한국어로 작성하라. 구성: 결과(${status}) 한 줄 → 만든 것 → 남은 blocker/major → 결정 필요 사항 → minor/nit 백로그 → 추적성 표 → 다음 스프린트 제안.\n그리고 harness/backlog.yaml 의 ${S} 항목 status 를 ${status === 'PASS' ? 'done' : status.toLowerCase()} 로 바꾸고, minor/nit 는 같은 파일의 techDebt 목록에 ID와 제목만 추가하라.\n그 두 파일만 수정하고 [harness] ${S}: report 로 커밋하라.\n\n${j(result)}`,
  { phase: 'Report', label: 'report', effort: 'low' },
)
return result

#!/usr/bin/env node
// 하네스 보호 경로 게이트
// 사용: node scripts/harness/check-protected.mjs <baseRef>
// 1) baseRef..HEAD 커밋마다 제목 접두어([spec]/[dev]/[qa]/[ux]/[harness]/[orch])로 역할을 판별하고,
//    역할이 건드리면 안 되는 경로를 건드렸는지 검사한다.
// 2) 추적 중인 테스트 파일에 금지 패턴(.only/.skip/todo 등)이 있는지 검사한다.
// 3) 커밋 안 된 변경이 있는지 검사한다.
// 종료 코드: 0 통과, 1 위반, 2 사용법 오류
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const base = process.argv[2]
if (!base) {
  console.error('사용법: node scripts/harness/check-protected.mjs <baseRef>')
  process.exit(2)
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const SPRINT_FILE = (name) => new RegExp(`^harness/sprints/[^/]+/${name}$`)
const ROLES = {
  // allow: 이 목록 안만 수정 가능 / deny: 이 목록만 수정 불가
  spec: { allow: [/^docs\/spec\//, /^docs\/DECISIONS\.md$/, /^tests\/golden\//, SPRINT_FILE('acceptance\\.md'), SPRINT_FILE('BASE')] },
  dev: {
    deny: [/^docs\/spec\//, /^docs\/DECISIONS\.md$/, /^tests\/golden\//, /^tests\/adversarial\//, /^\.claude\//, /^scripts\/harness\//, /^CLAUDE\.md$/, /^harness\//],
    except: [SPRINT_FILE('dev-notes\\.md')],
  },
  qa: { allow: [/^tests\/adversarial\//, SPRINT_FILE('qa-notes\\.md')] },
  ux: { allow: [/^harness\/sprints\/[^/]+\/ux\//] },
  harness: { allow: [SPRINT_FILE('report\\.md'), /^harness\/backlog\.yaml$/] },
  orch: { allow: [/.*/] }, // 오케스트레이터(메인 세션·사용자)
}

const violations = []

// 1) 커밋별 역할 검사
const log = git('log', '--no-merges', '--format=%x00%H%x09%s', '--name-only', `${base}..HEAD`)
for (const chunk of log.split('\0').filter((c) => c.trim())) {
  const [headLine, ...rest] = chunk.split('\n')
  const [hash, subject = ''] = headLine.split('\t')
  const files = rest.map((s) => s.trim()).filter(Boolean)
  const m = subject.match(/^\[(spec|dev|qa|ux|harness|orch)\]/)
  if (!m) {
    violations.push(`${hash.slice(0, 8)} 역할 접두어 없는 커밋: "${subject}"`)
    continue
  }
  const rule = ROLES[m[1]]
  for (const f of files) {
    let bad = false
    if (rule.allow) bad = !rule.allow.some((re) => re.test(f))
    if (rule.deny) bad = rule.deny.some((re) => re.test(f)) && !(rule.except || []).some((re) => re.test(f))
    if (bad) violations.push(`${hash.slice(0, 8)} [${m[1]}] 권한 밖 수정: ${f}`)
  }
}

// 2) 금지 패턴 (예외: 같은 줄에 "harness-allow: D-xxx" 주석)
const FORBIDDEN = [/\b(it|test|describe)\.only\s*\(/, /\b(it|test|describe)\.skip\s*\(/, /\b(xit|xdescribe|xtest)\s*\(/, /\b(it|test)\.todo\s*\(/]
const tracked = git('ls-files').split('\n').filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /^tests\/.*\.[cm]?[jt]sx?$/.test(f))
for (const f of tracked) {
  let text
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  text.split('\n').forEach((line, i) => {
    if (/harness-allow:\s*D-\d+/.test(line)) return
    if (FORBIDDEN.some((re) => re.test(line))) violations.push(`금지 패턴 ${f}:${i + 1}: ${line.trim()}`)
  })
}

// 3) 커밋 안 된 변경
const dirty = git('status', '--porcelain').trim()
if (dirty) violations.push(`커밋 안 된 변경:\n${dirty}`)

if (violations.length) {
  console.log(`보호 경로 게이트 실패 (${violations.length}건)`)
  for (const v of violations) console.log(` - ${v}`)
  process.exit(1)
}
console.log('보호 경로 게이트 통과')

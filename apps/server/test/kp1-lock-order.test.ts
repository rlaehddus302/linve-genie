// KP1 RA-KP1-010 락 순서 규칙: 범위 락 → 장부 락만 있다. 장부 락을 잡은 트랜잭션 안에서는 범위 줄·범위 락·날짜 재료를 부르지 않는다.
// 소스를 읽어 장부 락을 잡는 트랜잭션 덩어리마다 금지된 호출이 없는지, 링크 배송지 저장이 표지를 범위 줄 밖에서 미리 받는지 본다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

/** 장부 락을 잡은 쪽이 부르면 안 되는 것 (범위 줄·범위 락·날짜 재료) */
const FORBIDDEN = /withScope|scopeLockKey|readDetached|writer\.|readState|factsFor|knownMarkers|markerFacts|allFacts|realScopes/

/** `transaction(` 뒤 괄호 덩어리들 */
function transactionBlocks(source: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = source.indexOf('.transaction(', from)
    if (at < 0) return out
    let depth = 0
    let end = at + '.transaction'.length
    for (; end < source.length; end += 1) {
      const char = source[end]
      if (char === '(') depth += 1
      else if (char === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    out.push(source.slice(at, end + 1))
    from = end + 1
  }
}

describe('RA-KP1-010 장부 락을 쥔 쪽은 범위 락을 잡지 않는다', () => {
  it('ledger-store.ts는 범위 줄·범위 락·날짜 재료를 쓰지 않고, 순서 규칙을 주석으로 적어 둔다', () => {
    const store = read('customers/ledger-store.ts')
    const code = store.split('\n').filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')).join('\n')
    expect(code).not.toMatch(FORBIDDEN)
    expect(store).toContain('장부 락을 잡은 트랜잭션 안에서는')
    expect(store).toContain('범위 락 → 장부 락')
  })

  it('ledger.ts에서 장부 락을 잡는 트랜잭션 덩어리마다 범위 줄·범위 락·날짜 재료 호출이 없다', () => {
    const blocks = transactionBlocks(read('customers/ledger.ts')).filter((block) => block.includes('lockLedger('))
    expect(blocks.length).toBeGreaterThanOrEqual(3)
    for (const block of blocks) expect(block).not.toMatch(FORBIDDEN)
  })

  it('링크 배송지 저장: 표지는 범위 줄 밖에서 미리 받고, 범위 줄 안 트랜잭션에서 장부 동의(장부 락)를 잡는다 — 범위 락 → 장부 락', () => {
    const parcel = read('parcel/service.ts')
    const start = parcel.indexOf('async saveFromLink(')
    const body = parcel.slice(start, parcel.indexOf('\n  }\n', start))
    const known = body.indexOf('knownMarkers(')
    const scope = body.indexOf('withScope(')
    const consent = body.indexOf('consentInTx(')
    expect(known).toBeGreaterThan(0)
    expect(known).toBeLessThan(scope)
    expect(consent).toBeGreaterThan(scope)
  })
})

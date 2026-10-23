// AC-A1-12 환경 변수·문서 (D-A1-04·D-A1-08): .env.example·docs/DEPLOY.md·docs/OWNER-GUIDE.md에 AI 제안 변수·키 만들기·결제 한도·끄는 법·비용 감·고지가 있고,
// 키 값 예시는 가짜(sk-ant-… 모양 금지). 연습 모드(scripts/try/try.mjs)는 가짜 LLM 서버와 가짜 키를 켠다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ASSIST_ENV, DEFAULT_GLOBAL_DAILY_CALLS, DEFAULT_SELLER_DAILY_CALLS } from '../src/assist/service.ts'

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const NAMES = Object.values(ASSIST_ENV)

describe('AC-A1-12 환경 변수·문서·연습 모드', () => {
  it('.env.example: 넷 다 빈 값으로, 설명과 함께. 기본 상한 20·500. 키 예시는 가짜', () => {
    const example = read('.env.example')
    for (const name of NAMES) expect(example).toMatch(new RegExp(`^${name}=$`, 'm'))
    expect(DEFAULT_SELLER_DAILY_CALLS).toBe(20)
    expect(DEFAULT_GLOBAL_DAILY_CALLS).toBe(500)
    expect(example).toContain('비우면 20')
    expect(example).toContain('비우면 500')
    expect(example).toContain('여기에-키')
    for (const path of ['.env.example', 'docs/DEPLOY.md', 'docs/OWNER-GUIDE.md']) expect(read(path), path).not.toMatch(/sk-ant-/)
  })

  it('DEPLOY.md: 변수 넷·Anthropic 콘솔에서 키 만들기·결제 한도·끄는 법', () => {
    const doc = read('docs/DEPLOY.md')
    for (const name of NAMES) expect(doc).toContain(`\`${name}\``)
    for (const text of ['console.anthropic.com', 'API Keys', 'Limits', '끄는 법', 'https://api.anthropic.com']) expect(doc, text).toContain(text)
  })

  it('OWNER-GUIDE.md: 판매자에게 켜는 법·비용 감(호출 1번·하루 상한)·고지 내용을 쉬운 말로', () => {
    const doc = read('docs/OWNER-GUIDE.md')
    for (const text of ['AI 제안', '켜는 법', '하루 **20번**', '하루 **500번**', '몇 원', 'Anthropic, 미국', '닉네임·전화번호는 빼고', '언제든 [끄기]']) expect(doc, text).toContain(text)
  })

  it('연습 모드: 가짜 LLM 서버(/_try/llm)와 가짜 키로 AI 제안을 켠다 — 실제 주소로 나가지 않는다', () => {
    const script = read('scripts/try/try.mjs')
    expect(script).toContain("new FakeLlm({ practice: true, basePath: '/_try/llm' })")
    expect(script).toContain('assist: llm.setup(')
    expect(script).not.toContain('api.anthropic.com')
  })
})

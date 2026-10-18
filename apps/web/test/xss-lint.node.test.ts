// @vitest-environment node
// 화면 XSS 린트 (AC-S00-06): apps/web에서 HTML 문자열을 그대로 넣는 코드를 쓰면 lint 단계가 실패한다.
// 저장소의 실제 ESLint 설정(eslint.config.mjs)으로 예시 코드를 린트한다. 설정이 약해지면 이 테스트가 잡는다.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const eslint = new ESLint({ cwd: ROOT })
const RAW = 'dangerously' + 'SetInnerHTML'

async function lint(code: string, filePath = 'apps/web/src/__probe__.tsx') {
  const [result] = await eslint.lintText(code, { filePath })
  if (!result) throw new Error('린트 결과가 없다')
  return result.messages
}

async function xssMessages(code: string, filePath?: string) {
  const messages = await lint(code, filePath)
  // 문법 오류로 린트가 안 된 경우를 "통과"로 착각하지 않게 따로 확인한다
  expect(messages.filter((m) => m.fatal)).toEqual([])
  return messages.filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('NFR-06'))
}

describe('화면 XSS 린트', () => {
  it.each([
    ['JSX 속성', `export const A = (p: { h: string }) => <div ${RAW}={{ __html: p.h }} />\n`],
    ['createElement 속성', `import { createElement } from 'react'\nexport const a = (h: string) => createElement('div', { ${RAW}: { __html: h } })\n`],
    ['펼친 객체', `export const A = (p: { h: string }) => <div {...{ ${RAW}: { __html: p.h } }} />\n`],
    ['문자열 키', `export const props = (h: string) => ({ '${RAW}': { __html: h } })\n`],
    ['계산된 키', `export const props = (h: string) => ({ ['${RAW}']: { __html: h } })\n`],
    ['템플릿 문자열 키', `export const props = (h: string) => ({ [\`${RAW}\`]: { __html: h } })\n`],
    ['속성 읽기', `export const read = (p: Record<string, unknown>) => p.${RAW}\n`],
    ['innerHTML 대입', `export const put = (el: HTMLElement, h: string) => { el.innerHTML = h }\n`],
    ['innerHTML 덧붙이기', `export const put = (el: HTMLElement, h: string) => { el.innerHTML += h }\n`],
    ['outerHTML 대입', `export const put = (el: HTMLElement, h: string) => { el['outerHTML'] = h }\n`],
    ['insertAdjacentHTML', `export const put = (el: HTMLElement, h: string) => el.insertAdjacentHTML('beforeend', h)\n`],
    ['document.write', `export const put = (h: string) => document.write(h)\n`],
  ])('%s → 실패', async (_name, code) => {
    const messages = await xssMessages(code)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0]?.severity).toBe(2)
    expect(messages[0]?.message).toContain('React 기본 이스케이프')
  })

  it.each([
    ['test 폴더', 'apps/web/test/__probe__.test.tsx'],
    ['설정 파일', 'apps/web/vite.config.ts'],
    ['jsx 파일', 'apps/web/src/__probe__.jsx'],
  ])('apps/web의 %s에도 적용된다', async (_name, filePath) => {
    const code = filePath.endsWith('.jsx') ? `export const A = (p) => <div ${RAW}={{ __html: p.h }} />\n` : `export const p = { ${RAW}: { __html: '' } }\n`
    expect(await xssMessages(code, filePath)).not.toHaveLength(0)
  })

  it('채팅 글자를 JSX 자식으로 그리는 코드는 통과한다', async () => {
    const code = `export const Chat = (p: { nick: string; text: string }) => (\n  <p>\n    <strong>{p.nick}</strong> {p.text}\n  </p>\n)\n`
    expect(await lint(code)).toEqual([])
  })

  it('textContent로 글자를 넣는 코드는 통과한다', async () => {
    const code = `export const put = (el: HTMLElement, text: string) => { el.textContent = text }\n`
    expect(await lint(code)).toEqual([])
  })
})

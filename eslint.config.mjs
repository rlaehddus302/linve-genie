// 저장소 공용 ESLint 설정 (AC-S00-04, AC-S00-05). 경고도 실패다: `eslint . --max-warnings 0`
import { builtinModules } from 'node:module'
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** 코어 순수성 위반 메시지. "코어는 순수 함수"가 반드시 들어간다 (AC-S00-05). */
const pure = (why) => `코어는 순수 함수여야 한다(D-024, NFR-02): ${why}`

const CLOCK = pure('시계를 읽지 않는다. 시각은 이벤트의 at(UTC 밀리초)으로만 받는다.')
const RANDOM = pure('난수를 쓰지 않는다. 같은 이벤트 열은 같은 결과를 내야 한다.')
const IO = pure('입출력·실행 환경에 접근하지 않는다. 필요한 값은 인자로 받는다.')
const TIMER = pure('타이머·비동기 예약을 쓰지 않는다. 시간 흐름은 이벤트로 들어온다.')
const LOCALE = pure('실행 환경의 언어·시간대 설정에 따라 결과가 달라지는 API를 쓰지 않는다. 표시 형식은 직접 구현한다.')
const NODE = pure('Node 내장 모듈을 쓰지 않는다.')

const restrictedGlobals = [
  ...['Date', 'Temporal', 'performance'].map((name) => ({ name, message: CLOCK })),
  ...['crypto'].map((name) => ({ name, message: RANDOM })),
  ...[
    'process',
    'console',
    'globalThis',
    'global',
    'window',
    'self',
    'require',
    'module',
    'Buffer',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'navigator',
    'document',
    'localStorage',
    'sessionStorage',
  ].map((name) => ({ name, message: IO })),
  ...[
    'setTimeout',
    'setInterval',
    'setImmediate',
    'queueMicrotask',
    'clearTimeout',
    'clearInterval',
    'clearImmediate',
    'requestAnimationFrame',
    'requestIdleCallback',
  ].map((name) => ({ name, message: TIMER })),
  ...['Intl'].map((name) => ({ name, message: LOCALE })),
]

const restrictedProperties = [
  { object: 'Math', property: 'random', message: RANDOM },
  ...['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toLocaleUpperCase', 'toLocaleLowerCase', 'localeCompare'].map(
    (property) => ({ property, message: LOCALE }),
  ),
]

// 접두어 없는 이름은 paths로, `node:` 접두어는 정규식 패턴 하나로 막는다
const bareBuiltins = builtinModules.filter((name) => !name.startsWith('node:'))

/**
 * 코어 소스 주석 검사 (AC-S00-05, AC-S00-13, D-024).
 * - 순수성 규칙은 소스 안 주석으로 끌 수 없다. 코어 블록의 `noInlineConfig`가 주석을 무시하게 하고,
 *   여기서는 그런 주석 자체를 오류로 알려 리뷰 없이도 눈에 띄게 한다.
 * - 커버리지 무시 주석(v8·c8·istanbul·node:coverage ignore)은 95% 기준과 "모든 소스 파일 측정"을 우회하므로 쓸 수 없다.
 *   Vitest v8 커버리지(ast-v8-to-istanbul)가 따르는 표기를 모두 막는다. 대소문자는 가리지 않는다.
 */
const LINT_DIRECTIVE = /^\s*(?:eslint-disable(?:-line|-next-line)?|eslint-enable|eslint-env|eslint)(?=\s|$)/
const BLOCK_DIRECTIVE = /^\s*(?:globals?|exported)(?=\s|$)/
const COVERAGE_IGNORE = /(?:istanbul|[cv]8|node:coverage)\s+ignore(?=\W|$)/i
const coreGuards = {
  meta: { name: 'livejjim-core-guards' },
  rules: {
    'no-inline-lint-config': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          directive: pure('린트 규칙을 끄거나 바꾸는 주석은 코어 소스에서 쓸 수 없다. 순수성 규칙은 주석으로 꺼지지 않는다(설정 noInlineConfig).'),
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const isDirective = LINT_DIRECTIVE.test(comment.value) || (comment.type === 'Block' && BLOCK_DIRECTIVE.test(comment.value))
              if (isDirective) context.report({ loc: comment.loc, messageId: 'directive' })
            }
          },
        }
      },
    },
    'no-coverage-ignore': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          ignore:
            '코어 커버리지 측정에서 코드를 빼는 주석은 쓸 수 없다(AC-S00-13: packages/core/src의 모든 소스를 측정하고 라인·분기 95% 이상). 테스트를 추가한다.',
        },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (COVERAGE_IGNORE.test(comment.value)) context.report({ loc: comment.loc, messageId: 'ignore' })
            }
          },
        }
      },
    },
  },
}

/** 화면 XSS 방지 메시지 (AC-S00-06, NFR-06, CLAUDE.md 규칙 7). */
const xss = (why) => `화면에 HTML 문자열을 그대로 넣지 않는다(NFR-06): ${why} 채팅·닉네임 같은 글자는 React 기본 이스케이프로만 보여 준다.`
const RAW_HTML_PROP = xss('dangerouslySetInnerHTML은 쓰지 않는다.')
const RAW_HTML_DOM = xss('innerHTML·outerHTML 대입, insertAdjacentHTML, document.write는 쓰지 않는다.')

const rawHtmlSyntax = [
  // JSX 속성 <div dangerouslySetInnerHTML={...} />
  { selector: "JSXIdentifier[name='dangerouslySetInnerHTML']", message: RAW_HTML_PROP },
  // createElement('div', { dangerouslySetInnerHTML }), 펼친 객체 {...{ dangerouslySetInnerHTML }}, props.dangerouslySetInnerHTML
  { selector: "Identifier[name='dangerouslySetInnerHTML']", message: RAW_HTML_PROP },
  // { 'dangerouslySetInnerHTML': ... }, props['dangerouslySetInnerHTML'], 템플릿 문자열 키
  { selector: "Literal[value='dangerouslySetInnerHTML']", message: RAW_HTML_PROP },
  { selector: "TemplateElement[value.cooked='dangerouslySetInnerHTML']", message: RAW_HTML_PROP },
  // DOM으로 직접 HTML 넣기
  { selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]", message: RAW_HTML_DOM },
  { selector: "AssignmentExpression > MemberExpression.left[property.value=/^(innerHTML|outerHTML)$/]", message: RAW_HTML_DOM },
  { selector: "CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']", message: RAW_HTML_DOM },
  { selector: "CallExpression > MemberExpression.callee[object.name='document'][property.name=/^(write|writeln)$/]", message: RAW_HTML_DOM },
]

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/.vite/',
    // 오케스트레이터·하네스 소유 (개발자가 고칠 수 없는 경로)
    '.claude/',
    'scripts/harness/',
    // tests/ 아래는 적대 테스트만 린트한다 (AC-S00-03 범위)
    'tests/*',
    '!tests/adversarial/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },

  // 저장소 도구 스크립트(.mjs/.js)는 Node에서 돈다
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 코어 순수성 (AC-S00-05, D-024). packages/core/test(골든 러너 포함)와 다른 패키지에는 적용하지 않는다.
  {
    files: ['packages/core/src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    // 소스 안의 eslint-disable·인라인 설정·global 주석을 모두 무시한다 → 순수성 규칙을 주석으로 끌 수 없다 (TD-S00-003)
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    languageOptions: { globals: { ...globals.es2024 } },
    plugins: { 'core-guards': coreGuards },
    rules: {
      'core-guards/no-inline-lint-config': 'error',
      'core-guards/no-coverage-ignore': 'error',
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-restricted-syntax': [
        'error',
        { selector: "TSTypeReference[typeName.name='Date']", message: CLOCK },
        { selector: 'MemberExpression[property.name=/^toLocale/]', message: LOCALE },
        { selector: 'MemberExpression[property.value=/^toLocale/]', message: LOCALE },
        { selector: 'ImportExpression', message: IO },
        { selector: "CallExpression[callee.name='require']", message: IO },
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: bareBuiltins.map((name) => ({ name, message: NODE })),
          patterns: [{ regex: '^node:', message: NODE }],
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // 웹 화면 XSS 방지 (AC-S00-06, NFR-06). apps/web 전체(src·test·설정)에 적용한다.
  {
    files: ['apps/web/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-syntax': ['error', ...rawHtmlSyntax],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
)

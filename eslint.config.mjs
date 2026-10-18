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
    languageOptions: { globals: { ...globals.es2024 } },
    rules: {
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
)

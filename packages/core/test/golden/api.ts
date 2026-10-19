// 골든 러너 프로그램 API — import 경로: `@livejjim/core/golden` (AC-S00-15, AC-S00-23)
// tests/adversarial 같은 테스트에서 다른 골든 폴더·허용 목록·가짜 코어로 러너를 돌릴 때 쓴다.
// CLI(pnpm golden)는 이 API를 고정 경로로만 부른다.
export { runGoldenSources, type GoldenSource, type RunGoldenSourcesOptions } from './runner.ts'
export { runGoldenDir, listGoldenFiles, type RunGoldenDirOptions } from './fs-runner.ts'
export { formatReport, formatTotals, itemLocation, itemStatusLabel } from './report.ts'
export { realCore } from './core-adapter.ts'
export { smsPhoneFields, testPhoneKey, TEST_PHONE_SECRET, type SmsPhoneFields } from './phone-key.ts'
export { createFakeCore, emptySnapshot, type FakeCoreOptions } from './fake-core.ts'
export { parseGoldenYaml, type YamlDocument, type YamlParseResult } from './yaml.ts'
export { validateDocument, formatPath, type Expect, type ScenarioDoc, type ParserSuiteDoc, type ValidationResult } from './validate.ts'
export { compareExpect, compareParserOutput } from './compare.ts'
export { readAllowlist, patternToRegExp, type Allowlist } from './allowlist.ts'
export { resolveAt, formatUtcIso, parseDate, isValidReceived, daysFromCivil, civilFromDays, KST_OFFSET_MINUTES } from './time.ts'
export { stableSerialize, SerializationError } from './serialize.ts'
export * from './contract.ts'
export type * from './types.ts'

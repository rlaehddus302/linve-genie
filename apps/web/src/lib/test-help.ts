// 테스트 인쇄 "아니요" 뒤 도움말 (PRN2 UX-PRN2-001 — 웹·앱 같은 목록): 이은 프린터 프로필에 맞는 줄만.
// - 실험 기종이면 맨 위에 제조사 앱(프로필의 대체 경로 앱)으로 그림 파일을 인쇄하는 길 (L-7 기본 대체)
// - 크기 줄은 테스트 라벨을 찍은 크기, 농도 줄은 농도를 받는 프린터만, 정품 줄은 NIIMBOT만, 맨 아래 테두리 줄은 마지막 흰 줄을 더하는 프린터만(B1 계열 — L-7)
// 프로필을 모르면 B1 목록. 순수 함수 — 앱(apps/mobile)도 이 파일을 그대로 쓴다.
import { isLabelSize, labelSizeName } from '@livejjim/label'
import { B1_PROFILE, printerProfile, printerSupportStage } from '@livejjim/printer'

/** 실험 기종의 "아니요" 뒤 맨 위 줄 — 이 프린터로 찍지 말고 그림 파일로 제조사 앱에서 */
export const testFallbackLine = (app: string): string => `잘 안 나오면 이 프린터로 찍지 말고, 라벨을 그림 파일로 저장해 ${app}에서 인쇄해 주세요.`

/** 화면 크기 이름 + mm ("50×30mm", "테이프 12×40mm") — L-1 목록 밖이면 받은 글 그대로 */
export function sizeWordMm(size: string): string {
  return isLabelSize(size) ? `${labelSizeName(size)}mm` : size
}

export interface TestHelp {
  /** 실험 기종이면 그 프로필의 제조사 앱 이름 (아니면 null) */
  readonly fallbackApp: string | null
  /** 목록 줄 (실험 기종이면 첫 줄이 testFallbackLine) */
  readonly lines: readonly string[]
}

/** 테스트 인쇄 "아니요" 뒤 도움말 — profileId: 이은 프린터 프로필(모르면 null), size: 테스트 라벨을 찍은 크기 */
export function testHelp(profileId: string | null, size: string): TestHelp {
  const profile = (profileId === null ? undefined : printerProfile(profileId)) ?? B1_PROFILE
  const experimental = printerSupportStage(profile.id) === 'EXPERIMENTAL'
  const lines: string[] = []
  if (experimental) lines.push(testFallbackLine(profile.fallbackApp))
  lines.push(`라벨 크기가 ${sizeWordMm(size)}인지 확인해 주세요.`)
  if (profile.density !== null) lines.push('인쇄 농도를 한 단계 올려 보세요.')
  if (profile.maker === 'NIIMBOT') lines.push('NIIMBOT 정품 라벨인지 확인해 주세요.')
  const extraRows = (profile as { readonly extraBlankRows?: unknown }).extraBlankRows
  if (typeof extraRows === 'number' && extraRows > 0) lines.push('맨 아래 테두리가 빠지면 알려 주세요.')
  return { fallbackApp: experimental ? profile.fallbackApp : null, lines }
}

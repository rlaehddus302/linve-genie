// 간편 로그인 가린 이름 (L1, D-L1-05, AC-L1-08). 순수 함수 — 이메일·닉네임 원문은 저장하지 않고 이 값만 둔다.
// - 이메일(`@`가 있고 `@`로 시작·끝나지 않음): 앞 2글자 + `***` + `@도메인`. 앞이 2글자 이하면 첫 글자 + `***`.
// - 이메일이 없거나 모양이 아니면 닉네임 첫 글자 + `***`, 둘 다 없으면 빈 값.
// - 글자 수는 코드 포인트로 센다. 제어·서식 글자(줄바꿈·방향 바꾸기·폭 없는 글자 등)는 빼고, 40자에서 자른다. 화면은 늘 이스케이프한다.

export const MASKED_LABEL_MAX = 40
const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.replace(STRIP, '').trim() : '')

export function maskedLabel(email: string | null | undefined, nickname: string | null | undefined): string {
  const mail = clean(email)
  const at = mail.lastIndexOf('@')
  let label = ''
  if (at > 0 && at < mail.length - 1 && !mail.startsWith('@')) {
    const local = [...mail.slice(0, at)]
    const keep = local.length > 2 ? 2 : 1
    label = `${local.slice(0, keep).join('')}***${mail.slice(at)}`
  } else {
    const nick = [...clean(nickname)]
    if (nick.length > 0) label = `${nick[0] as string}***`
  }
  return [...label].slice(0, MASKED_LABEL_MAX).join('')
}

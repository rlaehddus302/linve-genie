// 시뮬레이터 화면 재기용 연습 로그인 (D-UX4-99, 사용자 지시 2026-11-10 "사진 첨부해서 비교 안해줘도 되게끔 너가 스스로 화면 캡처해서 토스 사진들이랑 비교하는 방법을 고안해"):
// 연습 모드 서버(pnpm try, https://localhost:7701)에 붙인 시뮬레이터 빌드만 EXPO_PUBLIC_TRY_LOGIN=1로 켠다 — 휴대폰 빌드에는 이 값이 없어 아무것도 하지 않는다.
// livejjim://try-login?id=<연습 아이디>&pw=<연습 비밀번호> 를 열면 그 계정으로 로그인한다(시뮬레이터는 글자 입력을 붙여 넣을 수 없어서).
export const TRY_LOGIN_ON = process.env.EXPO_PUBLIC_TRY_LOGIN === '1'

/** 연습 로그인 주소인가 (화면 이동은 하지 않는다) */
export function isTryLoginLink(path: string): boolean {
  return /^(?:livejjim:\/{2,3})?\/?try-login(?:[/?#]|$)/i.test(path.trim())
}

/** 주소 → 아이디·비밀번호 (꼴이 다르면 null) */
export function parseTryLogin(url: string): { readonly id: string; readonly pw: string } | null {
  if (!isTryLoginLink(url)) return null
  const query = url.split('?')[1] ?? ''
  const params = new URLSearchParams(query)
  const id = params.get('id')
  const pw = params.get('pw')
  return id === null || pw === null || id === '' || pw === '' ? null : { id, pw }
}

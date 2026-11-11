// 그림 파일 가져오기 (앱 번들러는 그림 번호, 시험(vite)은 주소 글자를 준다)
// 선언 파일(.d.ts)이 아니라 .ts — 범위 안 선언 파일은 skipLibCheck로 검사되지 않아 막는다(SA-S00-011, D-CI-01)
declare module '*.png' {
  const value: number | string
  export default value
}

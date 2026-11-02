// 그림 파일 가져오기 (앱 번들러는 그림 번호, 시험(vite)은 주소 글자를 준다)
declare module '*.png' {
  const value: number | string
  export default value
}

// 시험용 미리 보기 서버(serve.ts --drop-secure-cookie yes)가 쓰는 쿠키 다듬기 (I5 — 아이폰 크기 묶음만).

/** Set-Cookie 한 줄에서 Secure 속성만 뗀다 (값·나머지 속성은 그대로) */
export function dropSecure(cookie: string): string {
  return cookie
    .split(';')
    .filter((part, index) => index === 0 || part.trim().toLowerCase() !== 'secure')
    .join(';')
}

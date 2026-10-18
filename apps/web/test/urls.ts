// 테스트 공용: 외부 리소스 판별 (AC-S00-50 "외부 리소스 없음"). DOM·Node 어느 쪽 테스트에서도 쓴다.

/** 다른 곳에서 내려받는 주소인가: 스킴(https:, http: 등)이나 `//`로 시작하는 주소. data: 는 문서 안에 든 값이라 뺀다. */
export function isExternalUrl(value: string): boolean {
  const url = value.trim()
  if (url.startsWith('//')) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  return scheme !== null && scheme[1]?.toLowerCase() !== 'data'
}

/** HTML 문자열의 주소 속성(src·href 등) 값을 모두 꺼낸다. srcset은 쉼표로 나눠 주소만 꺼낸다. */
export function urlAttributes(html: string): string[] {
  const urls: string[] = []
  const pattern = /\s(src|href|srcset|poster|data|action|formaction|background|manifest)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi
  for (const match of html.matchAll(pattern)) {
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    if (match[1]?.toLowerCase() === 'srcset') urls.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? ''))
    else urls.push(value.trim())
  }
  return urls
}

/** CSS 안의 url(...)·@import 주소를 모두 꺼낸다. */
export function cssUrls(css: string): string[] {
  const urls: string[] = []
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) urls.push((match[1] ?? match[2] ?? match[3] ?? '').trim())
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) urls.push((match[1] ?? match[2] ?? '').trim())
  return urls
}

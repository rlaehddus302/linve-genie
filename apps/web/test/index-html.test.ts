// index.html 검사 (AC-S00-50): 한국어 문서, 제목, 휴대폰 화면 설정, 외부 리소스 없음.
import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import { cssUrls, isExternalUrl, urlAttributes } from './urls.ts'

const page = new DOMParser().parseFromString(indexHtml, 'text/html')

const URL_ATTRIBUTES = ['src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction', 'background', 'manifest']

describe('index.html', () => {
  it('문서 언어가 한국어다: <html lang="ko">', () => {
    expect(indexHtml).toMatch(/<html lang="ko">/)
    expect(page.documentElement.getAttribute('lang')).toBe('ko')
  })

  it('제목이 "라이브지니" 하나다', () => {
    const titles = page.querySelectorAll('title')
    expect(titles).toHaveLength(1)
    expect(titles[0]?.textContent).toBe('라이브지니')
    expect(indexHtml).toContain('<title>라이브지니</title>')
  })

  it('휴대폰 폭에 맞추는 viewport 설정이 있다', () => {
    const viewports = page.querySelectorAll('meta[name="viewport"]')
    expect(viewports).toHaveLength(1)
    // MOB1 D-MOB1-10: 휴대폰 키보드가 화면 높이를 줄이게(interactive-widget)
    expect(viewports[0]?.getAttribute('content')).toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content')
  })

  it('글자 인코딩이 UTF-8이다', () => {
    expect(page.querySelector('meta[charset]')?.getAttribute('charset')?.toUpperCase()).toBe('UTF-8')
  })

  it('화면을 붙일 #root와 진입 스크립트 하나만 있다', () => {
    expect(page.querySelectorAll('#root')).toHaveLength(1)
    const scripts = [...page.querySelectorAll('script')]
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.getAttribute('type')).toBe('module')
    expect(scripts[0]?.getAttribute('src')).toBe('/src/main.tsx')
  })

  it('외부 리소스(CDN·외부 글꼴·외부 스크립트)를 부르지 않는다', () => {
    const urls: string[] = []
    for (const element of page.querySelectorAll('*')) {
      for (const name of URL_ATTRIBUTES) {
        const value = element.getAttribute(name)
        if (value === null) continue
        if (name === 'srcset') urls.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0] ?? ''))
        else urls.push(value.trim())
      }
    }
    // PWA(AC-S06-50): 아이콘·애플 터치 아이콘·매니페스트는 같은 출처의 public 파일이다 (S05의 빈 아이콘 'data:,'를 바꿨다)
    // LND1 D-LND1-06: #root 안 정적 글의 정책 링크(같은 출처의 화면 주소) 둘
    expect(urls).toEqual(['/icons/icon-192.png', '/icons/apple-touch-icon.png', '/manifest.webmanifest', '/privacy', '/terms', '/src/main.tsx'])
    expect(urls.filter(isExternalUrl)).toEqual([])
    // 빌드 결과 검사(build.node.test.ts)가 쓰는 문자열 추출도 같은 결과를 내야 한다
    expect(urlAttributes(indexHtml)).toEqual(urls)
    expect(page.querySelector('base')).toBeNull()
    for (const style of page.querySelectorAll('style')) expect(cssUrls(style.textContent ?? '')).toEqual([])
  })

  it('PWA (AC-S06-50): 매니페스트 링크·theme-color·애플 터치 아이콘(180×180)', () => {
    expect(page.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
    expect(page.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(page.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')).toBe('/icons/apple-touch-icon.png')
  })

  it('보이는 글자에 영어(로마자)가 없다', () => {
    expect(page.title).not.toMatch(/[A-Za-z]/)
    expect(page.body.textContent ?? '').not.toMatch(/[A-Za-z]/)
  })
})

describe('외부 주소 판별 (테스트 도우미)', () => {
  it.each([
    ['https://cdn.example.com/a.js', true],
    ['http://fonts.example.com/a.css', true],
    ['//cdn.example.com/a.js', true],
    [' HTTPS://cdn.example.com/a.js', true],
    ['ftp://example.com/a', true],
    ['/src/main.tsx', false],
    ['./assets/a.js', false],
    ['assets/a.js', false],
    ['data:,', false],
    ['DATA:image/png;base64,AAAA', false],
  ])('%s → %s', (url, external) => {
    expect(isExternalUrl(url)).toBe(external)
  })

  it('HTML 속성에서 주소를 꺼낸다', () => {
    const html = `<link rel="stylesheet" href='https://fonts.example.com/a.css'><img srcset="a.png 1x, //cdn.example.com/b.png 2x" src=/x.png><script src="./y.js"></script>`
    expect(urlAttributes(html)).toEqual(['https://fonts.example.com/a.css', 'a.png', '//cdn.example.com/b.png', '/x.png', './y.js'])
  })

  it('CSS에서 url()·@import 주소를 꺼낸다', () => {
    const css = `@import "https://fonts.example.com/a.css"; @font-face { src: url( 'https://cdn.example.com/f.woff2' ) } a { background: url(./b.png) }`
    expect(cssUrls(css)).toEqual(['https://cdn.example.com/f.woff2', './b.png', 'https://fonts.example.com/a.css'])
  })
})

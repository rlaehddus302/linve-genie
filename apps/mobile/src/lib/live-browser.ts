// 앱 안 라이브 찾기 브라우저의 규칙 (D-UX4-160~163, 사용자 지시 2026-11-16 "우리 앱 안에서 브라우저 띄워서 해당 라이브 들어간 다음에,
// 밑에 [이 라이브에요] 버튼을 누르면 자동으로 그 라이브로 연결되도록"). 화면 없이 글만 다루는 순수 함수다.
// - 시작 주소: 판매자의 채널·계정을 알면 그 채널의 라이브 쪽, 모르면 그 플랫폼 모바일 웹 첫 화면. 로그인을 요구하지 않는 공개 쪽만.
// - 라이브 주소: 지금 보는 주소가 링크 칸의 해석기(liveLinkOf)로 읽히고, 그 가운데서도 라이브 한 편을 가리키는 모양일 때만 —
//   유튜브 watch?v=·live/·youtu.be/·shorts/, 틱톡 @아이디/live, 밴드 band/번호/post·live/번호. 채널 첫 화면·검색·홈은 아니다.
// - 주소 변화: 유튜브·틱톡 모바일 웹은 쪽을 새로 읽지 않고 주소만 바꾼다(SPA) — history 바뀜을 쪽 안 스크립트가 알려 준다.
import { liveLinkOf, type LiveLink } from './live-link.ts'
import type { LivePlatform } from './open-app.ts'

/** 판매자에 대해 아는 것 (모르면 null) */
export interface BrowserHints {
  /** 유튜브 채널 ID (구글 연결 채널 또는 최근 연결한 채널) */
  readonly youtubeChannel?: string | null
  /** 가게 설정의 틱톡 아이디 */
  readonly tiktokId?: string | null
}

const HOME: Readonly<Record<LivePlatform, string>> = {
  youtube: 'https://m.youtube.com/',
  tiktok: 'https://www.tiktok.com/',
  band: 'https://band.us/',
}

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const TIKTOK_ID = /^[A-Za-z0-9._]{2,24}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** 브라우저 시작 주소 */
export function browserStart(platform: LivePlatform, hints: BrowserHints = {}): string {
  if (platform === 'youtube') {
    const channel = hints.youtubeChannel?.trim() ?? ''
    // 채널의 /live는 지금 라이브 중이면 그 라이브로, 아니면 채널 첫 화면으로 간다
    if (CHANNEL_ID.test(channel)) return `https://m.youtube.com/channel/${channel}/live`
  } else if (platform === 'tiktok') {
    const id = (hints.tiktokId?.trim() ?? '').replace(/^@/, '')
    if (TIKTOK_ID.test(id) && !id.endsWith('.')) return `https://www.tiktok.com/@${id}/live`
  }
  return HOME[platform]
}

interface Parts {
  readonly host: string
  readonly path: string
  readonly query: string
}

/** 주소를 호스트·경로·물음 글로 (http·https만). 기기마다 URL 구현이 달라 정규식으로 자른다 */
function partsOf(url: string): Parts | null {
  const match = /^https?:\/\/([^/?#\s]+)([^?#\s]*)(?:\?([^#\s]*))?/i.exec(url.trim())
  if (match === null) return null
  const host = (match[1] ?? '').toLowerCase()
  if (host.includes('@') || host.includes(':')) return null
  return { host, path: match[2] ?? '', query: match[3] ?? '' }
}

function queryValue(query: string, key: string): string | null {
  for (const pair of query.split('&')) {
    const [name, value] = pair.split('=')
    if (name === key && value !== undefined) return value
  }
  return null
}

/** 유튜브 라이브 한 편의 영상 번호 (아니면 null) */
function youtubeVideo({ host, path, query }: Parts): string | null {
  const segments = path.split('/').filter((part) => part !== '')
  let id: string | null = null
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (segments.length === 1 && segments[0] === 'watch') id = queryValue(query, 'v')
    else if (segments.length === 2 && (segments[0] === 'live' || segments[0] === 'shorts')) id = segments[1] ?? null
  } else if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (segments.length === 1) id = segments[0] ?? null
  }
  return id !== null && VIDEO_ID.test(id) ? id : null
}

/**
 * 지금 보는 주소 → [이 라이브예요]로 넣을 링크 (라이브 한 편을 가리키지 않으면 null).
 * 넣는 링크는 링크 칸 해석기(liveLinkOf)가 같은 플랫폼으로 읽는 모양으로 다듬는다 — 서버가 읽는 모양(유튜브는 watch?v=, 틱톡은 @아이디/live).
 */
export function browserLiveLink(url: string): LiveLink | null {
  const parts = partsOf(url)
  if (parts === null) return null
  let link: string | null = null
  const video = youtubeVideo(parts)
  if (video !== null) link = `https://www.youtube.com/watch?v=${video}`
  else if (/^((www|m)\.)?tiktok\.com$/.test(parts.host)) {
    const match = /^\/@([A-Za-z0-9._]{2,24})\/live\/?$/.exec(parts.path)
    if (match !== null && !(match[1] ?? '').endsWith('.')) link = `https://www.tiktok.com/@${match[1] ?? ''}/live`
  } else if (/^(www\.)?band\.us$/.test(parts.host)) {
    const match = /^\/band\/(\d{1,20})\/(post|live)\/(\d{1,20})\/?$/.exec(parts.path)
    if (match !== null) link = `https://band.us/band/${match[1] ?? ''}/${match[2] ?? ''}/${match[3] ?? ''}`
  }
  if (link === null) return null
  // 링크 칸과 같은 해석기로 다시 읽어 같은 플랫폼일 때만 (칸에 넣었을 때와 똑같이 이어지게)
  return liveLinkOf(link)
}

/** 머리에 보일 주소 — 도메인만 (www.·m. 떼고). 못 읽으면 빈 글 */
export function browserHost(url: string): string {
  const parts = partsOf(url)
  return parts === null ? '' : parts.host.replace(/^(www|m)\./, '')
}

/** 브라우저 안에서 열어도 되는 주소 — 웹 쪽만. 앱 열기(youtube://·intent://)·전화·파일은 막는다 */
export function canOpenInBrowser(url: string): boolean {
  return /^(https?:\/\/|about:blank|about:srcdoc|blob:|data:)/i.test(url.trim())
}

/** 쪽 안 스크립트가 보내는 주소 알림의 이름 */
export const LOCATION_MESSAGE = 'livegenie-location'

/**
 * 쪽 안에서 주소가 바뀔 때마다 알린다 (SPA — onNavigationStateChange만으로는 놓친다): history.pushState·replaceState를 감싸고
 * popstate·hashchange를 듣고, 혹시 놓친 것은 0.5초마다 다시 본다. 쪽에 아무것도 쓰지 않는다(보내기만).
 */
export const LOCATION_WATCH_SCRIPT = `(function () {
  if (window.__livegenieWatch) return;
  window.__livegenieWatch = true;
  var last = '';
  function send() {
    var href = String(window.location.href);
    if (href === last || !window.ReactNativeWebView) return;
    last = href;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${LOCATION_MESSAGE}', url: href }));
  }
  function wrap(name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function () {
      var result = original.apply(this, arguments);
      setTimeout(send, 0);
      return result;
    };
  }
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', send);
  window.addEventListener('hashchange', send);
  setInterval(send, 500);
  send();
})();
true;`

/** 쪽 안 스크립트의 알림 → 주소 (다른 글이면 null) */
export function readLocationMessage(data: string): string | null {
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value !== 'object' || value === null) return null
    const { type, url } = value as { type?: unknown; url?: unknown }
    if (type !== LOCATION_MESSAGE || typeof url !== 'string' || url.length > 4096) return null
    return /^https?:\/\//i.test(url) ? url : null
  } catch {
    return null
  }
}

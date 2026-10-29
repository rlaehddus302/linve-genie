// 로그인 REST와 같은 네이티브 쿠키 저장소를 사용하는 앱 서버 WebSocket.
import { absoluteUrl, appOrigin } from './config.ts'
export interface VoiceTicket { readonly wsUrl: string; readonly origin: string; readonly token?: string }
export class VoiceRefused extends Error { constructor(message: string) { super(message); this.name = 'VoiceRefused' } }
export async function fetchVoiceTicket(broadcastId: string, device = 'appnative0001'): Promise<VoiceTicket> {
  const url = new URL(absoluteUrl('/api/voice/stream'))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('broadcastId', broadcastId)
  url.searchParams.set('device', device)
  return { wsUrl: url.toString(), origin: appOrigin() }
}

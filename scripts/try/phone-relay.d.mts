// phone-relay.mjs 타입 (서버 시험·적대 시험이 TypeScript에서 불러 쓴다)
import type { IncomingMessage, ServerResponse } from 'node:http'

export declare const FAKE_GOOGLE_PREFIX: '/_try/google'
export declare const FAKE_GOOGLE_AUTHORIZE_PATH: '/o/oauth2/v2/auth'
export declare const TRY_PHONE_YOUTUBE: 'TRY_PHONE_YOUTUBE'
export declare function phoneYoutubeMessage(port: number): string
export declare function phoneYoutubeNotice(realYoutube: boolean): string
export declare function swapOrigin(text: string, from: string, to: string): string
export declare function relayAuthorizeUrl(text: string, googleOrigin: string, here: string): string
export declare function fakeGoogleTarget(target: string): string | null
export declare function authorizeRoute(method: string | undefined, target: string): 'start' | 'consent' | 'resend' | null
export declare function rewriteAuthorizeBody(text: string, change: (url: string) => string): { text: string; authorizeUrl: string | null }
export declare function phoneYoutubeBody(port: number): string
export interface PhoneRelayOptions {
  readonly port: number
  readonly appOrigin: string
  readonly httpsOrigins: Iterable<string>
  readonly fakeGoogle: { readonly port: number } | null
  readonly realYoutube: boolean
  readonly innerHost?: string
}
export declare function createPhoneRelay(options: PhoneRelayOptions): (req: IncomingMessage, res: ServerResponse) => void

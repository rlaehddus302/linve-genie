// 설정(config.ts readYoutubeChatSend) → 감사 채팅 다른 길 (D-YT-SEND-08·12). 로그인 파일을 시작할 때 한 번 읽는다(browser는 파일 위치를 그대로 쓴다).
// innertube·browser는 봇 계정 풀(계정 하나여도 풀 — 막힘·쉼 처리), nightbot은 토큰 하나. 공식 API 넘김은 YoutubeSystem이 붙인다(구글 클라이언트·연결이 거기 있다).
// 파일 내용은 로그·오류 문장에 넣지 않는다.
import { readFile } from 'node:fs/promises'
import type { YoutubeChatSendEnv } from '../../config.ts'
import { realTimer, type Timer } from '../timer.ts'
import { BrowserChatSender } from './browser-sender.ts'
import { InnertubeChatSender, cookieHeaderFromState } from './innertube-sender.ts'
import { NightbotChatSender, nightbotTokenFromFile } from './nightbot-sender.ts'
import { ChatSenderPool } from './pool.ts'
import { chatSendRoute, type ChatSender, type ChatSendRoute } from './sender.ts'

export interface BotAccount {
  readonly channelId: string
  readonly secretFile: string
}

/** 계정 목록 파일 → 봇 계정 (모양이 틀리면 던진다 — 값은 문장에 넣지 않는다) */
export function parseAccounts(json: string): BotAccount[] {
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('accounts: 빈 목록')
  const accounts = parsed.map((item: unknown) => {
    const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const channelId = typeof record.channelId === 'string' ? record.channelId.trim() : ''
    const secretFile = typeof record.secretFile === 'string' ? record.secretFile.trim() : ''
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId) || secretFile === '') throw new Error('accounts: 모양')
    return { channelId, secretFile }
  })
  if (new Set(accounts.map((account) => account.channelId)).size !== accounts.length) throw new Error('accounts: 채널 겹침')
  return accounts
}

export async function createChatSendRoute(setting: YoutubeChatSendEnv, timer: Timer = realTimer()): Promise<ChatSendRoute> {
  const accounts: BotAccount[] =
    setting.accountsFile !== null ? parseAccounts(await readFile(setting.accountsFile, 'utf8')) : setting.single === null ? [] : [{ channelId: setting.single.authorChannelId, secretFile: setting.single.secretFile }]
  const [first] = accounts
  if (first === undefined) throw new Error('봇 계정 없음')
  if (setting.route === 'nightbot') {
    const token = nightbotTokenFromFile(await readFile(first.secretFile, 'utf8'))
    return chatSendRoute(new NightbotChatSender({ token, authorChannelId: first.channelId, timer }), setting.sellers)
  }
  const senders: ChatSender[] = []
  for (const account of accounts) {
    if (setting.route === 'browser') {
      // 파일이 있는지 먼저 본다 (없으면 시작하지 않는다)
      await readFile(account.secretFile)
      senders.push(new BrowserChatSender({ storageStatePath: account.secretFile, authorChannelId: account.channelId, timer, ...(setting.chromiumPath === null ? {} : { executablePath: setting.chromiumPath }) }))
    } else {
      const raw = (await readFile(account.secretFile, 'utf8')).trim()
      // 쿠키 머리글 글 파일, 또는 browser 길과 같은 Playwright 로그인 상태 JSON
      const cookie = raw.startsWith('{') ? cookieHeaderFromState(raw, Math.floor(timer.now() / 1000)) : raw
      senders.push(new InnertubeChatSender({ cookie, authorChannelId: account.channelId, timer }))
    }
  }
  return chatSendRoute(new ChatSenderPool(senders, timer), setting.sellers)
}

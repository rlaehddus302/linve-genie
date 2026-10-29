// 기존 카드·문자찜 화면 계약의 단위 fixture. 제품 fallback이 아니다.
// 이 시험은 VoiceControllerPort에 실제 읽기 controller를 주입해 FakeSpeech와 화면만 검사한다.
// 서버 이동 경계는 voice-remote / voice-session / 실제 websocket E2E가 따로 검사한다.
import { vi } from 'vitest'
import type * as Remote from '../src/voice/remote.ts'
import type { VoiceHost } from '../src/voice/controller.ts'

vi.hoisted(() => { vi.resetModules() })

vi.mock('../src/voice/remote.ts', async (original) => {
  const remote = await original<typeof Remote>()
  const { VoiceController } = await import('../src/voice/controller.ts')
  const { loadVoice } = await import('../src/voice/load.ts')
  const archive = await import('../src/voice/archive-store.ts')
  const { isHomeScreenApp } = await import('../src/voice/standalone.ts')
  return {
    ...remote,
    readVoiceEngine: () => 'chrome',
    createRemoteVoiceController: (host: VoiceHost) => new VoiceController({ ...host, load: loadVoice, homeScreenApp: isHomeScreenApp, archiveDefault: () => archive.readArchive(null), archiveBroadcasts: archive.archiveBroadcasts, archiveGaps: archive.archiveGaps }),
  }
})

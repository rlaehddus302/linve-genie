// 기존 카드·문자찜 화면 계약의 단위 fixture. 제품 fallback이 아니다.
// 이 시험은 VoiceControllerPort에 실제 읽기 controller를 주입해 FakeSpeech와 화면만 검사한다.
// 서버 이동 경계는 voice-remote / voice-session / 실제 websocket E2E가 따로 검사한다.
// SRV1: 웹 소스의 음성 패키지 로더(load.ts)·홈 화면 앱 판단(standalone.ts)·"받아쓰기 방법"(readVoiceEngine)은 없앴다 —
// 이 시험 fixture만 음성 패키지를 직접 불러 서버가 돌리는 controller를 화면에 붙인다(제품 코드는 서버 답만 그린다).
import { vi } from 'vitest'
import type * as Remote from '../src/voice/remote.ts'
import type { VoiceHost } from '../src/voice/model.ts'

vi.hoisted(() => { vi.resetModules() })

vi.mock('../src/voice/remote.ts', async (original) => {
  const remote = await original<typeof Remote>()
  const { VoiceController } = await import('../src/voice/controller.ts')
  const archive = await import('../src/voice/archive-store.ts')
  return {
    ...remote,
    createRemoteVoiceController: (host: VoiceHost) => new VoiceController({ ...host, load: () => import('@livejjim/voice'), homeScreenApp: () => false, archiveDefault: () => archive.readArchive(null), archiveBroadcasts: archive.archiveBroadcasts, archiveGaps: archive.archiveGaps }),
  }
})

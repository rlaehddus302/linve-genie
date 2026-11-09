// 방송 화면 위에 진짜로 쌓이는 화면 (D-UX4-57, 사용자 지시 2026-11-09 "창 안에 창은 왜 다른 식으로 처리가 되어있어?"):
// 상품 추가 · 방송 관리. 화면 넘김·밀어서 뒤로 가기·상태 막대는 휴대폰이 그대로 하고, 방송 자료는 아래 방송 화면과 같은 저장소를 쓴다.
import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useServices } from '../../services.tsx'
import { StackPage, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Loading, Notice } from '../../ui/parts.tsx'
import { ChatView, PasteView } from './ChatPaste.tsx'
import { APP_IMPORT_TITLE, ImportView } from './ImportSheet.tsx'
import { ConsoleManage, MANAGE_LABEL, SMS_DIRECT } from './Manage.tsx'
import { SmsForm } from './SmsForm.tsx'
import { VoiceSettingsPanel } from './VoicePanel.tsx'
import { ADD_TITLE, ProductAddFlow } from './ProductAdd.tsx'
import { ScopeConsole, signalConsole } from './scope.tsx'
import { useKeptStream } from './StreamAudio.tsx'
import { useMobileYoutube } from './YoutubeSection.tsx'

/** 상품 추가 쌓인 화면 — 추가하면 방송 화면으로 돌아가며 그 상품을 강조하게 알린다 */
export function ProductAddScreen({ broadcastId, onBack }: { readonly broadcastId: string; readonly onBack: () => void }) {
  return (
    <StackPage name={ADD_TITLE} title={ADD_TITLE} onBack={onBack} scroll={false} testID="product-add">
      <ScopeConsole broadcastId={broadcastId} waiting={<Loading />}>
        {({ broadcast }) => (
          <ProductAddFlow
            askName={broadcast.title.includes('다육이')}
            onAdded={(key) => {
              signalConsole(broadcastId, { kind: 'added', key })
              onBack()
            }}
          />
        )}
      </ScopeConsole>
    </StackPage>
  )
}

/**
 * 방송 관리 쌓인 화면. refresh: 바뀌면(방송 연결 화면에서 돌아오면) 유튜브 잇기 상태를 다시 받는다.
 * onEnded: 방송을 끝낸 뒤 — 경로가 홈으로 돌려보낸다.
 */
export function ManageScreen({ broadcastId, onBack, openLink, openLabels, openTool, onEnded, refresh = 0 }: { readonly broadcastId: string; readonly onBack: () => void; readonly openLink: (closed: boolean) => void; readonly openLabels?: () => void; readonly openTool?: (tool: ConsoleTool) => void; readonly onEnded: () => void; readonly refresh?: number }) {
  return (
    <StackPage name={MANAGE_LABEL} onBack={onBack} gray testID="console-settings">
      <ScopeConsole broadcastId={broadcastId} waiting={<Loading />}>
        {({ broadcast, snapshot }) => <ManageBody broadcastId={broadcastId} title={broadcast.title.trim() === '' ? '제목 없음' : broadcast.title} rehearsal={broadcast.rehearsal} closed={broadcast.ended || (snapshot.data?.sealed ?? false)} onBack={onBack} openLink={openLink} onEnded={onEnded} refresh={refresh} {...(openLabels === undefined ? {} : { openLabels })} {...(openTool === undefined ? {} : { openTool })} />}
      </ScopeConsole>
    </StackPage>
  )
}

function ManageBody({ broadcastId, title, rehearsal, closed, onBack, openLink, openLabels, openTool, onEnded, refresh }: { readonly broadcastId: string; readonly title: string; readonly rehearsal: boolean; readonly closed: boolean; readonly onBack: () => void; readonly openLink: (closed: boolean) => void; readonly openLabels?: () => void; readonly openTool?: (tool: ConsoleTool) => void; readonly onEnded: () => void; readonly refresh: number }) {
  const services = useServices()
  const yt = useMobileYoutube(broadcastId, !rehearsal)
  const stream = useKeptStream(services.streamKeep, broadcastId)
  const { reload } = yt
  useEffect(() => {
    if (refresh > 0) void reload()
  }, [refresh, reload])
  return (
    <ConsoleManage
      broadcastId={broadcastId}
      seller
      title={title}
      rehearsal={rehearsal}
      closed={closed}
      canLink={yt.phase !== 'hidden' && yt.phase !== 'loading'}
      stream={stream}
      onClose={onBack}
      onShowLink={() => openLink(closed)}
      {...(openLabels === undefined ? {} : { onOpenLabels: openLabels })}
      {...(openTool === undefined ? {} : { openTool })}
      onEnded={onEnded}
    />
  )
}

/** 방송 관리에서 여는 설정 하나하나 — 아래 판이 아니라 진짜 전체 화면 (D-UX4-60, 사용자 지시 2026-11-09 "방송 관리 탭 안에 있는 각 설정들도 모두 전체화면으로") */
export type ConsoleTool = 'sms' | 'voice' | 'import' | 'paste' | 'chat'
export const CONSOLE_TOOLS: readonly ConsoleTool[] = ['sms', 'voice', 'import', 'paste', 'chat']

/** 머리 가운데 제목(방송 관리 줄 이름과 같다) · 맨 위 굵은 한 줄 · 회색 설명 (토스 화면처럼 무엇을 하는 화면인지 먼저) */
export const TOOL_PAGE: Readonly<Record<ConsoleTool, { readonly title: string; readonly head: string; readonly body: string }>> = {
  sms: { title: SMS_DIRECT, head: '문자로 온 찜을 넣어요', body: '번호와 받은 시각을 적으면\n채팅 찜과 같은 순서로 정해져요' },
  voice: { title: '음성 설정', head: '방송 소리를 글로 바꿔요', body: '들린 말로 상품을 올리는 방법을 정해요' },
  import: { title: APP_IMPORT_TITLE, head: '방송 전에 상품을 한 번에 올려요', body: '"번호 품종 가격"을 한 줄씩 붙여 넣으면\n공개 전 상품으로 올라가요' },
  paste: { title: '댓글 붙여넣기', head: '놓친 댓글을 찜으로 받아요', body: '유튜브 댓글을 복사해 붙여 넣으면\n미리 보고 넣을 수 있어요' },
  chat: { title: '채팅 보기', head: '받은 채팅이에요', body: '방송 채팅을 받은 순서대로 보여드려요' },
}

export function isConsoleTool(value: unknown): value is ConsoleTool {
  return typeof value === 'string' && (CONSOLE_TOOLS as readonly string[]).includes(value)
}

export function ConsoleToolScreen({ broadcastId, tool, onBack }: { readonly broadcastId: string; readonly tool: ConsoleTool; readonly onBack: () => void }) {
  const page = TOOL_PAGE[tool]
  return (
    <StackPage name={page.title} title={page.title} onBack={onBack} gray testID={`console-tool-${tool}`}>
      <View style={{ gap: SPACE.xs, paddingHorizontal: SPACE.xs, paddingTop: SPACE.sm, paddingBottom: SPACE.xs }}>
        <Txt step="headline" weight="bold" role="heading" aria-level={2}>
          {page.head}
        </Txt>
        <Txt step="body" color="textSub">
          {page.body}
        </Txt>
      </View>
      <ScopeConsole broadcastId={broadcastId} waiting={<Loading />}>
        {() => <ToolBody broadcastId={broadcastId} tool={tool} />}
      </ScopeConsole>
    </StackPage>
  )
}

function ToolBody({ broadcastId, tool }: { readonly broadcastId: string; readonly tool: ConsoleTool }) {
  const services = useServices()
  const [pasted, setPasted] = useState<string | null>(null)
  if (tool === 'sms') return <SmsForm />
  return (
    <>
      {pasted !== null ? <Notice tone="success">{pasted}</Notice> : null}
      <WhiteCard>
        {tool === 'voice' ? <VoiceSettingsPanel session={services.voice} broadcastId={broadcastId} /> : null}
        {tool === 'import' ? <ImportView /> : null}
        {tool === 'paste' ? <PasteView onDone={setPasted} /> : null}
        {tool === 'chat' ? <ChatView /> : null}
      </WhiteCard>
    </>
  )
}

/** 흰 둥근 카드 (방송 관리 묶음 카드와 같은 모양) */
function WhiteCard({ children }: { readonly children: ReactNode }) {
  const { p } = useKit()
  return <View style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', padding: SPACE.xl, gap: SPACE.md }}>{children}</View>
}

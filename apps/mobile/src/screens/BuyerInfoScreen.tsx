// 방송 뒤 손님 정보 문자 (ORD-14, D-REAL-11): 손님이 보낸 닉네임·성함·주소 문자를 서버가 읽어 맞는 손님에게 바로 넣고,
// 모르는 것(손님 없음·여럿·이름 못 읽음)만 카드로 남긴다. 판매자는 손님을 골라 칸을 고쳐 [넣기]하거나 [무시]한다.
// 넣은 배송지는 "확인 전" 손님 배송지라 정산에서 [배송지 확인]을 눌러야 접수된다. 정산 탭 위 줄(BuyerInfoBanner)에서 연다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { EmptyFill, AppHeader, BigButton, ButtonRow, Icon, TextField, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'
import { CARD_GAP, PAGE_SIDE, SectionCard } from './order-parts.tsx'

export const BUYER_INFO_TITLE = '손님 정보 문자'
// 설명은 짧게 (D-UX3-93): 화면 제목과 겹치는 첫 문장("방송 뒤 손님이 보낸 … 문자예요")을 뺐다. 배송지 확인 안내는 남긴다(빠뜨리면 접수가 안 된다)
export const BUYER_INFO_HINT = '맞는 손님에게는 바로 넣었고, 모르는 것만 손님을 골라 주세요. 넣은 배송지는 정산에서 확인해야 접수돼요.'
export const NO_BUYER_INFO = '받은 손님 정보 문자가 없어요.'

export interface BuyerChoice {
  readonly date: string
  readonly buyer: string
  readonly label: string
}

export interface BuyerInfoCard {
  readonly id: string
  readonly status: 'OPEN' | 'APPLIED'
  readonly auto: boolean
  readonly receivedAt: string
  readonly last4: string | null
  readonly text: string
  readonly nickname: string | null
  readonly name: string | null
  readonly phone: string | null
  readonly address: string
  readonly detail: string
  readonly candidates: readonly BuyerChoice[]
  readonly applied: BuyerChoice | null
  readonly message: string
}

interface BuyerInfoList {
  readonly cards: readonly BuyerInfoCard[]
  readonly buyers: readonly BuyerChoice[]
}

/** 목록 받기: 손님 정보 문자 알림(inbox · buyerInfo)과 다시 붙음에 다시 읽는다 */
export function useBuyerInfoList(): {
  readonly list: BuyerInfoList | null
  readonly error: ApiError | null
  readonly reload: () => void
} {
  const { stream } = useServices()
  const [list, setList] = useState<BuyerInfoList | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const version = useRef(0)
  const reload = useCallback(() => {
    const mine = ++version.current
    get<BuyerInfoList>('/api/buyer-info')
      .then((next) => {
        if (mine !== version.current) return
        setList(next)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (mine !== version.current) return
        if (isApiError(caught)) setError(caught)
      })
  }, [])
  useEffect(() => {
    reload()
    const view = stream.open()
    let ready = 0
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) reload()
    })
    view.addEventListener('inbox', (event) => {
      try {
        if ((JSON.parse(event.data ?? '{}') as { kind?: string }).kind === 'buyerInfo') reload()
      } catch {
        // 모양이 다른 알림은 지나친다
      }
    })
    return () => view.close()
  }, [reload, stream])
  return { list, error, reload }
}

/**
 * 정산 탭 위 줄: 확인할 문자가 있으면 "확인해 주세요", 바로 넣은 것만 있으면 "넣었어요". 없으면 그리지 않는다.
 * 흰 카드 한 줄 (D-UX3-93 — 옛 주황 테두리 상자): 확인할 것이 있으면 주황 숫자 배지, 오른쪽 ›
 */
export function BuyerInfoBanner({ onOpen }: { readonly onOpen: () => void }) {
  const { p } = useKit()
  const { list } = useBuyerInfoList()
  if (list === null || list.cards.length === 0) return null
  const open = list.cards.filter((card) => card.status === 'OPEN').length
  const words = open > 0 ? `손님 정보 문자 ${String(open)}건 확인해 주세요` : `손님 정보 문자 ${String(list.cards.length)}건 넣었어요`
  return (
    <Tap
      role="button"
      aria-label={words}
      onPress={onOpen}
      testID="buyer-info-banner"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min + SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.xl, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surface })}
    >
      {open > 0 ? <View aria-hidden style={{ width: 8, height: 8, borderRadius: 4, borderCurve: 'continuous', backgroundColor: p.warnText }} /> : null}
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="book" color={open > 0 ? 'warnText' : 'text'}>
          {words}
        </Txt>
      </View>
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

export function BuyerInfoScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const { list, error, reload } = useBuyerInfoList()
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="buyer-info-screen">
      <AppHeader title={BUYER_INFO_TITLE} onBack={onBack} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: PAGE_SIDE,
          paddingTop: SPACE.sm,
          paddingBottom: SPACE.xxxl + room,
          gap: CARD_GAP,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Txt step="meta" color="textSub">{BUYER_INFO_HINT}</Txt>
        {error !== null && list === null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>
              {error.message}
            </Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={reload} />
          </View>
        ) : null}
        {list === null && error === null ? <Loading /> : null}
        {list !== null && list.cards.length === 0 ? (
          <EmptyFill title={NO_BUYER_INFO} />
        ) : null}
        {list?.cards.map((card) => (
          <BuyerInfoItem key={card.id} card={card} buyers={list.buyers} onDone={reload} />
        ))}
      </ScrollView>
    </View>
  )
}

function BuyerInfoItem({ card, buyers, onDone }: { readonly card: BuyerInfoCard; readonly buyers: readonly BuyerChoice[]; readonly onDone: () => void }) {
  const { p } = useKit()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dismiss = async () => {
    setBusy(true)
    setError(null)
    try {
      await post(`/api/buyer-info/${card.id}/dismiss`, {})
      onDone()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : '잠시 뒤 다시 해 주세요.')
    } finally {
      setBusy(false)
    }
  }
  const from = card.last4 === null ? '이름만 온 문자' : `끝 ${card.last4}`
  return (
    <SectionCard testID={`buyer-info-${card.id}`}>
      <View style={{ gap: SPACE.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <Tag tone={card.status === 'OPEN' ? 'warning' : 'success'}>{card.status === 'OPEN' ? '확인해 주세요' : '넣었어요'}</Tag>
          <Txt step="caption" color="textSub">
            {kstShort(card.receivedAt)} · {from}
          </Txt>
        </View>
        {/* 손님이 보낸 문자 그대로 (말풍선처럼 옅은 바탕) */}
        <View style={{ paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
          <Txt step="bodyLarge" weight="book">{card.text}</Txt>
        </View>
        {card.applied !== null ? (
          <Txt step="bodyLarge" weight="medium">
            {card.applied.label} 손님 ({dateWords(card.applied.date)})
          </Txt>
        ) : null}
        <Txt step="meta" color={card.status === 'OPEN' ? 'warnText' : 'textSub'}>{card.message}</Txt>
        {error !== null ? (
          <Notice tone="danger" alert>
            {error}
          </Notice>
        ) : null}
        {card.status === 'APPLIED' ? <BigButton kind="outline" label="닫기" busy={busy} onPress={() => void dismiss()} /> : null}
        {card.status === 'OPEN' && !editing ? (
          <ButtonRow>
            <BigButton kind="outline" label="무시" busy={busy} onPress={() => void dismiss()} />
            <BigButton label="손님 고르기" onPress={() => setEditing(true)} />
          </ButtonRow>
        ) : null}
        {card.status === 'OPEN' && editing ? <ApplyForm card={card} buyers={buyers} onCancel={() => setEditing(false)} onDone={onDone} /> : null}
      </View>
    </SectionCard>
  )
}

const keyOf = (choice: BuyerChoice): string => JSON.stringify([choice.date, choice.buyer])

function ApplyForm({ card, buyers, onCancel, onDone }: { readonly card: BuyerInfoCard; readonly buyers: readonly BuyerChoice[]; readonly onCancel: () => void; readonly onDone: () => void }) {
  const [picked, setPicked] = useState<BuyerChoice | null>(card.candidates.length === 1 ? (card.candidates[0] as BuyerChoice) : null)
  const [search, setSearch] = useState('')
  const [name, setName] = useState(card.name ?? '')
  const [phone, setPhone] = useState(card.phone ?? '')
  const [address, setAddress] = useState(card.address)
  const [detail, setDetail] = useState(card.detail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const shown = useMemo(() => {
    const words = search.trim()
    const pool = words === '' && card.candidates.length > 0 ? card.candidates : buyers
    const found = words === '' ? pool : pool.filter((choice) => choice.label.includes(words))
    return found.slice(0, 12)
  }, [search, card.candidates, buyers])
  const apply = async () => {
    if (picked === null) {
      setError('손님을 골라 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    setProblems({})
    try {
      await post(`/api/buyer-info/${card.id}/apply`, {
        date: picked.date,
        buyer: picked.buyer,
        name,
        phone,
        address,
        detail,
      })
      onDone()
    } catch (caught) {
      if (!isApiError(caught)) {
        setError('잠시 뒤 다시 해 주세요.')
        return
      }
      setError(caught.message)
      const next: Record<string, string> = {}
      for (const problem of caught.problems) if (typeof problem.field === 'string' && next[problem.field] === undefined) next[problem.field] = problem.message
      setProblems(next)
      if (caught.status === 409 || caught.status === 404) onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: SPACE.md, marginTop: SPACE.xs }}>
      <Txt step="bodyLarge" weight="bold">어느 손님인가요?</Txt>
      {buyers.length > 8 || card.candidates.length === 0 ? <TextField label="손님 찾기" value={search} onChangeText={setSearch} placeholder="닉네임으로 찾기" /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
        {shown.map((choice) => (
          <Pill
            key={keyOf(choice)}
            on={picked !== null && keyOf(picked) === keyOf(choice)}
            label={`${choice.label} · ${dateWords(choice.date)}`}
            ariaLabel={`${choice.label} 손님, ${dateWords(choice.date)}`}
            onPress={() => setPicked(choice)}
          />
        ))}
      </View>
      {shown.length === 0 ? <Txt step="meta" color="textSub">찾는 손님이 없어요. 7일 안 방송에서 산 손님만 골라요.</Txt> : null}
      <TextField label="받는 분" value={name} onChangeText={setName} error={problems.name ?? null} />
      <TextField label="연락처" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={problems.phone ?? null} />
      <TextField label="주소" value={address} onChangeText={setAddress} error={problems.address ?? null} />
      <TextField label="상세 주소" value={detail} onChangeText={setDetail} error={problems.detail ?? null} />
      {error !== null ? (
        <Notice tone="danger" alert>
          {error}
        </Notice>
      ) : null}
      <ButtonRow>
        <BigButton kind="outline" label="취소" onPress={onCancel} />
        <BigButton label="넣기" busy={busy} disabled={picked === null} onPress={() => void apply()} />
      </ButtonRow>
    </View>
  )
}

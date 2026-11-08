// 방송 뒤 손님 정보 문자 (ORD-14, D-REAL-11): 손님이 보낸 닉네임·성함·주소 문자를 서버가 읽어 맞는 손님에게 바로 넣고,
// 모르는 것(손님 없음·여럿·이름 못 읽음)만 카드로 남긴다. 판매자는 손님을 골라 칸을 고쳐 [넣기]하거나 [무시]한다.
// 넣은 배송지는 "확인 전" 손님 배송지라 정산에서 [배송지 확인]을 눌러야 접수된다. 정산 탭 위 줄(BuyerInfoBanner)에서 연다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, Card, TextField, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

export const BUYER_INFO_TITLE = '손님 정보 문자'
export const BUYER_INFO_HINT = '방송 뒤 손님이 보낸 닉네임·성함·주소 문자예요. 맞는 손님에게는 바로 넣었고, 모르는 것만 손님을 골라 주세요. 넣은 배송지는 정산에서 확인해야 접수돼요.'
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

/** 정산 탭 위 줄: 확인할 문자가 있으면 "확인해 주세요", 바로 넣은 것만 있으면 "넣었어요". 없으면 그리지 않는다 */
export function BuyerInfoBanner({ onOpen }: { readonly onOpen: () => void }) {
  const { p } = useKit()
  const { list } = useBuyerInfoList()
  if (list === null || list.cards.length === 0) return null
  const open = list.cards.filter((card) => card.status === 'OPEN').length
  const words = open > 0 ? `손님 정보 문자 ${String(open)}건 확인해 주세요` : `손님 정보 문자 ${String(list.cards.length)}건 넣었어요`
  return (
    <Pressable
      role="button"
      aria-label={words}
      onPress={onOpen}
      testID="buyer-info-banner"
      style={({ pressed }) => {
        const base = open > 0 ? p.warnBg : p.surface
        return {
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.sm,
          padding: SPACE.md,
          borderRadius: RADIUS.lg, borderCurve: 'continuous',
          backgroundColor: pressed ? pressedFill(p, base) : base,
          borderWidth: 1,
          borderColor: open > 0 ? p.warnText : p.line,
        }
      }}
    >
      <View style={{ flex: 1 }}>
        <Txt weight="bold" color={open > 0 ? 'warnText' : 'text'}>
          {words}
        </Txt>
      </View>
      <Txt weight="bold" color="primaryText">
        보기
      </Txt>
    </Pressable>
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
          padding: SPACE.md,
          paddingBottom: SPACE.xxxl + room,
          gap: SPACE.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Txt color="textSub">{BUYER_INFO_HINT}</Txt>
        {error !== null && list === null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>
              {error.message}
            </Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={reload} />
          </View>
        ) : null}
        {list === null && error === null ? <Loading /> : null}
        {list !== null && list.cards.length === 0 ? <Txt color="textSub">{NO_BUYER_INFO}</Txt> : null}
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
    <Card testID={`buyer-info-${card.id}`}>
      <View style={{ gap: SPACE.sm }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACE.sm,
            flexWrap: 'wrap',
          }}
        >
          <Tag tone={card.status === 'OPEN' ? 'warning' : 'success'}>{card.status === 'OPEN' ? '확인해 주세요' : '넣었어요'}</Tag>
          <Txt color="textSub">
            {kstShort(card.receivedAt)} · {from}
          </Txt>
        </View>
        <View
          style={{
            padding: SPACE.md,
            borderRadius: RADIUS.md, borderCurve: 'continuous',
            backgroundColor: p.surfaceAlt,
          }}
        >
          <Txt>{card.text}</Txt>
        </View>
        {card.applied !== null ? (
          <Txt weight="bold">
            {card.applied.label} 손님 ({dateWords(card.applied.date)})
          </Txt>
        ) : null}
        <Txt color={card.status === 'OPEN' ? 'warnText' : 'textSub'}>{card.message}</Txt>
        {error !== null ? (
          <Notice tone="danger" alert>
            {error}
          </Notice>
        ) : null}
        {card.status === 'APPLIED' ? <BigButton kind="outline" label="닫기" busy={busy} onPress={() => void dismiss()} /> : null}
        {card.status === 'OPEN' && !editing ? (
          <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
            <View style={{ flex: 1 }}>
              <BigButton kind="outline" label="무시" busy={busy} onPress={() => void dismiss()} />
            </View>
            <View style={{ flex: 1 }}>
              <BigButton label="손님 고르기" onPress={() => setEditing(true)} />
            </View>
          </View>
        ) : null}
        {card.status === 'OPEN' && editing ? <ApplyForm card={card} buyers={buyers} onCancel={() => setEditing(false)} onDone={onDone} /> : null}
      </View>
    </Card>
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
    <View style={{ gap: SPACE.sm }}>
      <Txt weight="bold">어느 손님인가요?</Txt>
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
      {shown.length === 0 ? <Txt color="textSub">찾는 손님이 없어요. 7일 안 방송에서 산 손님만 골라요.</Txt> : null}
      <TextField label="받는 분" value={name} onChangeText={setName} error={problems.name ?? null} />
      <TextField label="연락처" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={problems.phone ?? null} />
      <TextField label="주소" value={address} onChangeText={setAddress} error={problems.address ?? null} />
      <TextField label="상세 주소" value={detail} onChangeText={setDetail} error={problems.detail ?? null} />
      {error !== null ? (
        <Notice tone="danger" alert>
          {error}
        </Notice>
      ) : null}
      <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
        <View style={{ flex: 1 }}>
          <BigButton kind="outline" label="취소" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <BigButton label="넣기" busy={busy} disabled={picked === null} onPress={() => void apply()} />
        </View>
      </View>
    </View>
  )
}

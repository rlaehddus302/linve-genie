import { useEffect, useState, useSyncExternalStore } from 'react'
import { FlatList, View } from 'react-native'
import type { ProductLabelData } from '@livejjim/label'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, withQuery } from '../api/client.ts'
import { useServices } from '../services.tsx'
import { BigButton, ErrorLine, ListRow, StackPage, Txt } from '../ui/kit/index.ts'
import { Field, Loading } from '../ui/parts.tsx'
import { formatWon } from '../lib/words.ts'
import { ProductLabelAction, QueueLabelButton, type LabelEdits } from './ProductLabelAction.tsx'

type Entry = LabelView['history'][number] & { label: LabelView }
const buyer = (data: ProductLabelData) => data.buyer.kind === 'youtube' ? data.buyer.name : '문자찜'

function EditCopy({ label, original }: { label: LabelView; original: ProductLabelData }) {
  const [no, setNo] = useState(String(original.no))
  const [name, setName] = useState(original.name)
  const [price, setPrice] = useState(String(original.price))
  const [nickname, setNickname] = useState(buyer(original))
  const valid = /^\d{1,4}$/.test(no) && Number(no) > 0 && /^\d{1,12}$/.test(price) && nickname.trim().length > 0
  const edits: LabelEdits = {}
  if (Number(no) !== original.no) edits.no = Number(no)
  if (name.trim() !== original.name) edits.name = name.trim()
  if (Number(price) !== original.price) edits.price = Number(price)
  if (original.buyer.kind === 'youtube' && nickname.trim() !== original.buyer.name) edits.nickname = nickname.trim()
  return <View style={{ gap: 12 }}>
    <Txt color="textSub">수정한 내용은 이번 라벨 한 장에 적용돼요.</Txt>
    <Field label="번호" keyboardType="number-pad" value={no} onChangeText={setNo} maxLength={4} />
    <Field label="품종" value={name} onChangeText={setName} maxLength={80} />
    <Field label="가격 (원)" keyboardType="number-pad" value={price} onChangeText={setPrice} maxLength={12} />
    {original.buyer.kind === 'youtube' ? <Field label="닉네임" value={nickname} onChangeText={setNickname} maxLength={80} /> : <Txt>문자찜</Txt>}
    <ProductLabelAction label={label} title="라벨 다시 인쇄" disabled={!valid} {...(Object.keys(edits).length ? { edits } : {})} />
  </View>
}

function DirectPrint({ id, initial }: { id: string; initial?: ProductLabelData }) {
  const [no, setNo] = useState(initial ? String(initial.no) : '')
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const valid = /^\d{1,4}$/.test(no) && Number(no) > 0 && /^\d{1,12}$/.test(price)
  const [copy, setCopy] = useState(0)
  return <View style={{ padding: 20, gap: 12 }}>
    <Field label="상품 번호" keyboardType="number-pad" value={no} onChangeText={setNo} maxLength={4} />
    <Field label="품종" value={name} onChangeText={setName} maxLength={80} />
    <Field label="가격 (원)" keyboardType="number-pad" value={price} onChangeText={setPrice} maxLength={12} />
    <QueueLabelButton key={copy} action="direct" body={{ b: id, no: Number(no), name: name.trim(), price: Number(price) }} title="바로 인쇄" disabled={!valid} onQueued={() => setCopy((n) => n + 1)} />
  </View>
}

export function PrintHistory({ id, date, sealed, direct = false, onBack }: { id: string; date: string; sealed: boolean; direct?: boolean; onBack: () => void }) {
  const { labels } = useServices()
  const { queue } = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [selected, select] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const rev = queue?.rev
  useEffect(() => {
    if (!queue?.labelsEnabled) return
    let active = true
    setError('')
    void get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date, historyBroadcast: id })).then((result) => {
      if (active) setEntries(result.labels.flatMap((label) => label.history.map((item) => ({ ...item, label }))).sort((a, b) => b.at.localeCompare(a.at)))
    }, (err: unknown) => { if (active) setError(isApiError(err) ? err.message : '출력 내역을 불러오지 못했어요.') })
    return () => { active = false }
  }, [date, id, rev, retry, queue?.labelsEnabled])
  const entry = entries?.find((item) => item.jobId === selected)
  const current = entry?.label.data
  if (direct && queue?.labelsEnabled && !sealed) return <StackPage name="직접 인쇄" title="직접 인쇄" onBack={onBack}><DirectPrint id={id} /></StackPage>
  const editing = entry !== undefined && queue?.labelsEnabled === true
  return <StackPage name="출력 내역" title={editing ? '라벨 다시 인쇄' : '출력 내역'} onBack={editing ? () => select(null) : onBack} scroll={editing}>
    {error ? <View><ErrorLine>{error}</ErrorLine><BigButton label="다시 불러오기" onPress={() => setRetry((v) => v + 1)} /></View> : null}
    {queue === null ? <Loading /> : !queue.labelsEnabled ? <Txt>라벨 뽑기를 켜 주세요.</Txt> : editing ? (
      <View style={{ padding: 20, gap: 16 }}>
        {entry.data ? <Txt color="textSub">{`출력한 내용 · ${entry.data.no}번 ${entry.data.name} · ${formatWon(entry.data.price)} · ${buyer(entry.data)}`}</Txt> : null}
        {!sealed && entry.label.key.startsWith('direct:') && entry.data ? <DirectPrint id={id} initial={entry.data} /> : !sealed && entry.label.canReprint && current && 'no' in current ? <EditCopy key={entry.jobId} label={entry.label} original={current} /> : <Txt>{entry.label.voided ? '폐기된 라벨이에요.' : entry.label.word || '현재 다시 인쇄할 수 없어요.'}</Txt>}
      </View>
    ) : entries === null ? (!error ? <Loading /> : null) : <FlatList data={entries} contentContainerStyle={{ padding: 16 }} keyExtractor={(item) => item.jobId ?? item.label.key + item.at} ListEmptyComponent={<Txt>이 방송에서 출력한 라벨이 아직 없어요.</Txt>} renderItem={({ item }) => {
      const data = item.data
      return <ListRow title={data ? `${data.no}번 ${data.name} · ${buyer(data)}` : `${item.label.no ?? ''}번 라벨`} subtitle={`${new Date(item.at).toLocaleString('ko-KR')} · ${item.device}`} value={data ? formatWon(data.price) : ''} onPress={() => select(item.jobId ?? null)} />
    }} />}
  </StackPage>
}

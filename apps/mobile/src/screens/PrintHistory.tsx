import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FlatList, View } from 'react-native'
import type { ProductLabelData } from '@livejjim/label'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, newRequestId, withQuery } from '../api/client.ts'
import { fixPlan, fixProductAndReprint, reprintEdited, type FixPlan } from '../lib/label-fix.ts'
import { FIX_AMOUNT_KEPT, FIX_DONE, FIX_DONE_SAME, FIX_LABEL_ONLY, FIX_NUMBER_LABEL_ONLY, FIX_PRICE_LABEL_ONLY, FIX_PRODUCT_FAILED, FIX_PRODUCT_TOO, FIX_QUESTION, fixDescription } from '../lib/print-words.ts'
import { useServices } from '../services.tsx'
import { BigButton, BottomSheet, ErrorLine, ListRow, StackPage, Txt } from '../ui/kit/index.ts'
import { Field, Loading, Notice } from '../ui/parts.tsx'
import { ConsoleContext } from './console/context.ts'
import { formatWon } from '../lib/words.ts'
import { QueueLabelButton, type LabelEdits } from './ProductLabelAction.tsx'

type Entry = LabelView['history'][number] & { label: LabelView }
const buyer = (data: ProductLabelData) => data.buyer.kind === 'youtube' ? data.buyer.name : '문자찜'

/**
 * 고쳐 다시 인쇄 (F3, D-RETRO-44): 품종·가격을 고쳤으면 "상품 정보도 같이 고칠까요?"를 묻는다 — 왼쪽 [이 라벨만] · 오른쪽 [상품도 고치기].
 * [상품도 고치기]면 상품 수정을 먼저 보내고(가격은 입금 전 찜에도) 고친 값 그대로 다시 인쇄를 넣는다. 번호·닉네임만 고쳤으면 묻지 않는다(라벨 한 장에만).
 * 방송 화면 밖(방송을 모르는 곳)이면 묻지 않고 라벨만 뽑는다.
 * 끝난 결과는 부모(출력 내역)가 들고 보인다 — 대기열에 들어가면 그 라벨은 "다시 인쇄"를 할 수 없는 상태가 되어 이 칸이 사라지기 때문이다
 */
type FixDone = { readonly product: 'changed' | 'same' | 'untouched'; readonly amountKept: boolean }

function FixReprint({ label, original, edits, plan, date, disabled, onDone }: { label: LabelView; original: ProductLabelData; edits: LabelEdits; plan: FixPlan; date: string; disabled: boolean; onDone: (done: FixDone) => void }) {
  const api = useContext(ConsoleContext)
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [ask, setAsk] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  /** 같은 내용을 다시 보낼 때 같은 요청 번호 (실패 뒤 다시 눌러도 한 번만) */
  const ids = useRef<{ input: string; product: string; print: string } | null>(null)
  const product = api === null || api.sealed ? null : plan.product
  const run = async (withProduct: boolean) => {
    setAsk(false)
    if (locked.current || disabled) return
    locked.current = true
    setState('busy')
    setError('')
    try {
      const input = JSON.stringify([label.key, edits])
      if (ids.current?.input !== input) ids.current = { input, product: newRequestId(), print: newRequestId() }
      if (withProduct && product !== null && api !== null) {
        const outcome = await fixProductAndReprint({ command: api.command, date, label, original, edits, product, ids: ids.current })
        onDone({ product: outcome.productChanged ? 'changed' : 'same', amountKept: outcome.amountKept })
      } else {
        await reprintEdited(label, edits, ids.current.print)
        onDone({ product: 'untouched', amountKept: false })
      }
      setState('done')
    } catch (caught) {
      setState('idle')
      locked.current = false
      setError(isApiError(caught) ? caught.message : withProduct ? FIX_PRODUCT_FAILED : '라벨을 대기열에 넣지 못했어요. 다시 눌러 주세요.')
    }
  }
  if (state === 'done') return null
  return <View style={{ gap: 8 }}>
    {plan.labelOnly ? <Txt color="textSub">{FIX_NUMBER_LABEL_ONLY}</Txt> : null}
    {plan.priceLabelOnly ? <Txt color="textSub">{FIX_PRICE_LABEL_ONLY}</Txt> : null}
    <BigButton label="라벨 다시 인쇄" kind="secondary" busy={state === 'busy'} disabled={disabled} onPress={() => (product === null ? void run(false) : setAsk(true))} />
    {error ? <ErrorLine>{error}</ErrorLine> : null}
    {/* 부정(이 라벨만) 왼쪽 · 긍정(상품도 고치기) 오른쪽, 한 줄 (절대 규칙 8). 창을 그냥 닫으면 아무것도 하지 않는다 */}
    <BottomSheet visible={ask} onClose={() => setAsk(false)} title={FIX_QUESTION} description={product === null ? '' : fixDescription({ ...(product.name === undefined ? {} : { name: product.name }), ...(product.price === undefined ? {} : { price: formatWon(product.price) }) })} testID="label-fix-ask"
      actions={<>
        <BigButton kind="secondary" label={FIX_LABEL_ONLY} onPress={() => void run(false)} />
        <BigButton label={FIX_PRODUCT_TOO} onPress={() => void run(true)} />
      </>} />
  </View>
}

function EditCopy({ label, original, date, onDone }: { label: LabelView; original: ProductLabelData; date: string; onDone: (done: FixDone) => void }) {
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
    <Txt color="textSub">수정한 내용은 이번 라벨 한 장에 적용돼요. 품종·가격은 인쇄할 때 상품도 같이 고칠지 물어봐요.</Txt>
    <Field label="번호" keyboardType="number-pad" value={no} onChangeText={setNo} maxLength={4} />
    <Field label="품종" value={name} onChangeText={setName} maxLength={80} />
    <Field label="가격 (원)" keyboardType="number-pad" value={price} onChangeText={setPrice} maxLength={12} />
    {original.buyer.kind === 'youtube' ? <Field label="닉네임" value={nickname} onChangeText={setNickname} maxLength={80} /> : <Txt>문자찜</Txt>}
    <FixReprint label={label} original={original} edits={edits} plan={fixPlan(original, edits)} date={date} disabled={!valid} onDone={onDone} />
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
  /** 방금 고쳐 다시 인쇄한 결과 (그 줄을 보는 동안 남긴다) */
  const [fixed, setFixed] = useState<(FixDone & { readonly jobId: string }) | null>(null)
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
  return <StackPage name="출력 내역" title={editing ? '라벨 다시 인쇄' : '출력 내역'} onBack={editing ? () => { select(null); setFixed(null) } : onBack} scroll={editing}>
    {error ? <View><ErrorLine>{error}</ErrorLine><BigButton label="다시 불러오기" onPress={() => setRetry((v) => v + 1)} /></View> : null}
    {queue === null ? <Loading /> : !queue.labelsEnabled ? <Txt>라벨 출력을 켜 주세요.</Txt> : editing ? (
      <View style={{ padding: 20, gap: 16 }}>
        {entry.data ? <Txt color="textSub">{`출력한 내용 · ${entry.data.no}번 ${entry.data.name} · ${formatWon(entry.data.price)} · ${buyer(entry.data)}`}</Txt> : null}
        {fixed !== null && fixed.jobId === selected ? (
          <View style={{ gap: 8 }}>
            <Txt role="status">{fixed.product === 'changed' ? FIX_DONE : fixed.product === 'same' ? FIX_DONE_SAME : '출력 대기열에 넣었어요.'}</Txt>
            {fixed.amountKept ? <Notice tone="warning">{FIX_AMOUNT_KEPT}</Notice> : null}
          </View>
        ) : !sealed && entry.label.key.startsWith('direct:') && entry.data ? <DirectPrint id={id} initial={entry.data} /> : !sealed && entry.label.canReprint && current && 'no' in current ? <EditCopy key={entry.jobId} label={entry.label} original={current} date={date} onDone={(done) => { if (selected !== null) setFixed({ ...done, jobId: selected }) }} /> : <Txt>{entry.label.voided ? '폐기된 라벨이에요.' : entry.label.word || '현재 다시 인쇄할 수 없어요.'}</Txt>}
      </View>
    ) : entries === null ? (!error ? <Loading /> : null) : <FlatList data={entries} contentContainerStyle={{ padding: 16 }} keyExtractor={(item) => item.jobId ?? item.label.key + item.at} ListEmptyComponent={<Txt>이 방송에서 출력한 라벨이 아직 없어요.</Txt>} renderItem={({ item }) => {
      const data = item.data
      return <ListRow title={data ? `${data.no}번 ${data.name} · ${buyer(data)}` : `${item.label.no ?? ''}번 라벨`} subtitle={`${new Date(item.at).toLocaleString('ko-KR')} · ${item.device}`} value={data ? formatWon(data.price) : ''} onPress={() => select(item.jobId ?? null)} />
    }} />}
  </StackPage>
}

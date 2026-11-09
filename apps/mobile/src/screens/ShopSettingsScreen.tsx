// 가게 설정 (D-APPX-03 — 웹 SettingsPage와 같은 칸·문구·저장 규칙, D-I3-08, FB1 D-FB1-06, I2 AC-I2-02·65·66).
// 값을 적는 칸(가게·판매 규칙·배송비·구매 감사 메시지·택배·손님 관리)은 화면 아래 "저장" 하나로 바뀐 칸만 보낸다.
// 켜고 끄는 칸(AI 제안)은 누르면 바로. 백업 상태와 전체 기록 내려받기(공유 시트). 구글·인스타그램·틱톡·밴드 연결,
// 자동 게시 동의, 간편 로그인처럼 바깥 로그인 창을 거치는 것은 기기 브라우저로 연다(그쪽 로그인 창이 앱 안에서 열리지 않는다).
// 저장하지 않은 값이 있으면 나가기 전에 묻는다. 칸 검사는 서버가 하고 그 문장을 칸 아래에 보인다.
// 모양 (D-UX3-96, 토스 설정처럼): 묶음마다 흰 카드 하나 — 카드 안 맨 위에 작은 회색 이름. "상세 설정 열기"·"영상 댓글 끄기" 같은 곁길은
// 큰 회색 단추 대신 글자 줄·글자 단추로, 안내 상자는 꼭 알아야 하는 것(주의·잘못)만 남기고 나머지는 한 줄 회색 글로.
// 구매 감사 채팅(thanks.liveChat)은 판매자가 켜기 전까지 꺼져 있다(D-YT-SRV-23) — 안내 글도 "켜면 올려요"로.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { KeyboardAvoidingView, ScrollView, View } from 'react-native'
import type { SaleSettings } from '@livejjim/core/settings'
import type { BroadcastItem, Shop } from '@livejjim/web/src/api/types.ts'
import type { ParcelSettings } from '@livejjim/web/src/api/parcel-types.ts'
import type { CustomerSettings } from '@livejjim/web/src/lib/customers.ts'
import { CONSOLE_BADGES_DETAIL, CONSOLE_BADGES_HELP, CONSOLE_BADGES_LABEL, CONSOLE_BADGES_UNDECIDED, LEDGER_MONTH_WORDS, LEDGER_MONTHS, LEDGER_MONTHS_HELP, LEDGER_MONTHS_LABEL, type LedgerSettings } from '@livejjim/web/src/lib/ledger-words.ts'
import { BOX_HINT, BOX_LABEL, CARRIER_NAME_LABEL, CARRIER_NAME_MAX, EPOST_CARRIER, EPOST_CUSTOMER_LABEL, EPOST_GUIDE, EPOST_KEY_LABEL, EPOST_PRINT_NOTE, EPOST_SECRET_LABEL, NO_AUTO_BOOK_NOTE, OTHER_CARRIER, SENDER_KEYS, epostKeyHelp, SENDER_LABELS, boxWord, parcelBody, parcelDraftOf, sameParcelDraft, type ParcelDraft, EPOST_PASSWORD_HINT, EPOST_PASSWORD_LABEL } from '@livejjim/web/src/lib/parcel-words.ts'
import { dirtyLine, failedMessage, savedMessage, SAVE_LABEL, type SaveBlock } from '@livejjim/web/src/lib/save-bar.ts'
import { DETAIL_SETTINGS_NOTE, ONGOING_NOTICE, RULES_DETAIL, SHIPPING_HINT, THANKS_DETAIL, changedSettings, draftOf, fieldChangeNote, fieldsAt, fieldWarning, type FieldDef } from '@livejjim/web/src/lib/settings-fields.ts'
import { ACCOUNT_INCOMPLETE, NO_ACCOUNT_ON_RECEIPT, SHOP_FIELDS, accountPreview } from '@livejjim/web/src/lib/shop-words.ts'
import { isApiError, patch, put, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { AppHeader, BigButton, ConfirmSheet, KEYBOARD_AVOID, ToggleRow, TextField, Txt, useBottomInset, useKeyboardShown, useKit, useTopInset } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Pill } from '../ui/day-pills.tsx'
import { Loading, Notice } from '../ui/parts.tsx'
import { AssistCard, BackupCard, ConnectionsCard, ExportCard, useBotThanks } from './settings/ShopExtras.tsx'
import { DetailToggle, FieldLabel, GroupNote, SETTINGS_GUTTER, SettingsGroup, TextButton } from './settings/Group.tsx'

const RULE_FIELDS = [...fieldsAt('basic'), ...fieldsAt('more')]
const BASIC_FIELDS = fieldsAt('basic')
const MORE_FIELDS = fieldsAt('more')
const SHIPPING_FIELDS = fieldsAt('shipping')
const THANKS_FIELDS = fieldsAt('thanks').filter((field) => field.key !== 'thanks.videoComment')
const ALL_FIELDS = [...RULE_FIELDS, ...SHIPPING_FIELDS, ...fieldsAt('thanks')]

export const REGULAR_AMOUNT_HINT = '비우면 금액 기준을 쓰지 않아요.'
export const CUSTOMER_RULE_HINT = '단골 = 이 횟수 이상 샀거나 이 금액 이상 산 손님. 입금 늦음 주의 = 미입금이 한 번이라도 있는 손님.'
export const WAIT_DAYS_HINT = '방송 날짜에서 이 날 수가 지나도 입금이 없으면 미입금으로 세요.'
export const VIDEO_COMMENT_ON = '예전에 켠 영상 댓글이 켜져 있어요.'
export const LEAVE_UNSAVED = '저장하지 않은 칸이 있어요'
/** 봇 판매자의 감사 칸 안내 (D-YT-SEND-18 → D-YT-SRV-23: 감사 채팅은 처음에 꺼져 있다 — 웹 BOT_THANKS_NOTE의 "끄면 올리지 않아요"는 켜져 있다는 뜻으로 읽혀 앱은 이 글을 쓴다) */
export const BOT_THANKS_OFF_FIRST = '위 칸을 켜면 찜이 확정될 때 라이브지니가 방송 채팅에 감사 메시지를 대신 올려요. 켜기 전까지는 올리지 않아요. 구글 연결은 필요 없어요.'
/** 봇이 아닌 판매자의 감사 칸 안내 */
export const THANKS_CONSENT_NOTE = '유튜브 채팅·댓글 자동 게시 동의는 아래 "연결"에서 웹으로 열어요.'

interface CustomerDraft {
  readonly regularCount: string
  readonly regularAmount: string
  readonly waitDays: string
}
const customerDraftOf = (settings: CustomerSettings): CustomerDraft => ({ regularCount: String(settings.regularCount), regularAmount: settings.regularAmount === null ? '' : String(settings.regularAmount), waitDays: String(settings.waitDays) })
const sameCustomer = (a: CustomerDraft, b: CustomerDraft): boolean => a.regularCount.trim() === b.regularCount.trim() && a.regularAmount.trim().replace(/,/g, '') === b.regularAmount.trim().replace(/,/g, '') && a.waitDays.trim() === b.waitDays.trim()
/** 칸 글 → 보낼 값: 숫자(쉼표 묶음 허용)면 정수, 아니면 글 그대로(서버가 거절 문장을 준다) — 웹 settingValue와 같다 */
function settingValue(text: string): number | string {
  const value = text.trim()
  if (/^\d+$/.test(value) || /^\d{1,3}(,\d{3})+$/.test(value)) {
    const n = Number(value.replace(/,/g, ''))
    if (Number.isSafeInteger(n)) return n
  }
  return value
}

/** 받아 두는 값: 기억해 둔 것을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77). 처음 받기가 실패하면 다시 받기 */
function useLoad<T>(path: string) {
  const { data, error, reload, set } = useCachedGet<T>(path)
  return { value: data, setValue: set, error, retry: () => void reload() }
}

/**
 * 받은 값으로 칸을 채운다 (D-UX4-77): 뒤에서 새 값이 오면 판매자가 아직 손대지 않은 칸만 새 값으로 바꾼다 —
 * 고치던 칸은 덮지 않는다. untouched(칸, 전 값): 칸이 전 값 그대로인가. 저장 뒤에는 화면이 받은 값으로 직접 다시 채운다.
 */
function useDraft<V, D>(value: V | null, toDraft: (value: V) => D, untouched: (draft: D, value: V) => boolean): [D | null, Dispatch<SetStateAction<D | null>>] {
  const [draft, setDraft] = useState<D | null>(() => (value === null ? null : toDraft(value)))
  const seeded = useRef<V | null>(value)
  useEffect(() => {
    if (value === null || value === seeded.current) return
    const before = seeded.current
    seeded.current = value
    setDraft((current) => (current === null || before === null || untouched(current, before) ? toDraft(value) : current))
    // toDraft·untouched는 화면마다 같은 규칙이라 값이 바뀔 때만 본다
  }, [value])
  return [draft, setDraft]
}

export function ShopSettingsScreen({ onBack, onRenamed }: { readonly onBack: () => void; readonly onRenamed?: (name: string) => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  // 상태 막대 아래(SafeAreaView 위 여백)에서 시작하는 틀 — 키보드 피하기는 부모 기준 자리로 재므로 그만큼 더한다 (D-UX3-67, PhoneVerify와 같다)
  const top = useTopInset()
  const keyboard = useKeyboardShown()
  const shop = useLoad<{ shop: Shop }>('/api/shop')
  const settings = useLoad<{ settings: SaleSettings }>('/api/settings')
  const broadcasts = useLoad<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
  const parcel = useLoad<{ settings: ParcelSettings }>('/api/parcels/settings')
  const customer = useLoad<{ settings: CustomerSettings }>('/api/customer-settings')
  const ledger = useLoad<{ settings: LedgerSettings }>('/api/ledger-settings')

  // 받은 값으로 칸을 채운다 — 뒤에서 다시 받은 값은 손대지 않은 칸에만 (D-UX4-77)
  const [shopDraft, setShopDraft] = useDraft(shop.value, (value) => value.shop, (draft, value) => SHOP_FIELDS.every((field) => draft[field.key] === value.shop[field.key]))
  const [rules, setRules] = useDraft(settings.value, (value) => draftOf(value.settings, ALL_FIELDS), (draft, value) => Object.keys(changedSettings(ALL_FIELDS, draft, value.settings)).length === 0)
  const [parcelDraft, setParcelDraft] = useDraft(parcel.value, (value) => parcelDraftOf(value.settings), (draft, value) => sameParcelDraft(draft, parcelDraftOf(value.settings)))
  const [customerDraft, setCustomerDraft] = useDraft(customer.value, (value) => customerDraftOf(value.settings), (draft, value) => sameCustomer(draft, customerDraftOf(value.settings)))
  const [ledgerDraft, setLedgerDraft] = useDraft(ledger.value, (value) => value.settings, (draft, value) => draft.months === value.settings.months && draft.consoleBadges === value.settings.consoleBadges)
  const [moreRules, setMoreRules] = useState(false)
  const [moreThanks, setMoreThanks] = useState(false)
  // 봇이 감사 채팅을 대신 올리는 판매자 (D-YT-SEND-18) — 게시 동의 안내 대신 "라이브지니가 올려요"
  const botThanks = useBotThanks()
  const [errors, setErrors] = useState<Partial<Record<SaveBlock | 'ledger', ApiError>>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [leaving, setLeaving] = useState(false)

  const saved = settings.value?.settings ?? null
  const changes = saved !== null && rules !== null ? changedSettings(ALL_FIELDS, rules, saved) : {}
  const changedKeys = Object.keys(changes)
  const has = (fields: readonly FieldDef[]) => fields.some((field) => changedKeys.includes(field.key))
  const shopDirty = shop.value !== null && shopDraft !== null && SHOP_FIELDS.some((field) => shopDraft[field.key] !== shop.value?.shop[field.key])
  const parcelDirty = parcel.value !== null && parcelDraft !== null && !sameParcelDraft(parcelDraft, parcelDraftOf(parcel.value.settings))
  const customerDirty = customer.value !== null && customerDraft !== null && !sameCustomer(customerDraft, customerDraftOf(customer.value.settings))
  const ledgerDirty = ledger.value !== null && ledgerDraft !== null && (ledgerDraft.months !== ledger.value.settings.months || ledgerDraft.consoleBadges !== ledger.value.settings.consoleBadges)
  const dirty: SaveBlock[] = [
    ...(shopDirty ? (['가게'] as const) : []),
    ...(has(RULE_FIELDS) ? (['판매 규칙'] as const) : []),
    ...(has(SHIPPING_FIELDS) ? (['배송비'] as const) : []),
    ...(has(fieldsAt('thanks')) ? (['구매 감사 메시지'] as const) : []),
    ...(parcelDirty ? (['택배'] as const) : []),
    ...(customerDirty || ledgerDirty ? (['손님 관리'] as const) : []),
  ]
  const ongoing = broadcasts.value?.broadcasts.some((item) => !item.rehearsal && !item.ended) ?? false

  const saveAll = useCallback(async () => {
    if (busy || dirty.length === 0) return
    setBusy(true)
    setResult(null)
    const ok: SaveBlock[] = []
    const failed: SaveBlock[] = []
    const nextErrors: Partial<Record<SaveBlock | 'ledger', ApiError>> = {}
    const step = async (blocks: readonly SaveBlock[], run: () => Promise<void>, key: SaveBlock | 'ledger' = blocks[0] ?? '가게') => {
      try {
        await run()
        ok.push(...blocks)
      } catch (caught: unknown) {
        if (!isApiError(caught)) throw caught
        nextErrors[key] = caught
        failed.push(...blocks)
      }
    }
    if (shopDirty && shopDraft !== null) {
      await step(['가게'], async () => {
        const next = await put<{ shop: Shop }>('/api/shop', shopDraft)
        const merged = { ...shopDraft, ...next.shop }
        shop.setValue({ shop: merged })
        // 저장 뒤에는 받은 값으로 칸을 다시 채운다
        setShopDraft(merged)
        onRenamed?.(next.shop.name)
      })
    }
    const ruleBlocks = dirty.filter((block) => block === '판매 규칙' || block === '배송비' || block === '구매 감사 메시지')
    if (ruleBlocks.length > 0) {
      await step(ruleBlocks, async () => {
        const next = await patch<{ settings: SaleSettings }>('/api/settings', { settings: changes })
        settings.setValue({ settings: next.settings })
        setRules(draftOf(next.settings, ALL_FIELDS))
      }, '판매 규칙')
    }
    if (parcelDirty && parcel.value !== null && parcelDraft !== null) {
      const current = parcel.value.settings
      await step(['택배'], async () => {
        const next = await put<{ settings: ParcelSettings }>('/api/parcels/settings', parcelBody(current, parcelDraft))
        parcel.setValue({ settings: next.settings })
        setParcelDraft(parcelDraftOf(next.settings))
      })
    }
    if (ledgerDirty && ledgerDraft !== null) {
      await step([], async () => {
        const next = await put<{ settings: LedgerSettings }>('/api/ledger-settings', ledgerDraft)
        ledger.setValue({ settings: next.settings })
        setLedgerDraft(next.settings)
      }, 'ledger')
      if (nextErrors.ledger !== undefined) failed.push('손님 관리')
      else if (!customerDirty) ok.push('손님 관리')
    }
    if (customerDirty && customerDraft !== null) {
      await step(['손님 관리'], async () => {
        const next = await put<{ settings: CustomerSettings }>('/api/customer-settings', {
          regularCount: settingValue(customerDraft.regularCount),
          regularAmount: customerDraft.regularAmount.trim() === '' ? null : settingValue(customerDraft.regularAmount),
          waitDays: settingValue(customerDraft.waitDays),
        })
        customer.setValue({ settings: next.settings })
        setCustomerDraft(customerDraftOf(next.settings))
      })
    }
    setErrors(nextErrors)
    const okUnique = [...new Set(ok)].filter((block) => !failed.includes(block))
    setResult(failed.length === 0 ? { tone: 'success', text: savedMessage(okUnique) } : { tone: 'danger', text: failedMessage([...new Set(failed)], okUnique) })
    setBusy(false)
  }, [busy, dirty, shopDirty, shopDraft, changes, parcelDirty, parcelDraft, ledgerDirty, ledgerDraft, customerDirty, customerDraft, shop, settings, parcel, ledger, customer, onRenamed])

  const back = () => (dirty.length > 0 ? setLeaving(true) : onBack())
  const ruleProblem = (key: string): string | null => errors['판매 규칙']?.problemFor(`settings.${key}`)?.message ?? null
  const ruleField = (field: FieldDef) =>
    rules === null ? null : (
      <RuleField
        key={field.key}
        field={field}
        value={rules[field.key]}
        saved={saved?.[field.key]}
        problem={ruleProblem(field.key)}
        onChange={(value) => {
          setResult(null)
          setRules((current) => (current === null ? current : { ...current, [field.key]: value }))
        }}
      />
    )
  const loading = (state: { value: unknown; error: ApiError | null; retry: () => void }) =>
    state.value === null ? (
      state.error !== null ? (
        <View style={{ gap: SPACE.sm }}>
          <Notice tone="danger" alert>{state.error.message}</Notice>
          <BigButton kind="secondary" label={RETRY_NOW} onPress={state.retry} />
        </View>
      ) : (
        <Loading />
      )
    ) : null
  const outsideRules = errors['판매 규칙'] !== undefined && errors['판매 규칙'].problems.length === 0 ? <Notice tone="danger" alert>{errors['판매 규칙'].message}</Notice> : null
  const preview = shopDraft === null ? null : accountPreview(shopDraft)

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="shop-settings-screen">
      <AppHeader title="가게 설정" onBack={back} />
      {/* 키보드가 뜨면 내용과 저장 단추가 키보드 위로 올라온다 (D-UX3-67) */}
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} keyboardVerticalOffset={top} style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        {ongoing ? <Notice tone="warning">{ONGOING_NOTICE}</Notice> : null}

        <SettingsGroup title="가게">
            {loading(shop)}
            {shopDraft !== null
              ? SHOP_FIELDS.map((field) => (
                  <TextField
                    key={field.key}
                    label={field.label}
                    value={shopDraft[field.key]}
                    placeholder={field.placeholder}
                    keyboardType={field.key === 'accountNumber' ? 'numbers-and-punctuation' : 'default'}
                    onChangeText={(text) => {
                      setResult(null)
                      setShopDraft((current) => (current === null ? current : { ...current, [field.key]: text }))
                    }}
                    error={errors['가게']?.problemFor(field.key)?.message ?? null}
                  />
                ))
              : null}
            {preview !== null ? (
              <View style={{ gap: SPACE.xs, padding: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
                <Txt step="caption" color="textSub">확인서에 나올 모양</Txt>
                {preview === 'none' ? <Txt color="textSub">{NO_ACCOUNT_ON_RECEIPT}</Txt> : null}
                {preview === 'partial' ? <Notice tone="warning">{ACCOUNT_INCOMPLETE}</Notice> : null}
                {typeof preview === 'object' ? (
                  <>
                    <Txt>{preview.text}</Txt>
                    {preview.note !== null ? <Txt>{preview.note}</Txt> : null}
                  </>
                ) : null}
              </View>
            ) : null}
            {errors['가게'] !== undefined && errors['가게'].problems.length === 0 ? <Notice tone="danger" alert>{errors['가게'].message}</Notice> : null}
        </SettingsGroup>

        <SettingsGroup title="판매 규칙">
            {loading(settings)}
            {BASIC_FIELDS.map(ruleField)}
            <DetailToggle label={RULES_DETAIL} open={moreRules} onPress={() => setMoreRules((on) => !on)} />
            {moreRules ? (
              <>
                <GroupNote>{DETAIL_SETTINGS_NOTE}</GroupNote>
                {MORE_FIELDS.map(ruleField)}
              </>
            ) : null}
            {outsideRules}
        </SettingsGroup>

        <SettingsGroup title="배송비">
            {SHIPPING_FIELDS.map(ruleField)}
            <GroupNote>{SHIPPING_HINT}</GroupNote>
        </SettingsGroup>

        <SettingsGroup title="구매 감사 메시지">
            {THANKS_FIELDS.filter((field) => field.key === 'thanks.liveChat').map(ruleField)}
            {saved !== null && saved['thanks.videoComment'] !== 'OFF' && rules !== null ? (
              // 옛 영상 댓글: 글 한 줄 + 오른쪽 글자 단추 (D-UX3-96 — 옛 큰 회색 단추)
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <View style={{ flex: 1 }}>
                  <Txt>{rules['thanks.videoComment'] === 'OFF' ? '저장하면 영상 댓글을 남기지 않아요.' : VIDEO_COMMENT_ON}</Txt>
                </View>
                {rules['thanks.videoComment'] === 'OFF' ? (
                  <TextButton label="되돌리기" onPress={() => setRules((current) => (current === null ? current : { ...current, 'thanks.videoComment': String(saved['thanks.videoComment']) }))} />
                ) : (
                  <TextButton label="영상 댓글 끄기" onPress={() => setRules((current) => (current === null ? current : { ...current, 'thanks.videoComment': 'OFF' }))} />
                )}
              </View>
            ) : null}
            <GroupNote>{botThanks ? BOT_THANKS_OFF_FIRST : THANKS_CONSENT_NOTE}</GroupNote>
            <DetailToggle label={THANKS_DETAIL} open={moreThanks} onPress={() => setMoreThanks((on) => !on)} />
            {moreThanks ? THANKS_FIELDS.filter((field) => field.key !== 'thanks.liveChat').map(ruleField) : null}
        </SettingsGroup>

        <SettingsGroup title="택배">
            {loading(parcel)}
            {parcel.value !== null && parcelDraft !== null ? (
              <ParcelFields
                settings={parcel.value.settings}
                draft={parcelDraft}
                error={errors['택배'] ?? null}
                onChange={(next) => {
                  setResult(null)
                  setParcelDraft((current) => (current === null ? current : { ...current, ...next }))
                }}
              />
            ) : null}
        </SettingsGroup>

        <SettingsGroup title="손님 관리">
            <GroupNote>{CUSTOMER_RULE_HINT}</GroupNote>
            {loading(customer)}
            {customerDraft !== null
              ? (
                  [
                    { key: 'regularCount', label: '단골 횟수 (번)', hint: undefined },
                    { key: 'regularAmount', label: '단골 금액 (원)', hint: REGULAR_AMOUNT_HINT },
                    { key: 'waitDays', label: '입금 기다리는 날 (일)', hint: WAIT_DAYS_HINT },
                  ] as const
                ).map((field) => (
                  <TextField
                    key={field.key}
                    label={field.label}
                    value={customerDraft[field.key]}
                    keyboardType="number-pad"
                    {...(field.hint === undefined ? {} : { help: field.hint })}
                    onChangeText={(text) => {
                      setResult(null)
                      setCustomerDraft((current) => (current === null ? current : { ...current, [field.key]: text }))
                    }}
                    error={errors['손님 관리']?.problemFor(field.key)?.message ?? null}
                  />
                ))
              : null}
            {ledgerDraft !== null ? (
              <View style={{ gap: SPACE.sm }}>
                <FieldLabel>{LEDGER_MONTHS_LABEL}</FieldLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
                  {LEDGER_MONTHS.map((months) => (
                    <Pill key={months} on={ledgerDraft.months === months} label={LEDGER_MONTH_WORDS[months]} ariaLabel={`${LEDGER_MONTHS_LABEL} ${LEDGER_MONTH_WORDS[months]}`} onPress={() => setLedgerDraft({ ...ledgerDraft, months })} />
                  ))}
                </View>
                <GroupNote>{LEDGER_MONTHS_HELP}</GroupNote>
                <ToggleRow title={CONSOLE_BADGES_LABEL} subtitle={CONSOLE_BADGES_HELP} on={ledgerDraft.consoleBadges === true} onChange={(on) => setLedgerDraft({ ...ledgerDraft, consoleBadges: on })} />
                {ledgerDraft.consoleBadges === null ? <Notice tone="warning">{CONSOLE_BADGES_UNDECIDED}</Notice> : null}
                <GroupNote>{CONSOLE_BADGES_DETAIL}</GroupNote>
                {errors.ledger !== undefined ? <Notice tone="danger" alert>{errors.ledger.message}</Notice> : null}
              </View>
            ) : null}
        </SettingsGroup>

        <AssistCard />
        <ConnectionsCard />
        <BackupCard />
        <ExportCard />
      </ScrollView>

      <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, paddingBottom: keyboard ? SPACE.sm : Math.max(inset, SPACE.sm), gap: SPACE.sm, borderTopWidth: 1, borderTopColor: p.line, backgroundColor: p.surface }}>
        {result !== null ? <Notice tone={result.tone} alert={result.tone === 'danger'}>{result.text}</Notice> : <Txt step="caption" color="textSub" center>{dirtyLine(dirty)}</Txt>}
        <BigButton label={SAVE_LABEL} busy={busy} disabled={dirty.length === 0} onPress={() => void saveAll()} />
      </View>
      </KeyboardAvoidingView>

      <ConfirmSheet
        visible={leaving}
        question={LEAVE_UNSAVED}
        description={dirtyLine(dirty)}
        confirmLabel="저장하지 않고 나가기"
        cancelLabel="머무르기"
        danger
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false)
          onBack()
        }}
      />
    </View>
  )
}

/** 판매 규칙 칸 하나 (웹 RuleField와 같은 낱말): 숫자·금액은 적는 칸, 고르기는 줄마다 하나, 켜기는 스위치 */
function RuleField({ field, value, saved, problem, onChange }: { readonly field: FieldDef; readonly value: string | boolean | undefined; readonly saved: unknown; readonly problem: string | null; readonly onChange: (value: string | boolean) => void }) {
  const warning = fieldWarning(field, value)
  const note = fieldChangeNote(field, value, saved)
  if (field.kind === 'bool') {
    return (
      <View style={{ gap: SPACE.xs }}>
        <ToggleRow title={field.label} on={value === true} onChange={onChange} />
        {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
      </View>
    )
  }
  if (field.kind === 'choice') {
    return (
      <View style={{ gap: SPACE.xs }} role="radiogroup" aria-label={field.label}>
        <FieldLabel>{field.label}</FieldLabel>
        {field.leadChat !== undefined ? <GroupNote>{`${field.leadChat.author}  ${field.leadChat.text}`}</GroupNote> : null}
        {field.options.map((option) => (
          <Pill key={option.value} on={value === option.value} label={option.word} ariaLabel={`${field.label} ${option.word}`} onPress={() => onChange(option.value)} />
        ))}
        {field.hint !== undefined ? <GroupNote>{field.hint}</GroupNote> : null}
        {note !== null ? <Notice tone="info">{note}</Notice> : null}
        {warning !== null ? <Notice tone="warning">{warning}</Notice> : null}
        {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
      </View>
    )
  }
  return (
    <View style={{ gap: SPACE.xs }}>
      <TextField label={field.label} value={typeof value === 'string' ? value : ''} keyboardType="number-pad" onChangeText={onChange} error={problem} {...(field.hint === undefined ? {} : { help: field.hint })} />
      {warning !== null ? <Notice tone="warning">{warning}</Notice> : null}
    </View>
  )
}

function ParcelFields({ settings, draft, error, onChange }: { readonly settings: ParcelSettings; readonly draft: ParcelDraft; readonly error: ApiError | null; readonly onChange: (patch: Partial<ParcelDraft>) => void }) {
  const chosen = settings.carriers.find((carrier) => carrier.code === draft.carrier)
  return (
    <View style={{ gap: SPACE.sm }}>
      <FieldLabel>택배사</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        <Pill on={draft.carrier === ''} label="고르지 않음" ariaLabel="택배사 고르지 않음" onPress={() => onChange({ carrier: '' })} />
        {settings.carriers.map((carrier) => (
          <Pill key={carrier.code} on={draft.carrier === carrier.code} label={carrier.name} ariaLabel={`택배사 ${carrier.name}`} onPress={() => onChange({ carrier: carrier.code })} />
        ))}
      </View>
      {error?.problemFor('carrier') !== undefined ? <Notice tone="danger" alert>{error.problemFor('carrier')?.message}</Notice> : null}
      {draft.carrier === OTHER_CARRIER ? <TextField label={CARRIER_NAME_LABEL} value={draft.carrierName} maxLength={CARRIER_NAME_MAX * 2} onChangeText={(carrierName) => onChange({ carrierName })} error={error?.problemFor('carrierName')?.message ?? null} /> : null}
      {chosen === undefined || !chosen.autoBook ? <GroupNote>{NO_AUTO_BOOK_NOTE}</GroupNote> : null}
      {draft.carrier === EPOST_CARRIER && chosen?.autoBook === true ? <Notice tone="info">{settings.epostReady === true ? EPOST_PRINT_NOTE : EPOST_GUIDE}</Notice> : null}
      <TextField
        label={draft.carrier === EPOST_CARRIER ? EPOST_CUSTOMER_LABEL : '택배사 고객 번호'}
        value={draft.customerNo}
        onChangeText={(customerNo) => onChange({ customerNo })}
        help={settings.customerNoLast4 === null ? '택배사와 계약하면 받는 번호예요. 없으면 비워 두세요.' : `저장한 번호 끝 ${settings.customerNoLast4} · 바꿀 때만 새로 적어 주세요.`}
        error={error?.problemFor('customerNo')?.message ?? null}
      />
      {draft.carrier === EPOST_CARRIER && chosen?.autoBook === true ? (
        <>
          <TextField label={EPOST_KEY_LABEL} value={draft.epostKey} autoCapitalize="none" autoCorrect={false} secureTextEntry onChangeText={(epostKey) => onChange({ epostKey })} help={epostKeyHelp(settings.epostReady === true)} error={error?.problemFor('epostKey')?.message ?? null} />
          <TextField label={EPOST_SECRET_LABEL} value={draft.epostSecret} autoCapitalize="none" autoCorrect={false} secureTextEntry onChangeText={(epostSecret) => onChange({ epostSecret })} error={error?.problemFor('epostSecret')?.message ?? null} />
        </>
      ) : null}
      {draft.carrier === 'EPOST' || (settings.epostPassword ?? '') !== '' ? (
        <TextField
          label={EPOST_PASSWORD_LABEL}
          value={draft.epostPassword}
          keyboardType="number-pad"
          maxLength={4}
          onChangeText={(epostPassword) => onChange({ epostPassword })}
          help={EPOST_PASSWORD_HINT}
          error={error?.problemFor('epostPassword')?.message ?? null}
        />
      ) : null}
      <View style={{ height: SPACE.xs }} />
      <FieldLabel>보내는 사람</FieldLabel>
      {SENDER_KEYS.map((key) => (
        <TextField
          key={key}
          label={SENDER_LABELS[key]}
          value={draft.sender[key]}
          keyboardType={key === 'phone' || key === 'zip' ? 'number-pad' : 'default'}
          onChangeText={(text) => onChange({ sender: { ...draft.sender, [key]: text } })}
          error={error?.problemFor(`sender.${key}`)?.message ?? null}
        />
      ))}
      {error?.problemFor('sender') !== undefined ? <Notice tone="danger" alert>{error.problemFor('sender')?.message}</Notice> : null}
      <View style={{ height: SPACE.xs }} />
      <FieldLabel>{BOX_LABEL}</FieldLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {settings.boxes.map((box) => (
          <Pill key={box} on={draft.box === box} label={boxWord(box)} ariaLabel={`${BOX_LABEL} ${boxWord(box)}`} onPress={() => onChange({ box })} />
        ))}
      </View>
      <GroupNote>{`${BOX_HINT} 택배 화면에서 묶음마다 바꿀 수 있어요.`}</GroupNote>
      {error !== null && error.problems.length === 0 ? <Notice tone="danger" alert>{error.message}</Notice> : null}
    </View>
  )
}

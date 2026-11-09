// 내 품종 (D-V3-127, 사용자 "사장이 방송 전에 우리 앱에다가 본인이 키우는 다육이 품종을 모두 입력하게 하면 관리하기도 쉽고 알아듣기도 쉬울 듯"):
// 사장이 키우는 품종 이름 목록. 교배로 직접 지은 이름처럼 어떤 사전에도 없는 것을 여기 적으면 음성이 그 이름을 먼저 맞추고, 받아쓰기에도 미리 알려 준다.
// - 한 줄 입력 + [더하기] (쉼표·줄바꿈으로 여럿 한 번에), 이름 줄마다 [지우기]. 바뀌면 바로 저장(PUT /api/voice/varieties, 목록 통째로).
// - "판 적 있는 품종": 서버가 최근 판 상품 이름·배운 별칭에서 고른 것 — 누르면 장부에 더한다.
// - 모양 (D-UX3-96): 흰 묶음 카드(카드 안 작은 회색 이름), 이름 줄 사이 선은 빼고 오른쪽에 글자 단추 [지우기].
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { get, isApiError, put } from '../api/client.ts'
import { AppHeader, BigButton, ErrorLine, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Pill } from '../ui/day-pills.tsx'
import { Loading, Row } from '../ui/parts.tsx'
import { GroupNote, SETTINGS_GUTTER, SettingsGroup, TextButton } from './settings/Group.tsx'

export const VARIETIES_TITLE = '내 품종'
export const VARIETIES_HELP = '키우는 품종 이름을 적어 두면 방송 때 말한 품종을 더 잘 알아들어요. 직접 지은 이름도 적어 주세요.'
export const VARIETIES_INPUT_LABEL = '품종 이름'
export const VARIETIES_INPUT_HELP = '쉼표나 줄바꿈으로 여러 개를 한 번에 넣을 수 있어요.'
export const VARIETIES_EMPTY = '아직 적은 품종이 없어요.'
export const VARIETIES_SUGGEST_TITLE = '판 적 있는 품종'
export const VARIETIES_SUGGEST_HELP = '누르면 내 품종에 더해요.'
export const VARIETIES_SAVE_FAILED = '저장하지 못했어요. 다시 눌러 주세요.'
export const VARIETIES_LOAD_FAILED = '품종 목록을 불러오지 못했어요.'

interface VarietyList { readonly names: readonly string[]; readonly suggested: readonly string[] }

/** 입력 글 → 이름들 (쉼표·줄바꿈·가운뎃점으로 나눔, 앞뒤 공백 빼고 빈 것 없음) */
export function splitVarietyInput(text: string): string[] {
  return text.split(/[,\n·]/).map((item) => item.replace(/\s+/g, ' ').trim()).filter((item) => item !== '')
}
const keyOf = (name: string): string => name.replace(/\s+/g, '').toLowerCase()

export function VarietiesScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  const [list, setList] = useState<VarietyList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoadError(null)
    get<VarietyList>('/api/voice/varieties').then(setList, () => setLoadError(VARIETIES_LOAD_FAILED))
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (names: readonly string[]) => {
    if (list === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await put<{ names: string[] }>('/api/voice/varieties', { names })
      const keys = new Set(saved.names.map(keyOf))
      setList({ names: saved.names, suggested: list.suggested.filter((item) => !keys.has(keyOf(item))) })
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : VARIETIES_SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }
  const add = async (names: readonly string[]) => {
    if (list === null) return
    const keys = new Set(list.names.map(keyOf))
    const fresh = names.filter((name) => { const key = keyOf(name); if (keys.has(key)) return false; keys.add(key); return true })
    if (fresh.length === 0) { setText(''); return }
    await save([...list.names, ...fresh])
    setText('')
  }
  const remove = (name: string) => { if (list !== null) void save(list.names.filter((item) => item !== name)) }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="varieties-screen">
      <AppHeader title={VARIETIES_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SETTINGS_GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SPACE.xs }}>
          <GroupNote>{VARIETIES_HELP}</GroupNote>
        </View>
        <SettingsGroup label="더하기">
          <TextField label={VARIETIES_INPUT_LABEL} help={VARIETIES_INPUT_HELP} value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void add(splitVarietyInput(text))} />
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <BigButton label="더하기" disabled={busy || list === null || splitVarietyInput(text).length === 0} onPress={() => void add(splitVarietyInput(text))} />
        </SettingsGroup>
        <SettingsGroup title={`내 품종${list === null ? '' : ` ${String(list.names.length)}개`}`} label="내 품종 목록">
          {loadError !== null ? (
            <View style={{ gap: SPACE.sm }}>
              <ErrorLine>{loadError}</ErrorLine>
              <Row><BigButton kind="secondary" label="다시 불러오기" onPress={load} /></Row>
            </View>
          ) : list === null ? <Loading /> : list.names.length === 0 ? <GroupNote>{VARIETIES_EMPTY}</GroupNote> : (
            <View role="list" aria-label="내 품종 목록">
              {list.names.map((name) => (
                <View key={name} role="listitem" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44 }}>
                  <View style={{ flex: 1 }}><Txt step="bodyLarge" weight="book">{name}</Txt></View>
                  <TextButton label="지우기" ariaLabel={`${name} 지우기`} disabled={busy} onPress={() => remove(name)} />
                </View>
              ))}
            </View>
          )}
        </SettingsGroup>
        {list !== null && list.suggested.length > 0 ? (
          <SettingsGroup title={VARIETIES_SUGGEST_TITLE} label={VARIETIES_SUGGEST_TITLE}>
            <Row wrap>
              {list.suggested.map((name) => <Pill key={name} on={false} label={name} ariaLabel={`${name} 더하기`} onPress={() => void add([name])} />)}
            </Row>
            <GroupNote>{VARIETIES_SUGGEST_HELP}</GroupNote>
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </View>
  )
}

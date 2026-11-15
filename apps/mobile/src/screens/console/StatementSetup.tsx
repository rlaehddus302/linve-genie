// 정산서에 넣을 정보 한 판 (D-UX4-172, 사용자 지시 2026-11-16 "가게 이름, 정산 정보 버튼은 기능을 하나로 합쳐서 [정산서에 넣을 정보를 알려 주세요]"):
// 옛 정산 화면은 [가게 이름](이 방송 정산서의 가게 이름 판)과 [정산 정보](계좌·전화번호·방송 이름·배송비 판, D-RETRO-60)가 따로였다.
// 이제 한 판에서 가게 이름과 정산 정보를 같이 적고 [저장] 한 번으로 둘 다 저장한다. 방송을 끝낸 직후·정산서를 처음 만들 때 묻는 판도 이것이다.
// - 단추는 좌우 한 줄: 왼쪽 [나중에] · 오른쪽 [저장] (절대 규칙 8).
// - 가게 이름은 바뀐 때만 저장한다(PUT /api/broadcasts/:id/order-shop). 정산 정보는 서버가 받는 때만 칸을 보이고 저장한다.
// - 계좌번호·전화번호는 기록(로그)에 남기지 않는다.
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { isApiError, put } from '../../api/client.ts'
import { rememberCached } from '../../lib/cached-get.ts'
import type { StatementInfo } from '../../lib/broadcast-sales.ts'
import { BigButton, FullSheet, GroupLabel, TextField } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { ASK_AFTER_END_TITLE, ASK_BODY, LATER_LABEL, SAVE_LABEL, STATEMENT_INFO_TITLE, useStatementInfoForm } from '../StatementInfo.tsx'

export const SHOP_NAME_LABEL = '가게 이름'
/** 판 안 묶음 이름 (입금 계좌·연락처·배송비 묶음 위) */
const SHOP_GROUP = '가게'
export const SHOP_NAME_EMPTY = '가게 이름을 적어 주세요.'
export const SHOP_NAME_FAILED = '가게 이름을 저장하지 못했어요.'

/**
 * shopPath: 이 방송의 정산서 가게 이름 주소 · shopName: 받은 이름(아직이면 null) ·
 * info: 고칠 수 있는 정산 정보(서버가 모르면 null — 가게 이름만 묻는다)
 */
export function StatementSetupSheet({ visible, shopPath, shopName, info, onLater, onSaved }: {
  readonly visible: boolean; readonly shopPath: string; readonly shopName: string | null; readonly info: StatementInfo | null
  readonly onLater: () => void; readonly onSaved: () => void
}) {
  const [name, setName] = useState(shopName ?? '')
  const [nameError, setNameError] = useState('')
  const [savingName, setSavingName] = useState(false)
  // 판을 열 때마다(그리고 이름을 늦게 받으면) 받은 이름으로 칸을 새로 채운다
  useEffect(() => {
    if (!visible) return
    setName(shopName ?? '')
    setNameError('')
  }, [visible, shopName])
  const form = useStatementInfoForm(info, () => onSaved(), visible)
  const busy = savingName || form.busy
  const save = async () => {
    if (busy) return
    const typed = name.trim()
    // 받은 이름이 있는데 칸을 비웠으면 묻는다 (정산서에는 가게 이름이 꼭 들어간다)
    if (typed === '' && shopName !== null) { setNameError(SHOP_NAME_EMPTY); return }
    if (typed !== '' && typed !== (shopName ?? '').trim()) {
      setSavingName(true)
      setNameError('')
      try {
        rememberCached(shopPath, await put<{ name: string }>(shopPath, { name: typed }))
      } catch (e) {
        setNameError(isApiError(e) ? e.message : SHOP_NAME_FAILED)
        return
      } finally { setSavingName(false) }
    }
    if (info !== null) form.save()
    else onSaved()
  }
  return (
    <FullSheet visible={visible} onClose={onLater} name={STATEMENT_INFO_TITLE} title={ASK_AFTER_END_TITLE} description={ASK_BODY} testID="statement-info-sheet"
      actions={<>
        <BigButton kind="outline" label={LATER_LABEL} disabled={busy} onPress={onLater} />
        <BigButton label={SAVE_LABEL} busy={busy} disabled={info !== null && !form.ready} onPress={() => void save()} />
      </>}>
      <View style={{ gap: SPACE.xl }}>
        <View role="group" aria-label={SHOP_GROUP} style={{ gap: SPACE.md }}>
          <GroupLabel>{SHOP_GROUP}</GroupLabel>
          <TextField label={SHOP_NAME_LABEL} value={name} placeholder="초록다육" maxLength={40} help="정산서 맨 위에 찍혀요." onChangeText={(text) => { setName(text); setNameError('') }} error={nameError || null} />
        </View>
        {info !== null ? form.fields : null}
      </View>
    </FullSheet>
  )
}

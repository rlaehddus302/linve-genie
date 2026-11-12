import { useRef, useState } from 'react'
import { View } from 'react-native'
import { copyToClipboard } from '../../lib/clipboard.ts'
import { isApiError, post } from '../../api/client.ts'
import { BigButton, BottomSheet, ButtonRow, ErrorLine, Txt } from '../../ui/kit/index.ts'
import { Field } from '../../ui/parts.tsx'
import { PlainRow } from './parts.tsx'

export function CatalogTeam({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const submit = async (join: boolean) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await post<{ code: string }>(
        `/api/broadcasts/${encodeURIComponent(id)}/product-team`,
        join ? { code: input.trim() } : {},
      )
      setCode(result.code)
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : '공동 관리 연결을 확인하지 못했어요.')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <PlainRow title="상품 공동 관리" onPress={() => setOpen(true)} />
      <BottomSheet visible={open} title="상품 공동 관리" onClose={() => setOpen(false)}>
        <View style={{ gap: 12 }}>
          <Txt>같은 라이브에서 상품을 함께 수정하거나 삭제할 계정과 코드를 공유하세요.</Txt>
          {code ? (
            <>
              <Txt>{code}</Txt>
              <BigButton label="코드 복사" kind="outline" onPress={() => void copyToClipboard(code)} />
            </>
          ) : (
            <>
              <Field label="받은 코드" value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} />
              <ButtonRow>
                <BigButton kind="outline" label="내 코드 보기" disabled={busy} onPress={() => void submit(false)} />
                <BigButton label="함께 관리하기" disabled={busy || !input.trim()} onPress={() => void submit(true)} />
              </ButtonRow>
            </>
          )}
          {error ? <ErrorLine>{error}</ErrorLine> : null}
        </View>
      </BottomSheet>
    </>
  )
}

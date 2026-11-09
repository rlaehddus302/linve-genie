// 상품 목록 가져오기 (PRD-05 앱, D-V3-128 — 사용자 "상품 미리 등록하는 기능을 제공하긴 할거다 … 메인으로 쓰진 않을거다"):
// 방송 전에 번호·품종·가격을 붙여 넣어 공개 전(READY) 상품으로 한 번에 등록한다. 웹 ImportDialog와 같은 규칙·문구(R-18, D-I2-09).
// - 여러 줄 칸에 "번호 품종 가격"을 한 줄씩(엑셀 세 칸 복사도 됨) → [미리 보기](서버가 해석, 기록하지 않음) → 줄마다 등록할 값 또는 문제 문장
// - [n개 등록하기]는 문제 없는 줄만 한 번에. 같은 줄을 다시 보내면 같은 요청 번호. 그 사이 바뀌었으면(IMPORT_CHANGED) 새 미리 보기 + 안내.
// - 파일 고르기는 앱에 없다(웹에서). 안 써도 지금처럼 음성·빠른 입력으로 등록된다.
import { formatWon } from '../../lib/words.ts'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { ImportPreview } from '@livejjim/web/src/api/types.ts'
import { IMPORT_CHANGED, IMPORT_EMPTY, IMPORT_TOO_MANY, importProblemWords } from '@livejjim/web/src/lib/import-words.ts'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../../api/client.ts'
import { BigButton, Body, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { useConsoleApi } from './context.ts'

/** 줄 이름 (D-UX4-78 — 옛 "상품 목록 가져오기": 하는 일이 방송 전 상품 미리 등록이라 그 말로) */
export const APP_IMPORT_TITLE = '상품 미리 등록'
export const APP_IMPORT_GUIDE = '한 줄에 "번호 품종 가격"을 적어 주세요. 엑셀에서 세 칸을 복사해 붙여 넣어도 돼요.'
export const APP_IMPORT_NOTE = '가져온 상품은 공개 전이에요. 방송에서 소개할 때 공개돼요.'
export const APP_IMPORT_PREVIEW = '미리 보기'
export const importDoneMessage = (count: number): string => `${String(count)}개를 공개 전 상품으로 등록했어요.`
export const importSummary = (preview: ImportPreview): string => `등록할 상품 ${String(preview.register)}개 · 빼는 줄 ${String(preview.problems)}개`

interface RegisterRow { readonly no: number; readonly name: string; readonly price: number }

export function ImportView({ onDone }: { readonly onDone?: () => void }) {
  const api = useConsoleApi()
  const base = `/api/broadcasts/${encodeURIComponent(api.b)}/import`
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'register' | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [changed, setChanged] = useState(false)
  const pending = useRef<{ key: string; requestId: string } | null>(null)

  const runPreview = async (source: string): Promise<ImportPreview | null> => {
    setBusy('preview')
    setError(null)
    try {
      const result = await withRetry(() => post<ImportPreview>(`${base}/preview`, { text: source }))
      setPreview(result)
      setPreviewText(source)
      return result
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return null
    } finally {
      setBusy(null)
    }
  }
  const showPreview = () => {
    if (text.trim() === '' || busy !== null) return
    setDone(null)
    setChanged(false)
    void runPreview(text)
  }
  const rows: RegisterRow[] = preview === null ? [] : preview.rows.flatMap((row) => ('error' in row ? [] : [{ no: row.no, name: row.name, price: row.price }]))
  const stale = preview !== null && previewText !== text

  const register = async () => {
    if (preview === null || rows.length === 0 || busy !== null || stale) return
    const key = JSON.stringify(rows)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy('register')
    setError(null)
    setChanged(false)
    try {
      const result = await withRetry(() => post<{ registered: number; seq: number }>(base, { requestId, rows }))
      pending.current = null
      await api.sync?.(result.seq)
      setDone(result.registered)
      setPreview(null)
      setPreviewText(null)
      setText('')
      onDone?.()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      if (caught.code === 'IMPORT_CHANGED' && previewText !== null) {
        setBusy(null)
        await runPreview(previewText)
        setChanged(true)
        return
      }
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Hint>{APP_IMPORT_GUIDE}</Hint>
      <Field label="상품 목록" value={text} onChangeText={setText} multiline numberOfLines={6} autoCorrect={false} autoCapitalize="none" placeholder={'15 핑크프릴 12000\n16 아사달금 50000'} />
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {changed ? <Notice tone="warning">{IMPORT_CHANGED}</Notice> : null}
      {done !== null ? <Notice tone="success" label="가져오기 결과">{importDoneMessage(done)}</Notice> : null}
      {preview !== null ? (
        <View role="group" aria-label="미리 보기" style={{ gap: 8 }}>
          <Body bold>{preview.error === 'EMPTY' ? IMPORT_EMPTY : preview.error === 'TOO_MANY' ? IMPORT_TOO_MANY : importSummary(preview)}</Body>
          {preview.header !== null ? <Hint>{`머리글로 보고 뺀 줄: ${String(preview.header)}번 줄${preview.headerCells === null ? '' : ` (${preview.headerCells.join(', ')})`}`}</Hint> : null}
          {stale ? <Hint>글을 고쳤어요. 미리 보기를 다시 눌러 주세요.</Hint> : null}
          <View role="list" aria-label="가져올 줄">
            {preview.rows.map((row) => (
              <View key={row.line} role="listitem" style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
                <Hint>{`${String(row.line)}줄`}</Hint>
                {'error' in row ? <Body>{`${row.text.trim() === '' ? '' : `${row.text.trim()} — `}${importProblemWords(row.error, preview.maxNumber)}`}</Body> : <Body>{`${String(row.no)}번 ${row.name.trim() === '' ? '품종 미입력' : row.name} ${formatWon(row.price)}`}</Body>}
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Hint>{APP_IMPORT_NOTE}</Hint>
      <Row>
        <BigButton small label={APP_IMPORT_PREVIEW} disabled={text.trim() === '' || busy !== null} onPress={showPreview} />
        <BigButton primary label={`${String(rows.length)}개 등록하기`} disabled={preview === null || rows.length === 0 || busy !== null || stale} onPress={() => void register()} />
      </Row>
    </View>
  )
}

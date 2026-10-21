// 상품 상세의 "옵션 고치기" (D-O-14, D-O2-11, AC-O2-17). 찜(어떤 상태든)이 하나라도 있으면 선택지 더하기·가격 차이·재고·별칭만 고친다.
// 서버가 기록했지만 엔진이 아무 일도 하지 않았으면(changed=false) "바뀐 것이 없어요" — 저장 완료로 보이지 않는다.
import { useState } from 'react'
import { isApiError, newRequestId, type ApiError } from '../api/client.ts'
import { draftOfProduct, type OptionPayload } from '../lib/options.ts'
import { productLabel, useConsoleApi } from './console-context.ts'
import { Modal } from './Modal.tsx'
import { OptionDialog } from './OptionDialog.tsx'

export function EditOptionsHost({ productKey, onClose }: { readonly productKey: string; readonly onClose: () => void }) {
  const api = useConsoleApi()
  const product = api.data.products.get(productKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [unchanged, setUnchanged] = useState(false)
  const [initial] = useState(() => (product === undefined ? null : draftOfProduct(product)))
  const [requestId, setRequestId] = useState<{ key: string; id: string } | null>(null)
  if (product === undefined || initial === null) {
    return (
      <Modal title="옵션 고치기" onClose={onClose}>
        <p>그 상품을 찾지 못했어요.</p>
      </Modal>
    )
  }
  let locked = false
  for (const claim of api.data.claims.values()) {
    if (claim.product === product.key) {
      locked = true
      break
    }
  }
  const submit = async (payload: OptionPayload) => {
    if (busy) return
    const event: Record<string, unknown> = {
      type: 'product.update',
      b: product.broadcast,
      no: product.no,
      aliases: payload.aliases,
      // 옵션이 없던 상품에 옵션을 넣지 않았으면 옵션·재고 칸을 보내지 않는다 (재고는 stock 칸)
      ...(payload.options.length > 0 || product.options.length > 0 ? { options: payload.options } : {}),
      ...(payload.options.length > 0 ? { stocks: payload.stocks } : {}),
    }
    // 같은 내용으로 다시 누르면(저장하지 못한 뒤) 같은 요청 번호
    const key = JSON.stringify(event)
    const id = requestId?.key === key ? requestId.id : newRequestId()
    setRequestId({ key, id })
    setBusy(true)
    setError(null)
    setUnchanged(false)
    try {
      const result = await api.command(event, id)
      if (!result.changed) {
        setUnchanged(true)
        return
      }
      onClose()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <OptionDialog
      title={`${productLabel(api, product.broadcast, product.no)} 옵션 고치기`}
      initial={initial}
      price={product.price}
      locked={locked}
      submitLabel="옵션 저장"
      busy={busy}
      error={error}
      unchanged={unchanged}
      onSubmit={(payload) => void submit(payload)}
      onClose={onClose}
    />
  )
}

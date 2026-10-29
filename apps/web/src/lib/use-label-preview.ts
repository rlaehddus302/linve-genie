import { useEffect, useState } from 'react'
import { isApiError } from '../api/client.ts'
import { fetchLabelPreview } from '../api/label-bitmap.ts'
import type { PagesOutcome } from './label-render.ts'

/** 자료나 템플릿이 바뀌면 다시 받는다. 옛 요청의 늦은 그림은 지금 라벨에 쓰지 않는다. */
export function useLabelPreview(path: string | null, revision: string): PagesOutcome | null {
  const key = `${path ?? ''}\n${revision}`
  const [result, setResult] = useState<{ key: string; value: PagesOutcome } | null>(null)
  useEffect(() => {
    if (path === null) return
    let alive = true
    void fetchLabelPreview(path).then(
      (value) => { if (alive) setResult({ key, value }) },
      (error: unknown) => { if (alive) setResult({ key, value: { ok: false, error: { code: 'INVALID_DATA', message: isApiError(error) ? error.message : '라벨 그림을 받지 못했어요. 연결을 확인해 주세요.' } } }) },
    )
    return () => { alive = false }
  }, [path, key])
  return path === null || result?.key !== key ? null : result.value
}

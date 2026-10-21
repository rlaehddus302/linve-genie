// 파일 내려받기 버튼 (I2 AC-I2-13·14·22·39·65): 누르면 잠그고(여러 번 눌러도 요청 하나) "만드는 중" 글을 보이고, 받으면 그 이름으로 저장한다.
// 실패하면 서버 문장 그대로(연결이 끊기면 "인터넷 연결을 확인하고 다시 눌러 주세요.").
import { useCallback, useRef, useState } from 'react'
import { getFile, isApiError, type ApiError } from '../api/client.ts'
import { saveFile } from '../lib/files.ts'
import { RequestError } from './ErrorNote.tsx'

export interface Download {
  readonly busy: boolean
  readonly error: ApiError | null
  /** 받아서 저장한다. 받는 중이면 아무것도 하지 않는다 */
  readonly run: (path: string, fallbackName: string) => Promise<void>
}

export function useDownload(): Download {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const running = useRef(false)
  const run = useCallback(async (path: string, fallbackName: string) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      const file = await getFile(path, { fallbackName })
      saveFile(file.blob, file.fileName)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return { busy, error, run }
}

export interface DownloadButtonProps {
  readonly label: string
  /** 받는 동안 보이는 글 */
  readonly busyText: string
  readonly path: string
  readonly fallbackName: string
  readonly disabled?: boolean
  readonly primary?: boolean
}

/** 버튼 + 만드는 중 글 + 오류 (버튼 이름은 받는 동안에도 그대로 — 잠기기만 한다) */
export function DownloadButton({ label, busyText, path, fallbackName, disabled = false, primary = false }: DownloadButtonProps) {
  const download = useDownload()
  return (
    <span className="download stack-tight">
      <span className="row">
        <button type="button" className={primary ? 'button button-primary' : 'button'} disabled={disabled || download.busy} onClick={() => void download.run(path, fallbackName)}>
          {label}
        </button>
        {download.busy ? <span role="status">{busyText}</span> : null}
      </span>
      {download.error !== null ? <RequestError error={download.error} /> : null}
    </span>
  )
}

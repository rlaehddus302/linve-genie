// 설정 (SPEC §7 화면 8, STL-04, DAT-03·04, D-I2-02·D-I2-10~12, AC-I2-02·65).
// - 가게: "가게 이름"·"은행"·"계좌번호"·"예금주"·"입금 안내 문장"과 "저장"(주 버튼). 칸 아래에 확인서에 나올 모양을 미리 보인다
//   (`농협 302-9988-7766-11 (예금주 김판매)`와 안내 문장 — 계좌가 없으면 "확인서에 입금 계좌가 나오지 않아요.").
//   저장되면 "저장했어요."(성공)이고 화면 위 가게 이름이 바로 바뀐다. 서버 오류는 그 칸 옆에 서버 문장 그대로.
// - 백업: 마지막 자동 백업 시각(KST)·보관 기간·보관 중인 백업 목록(만든 시각·크기). 꺼져 있거나 마지막 성공이 26시간보다 오래되면 주의 안내.
//   복구·백업 파일 내려받기 버튼은 없다(운영자에게 날짜를 알려 되돌린다 — D-I2-11).
// - 전체 기록 내려받기: "전체 기록(JSON)"·"전체 판매대장(엑셀)" — 만드는 동안 그 버튼이 잠기고 "만드는 중이에요…".
import { useEffect, useId, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { BackupStatus, Shop } from '../api/types.ts'
import { sizeWords } from '../lib/files.ts'
import { kstDateTimeLong } from '../lib/kst.ts'
import { DownloadButton } from './downloads.tsx'
import { RequestError } from './ErrorNote.tsx'

export const SAVED = '저장했어요.'
export const NO_ACCOUNT_ON_RECEIPT = '확인서에 입금 계좌가 나오지 않아요.'
/** 계좌 칸을 일부만 적었을 때 미리 보기 (서버 거절 문장과 다른 글 — 같은 글이 두 번 보이지 않게) */
export const ACCOUNT_INCOMPLETE = '은행·계좌번호·예금주가 모두 있어야 확인서에 계좌가 나와요.'
export const BACKUP_STOPPED = '자동 백업이 멈췄어요. 운영자에게 알려 주세요.'
export const RESTORE_HINT = '백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.'
export const EXPORT_WARNING = '구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.'
/** 마지막 자동 백업이 이보다 오래되면 멈춘 것으로 본다 (AC-I2-65) */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000

const FIELDS = [
  { key: 'name', label: '가게 이름', placeholder: '초록다육' },
  { key: 'bank', label: '은행', placeholder: '농협' },
  { key: 'accountNumber', label: '계좌번호', placeholder: '302-9988-7766-11' },
  { key: 'accountHolder', label: '예금주', placeholder: '김판매' },
  { key: 'accountNote', label: '입금 안내 문장', placeholder: '입금자명은 닉네임으로 적어 주세요' },
] as const satisfies readonly { readonly key: keyof Shop; readonly label: string; readonly placeholder: string }[]

/** 확인서에 나올 입금 계좌 (문서 패키지와 같은 모양: "은행 계좌번호 (예금주 이름)") — 셋 다 있을 때만 */
export function accountPreview(shop: Shop): { readonly text: string; readonly note: string | null } | 'none' | 'partial' {
  const bank = shop.bank.trim()
  const number = shop.accountNumber.trim()
  const holder = shop.accountHolder.trim()
  const filled = [bank, number, holder].filter((value) => value !== '').length
  if (filled === 0) return 'none'
  if (filled < 3) return 'partial'
  const note = shop.accountNote.trim()
  return { text: `${bank} ${number} (예금주 ${holder})`, note: note === '' ? null : note }
}

/** 자동 백업이 멈췄는가: 꺼져 있거나, 성공이 없거나, 마지막 성공이 26시간보다 오래됐다 */
export function backupStopped(status: Pick<BackupStatus, 'enabled' | 'lastSuccessAt'>, now: number = Date.now()): boolean {
  if (!status.enabled || status.lastSuccessAt === null) return true
  const at = Date.parse(status.lastSuccessAt)
  return !Number.isFinite(at) || now - at > BACKUP_STALE_MS
}

export function SettingsPage({ onShopName }: { readonly onShopName: (name: string) => void }) {
  return (
    <main className="page settings-page stack">
      <h1>설정</h1>
      <ShopSection onShopName={onShopName} />
      <BackupSection />
      <ExportSection />
    </main>
  )
}

function ShopSection({ onShopName }: { readonly onShopName: (name: string) => void }) {
  const id = useId()
  const [shop, setShop] = useState<Shop | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    get<{ shop: Shop }>('/api/shop').then(
      (result) => {
        if (alive) setShop(result.shop)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const change = (key: keyof Shop, value: string) => {
    setSaved(false)
    setShop((current) => (current === null ? current : { ...current, [key]: value }))
  }

  const save = async () => {
    if (shop === null || saving) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await put<{ shop: Shop }>('/api/shop', shop)
      setShop(result.shop)
      setSaved(true)
      onShopName(result.shop.name)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setSaving(false)
    }
  }

  const preview = shop === null ? null : accountPreview(shop)
  const fieldKeys: readonly string[] = FIELDS.map((field) => field.key)

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        가게
      </h2>
      {loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      {shop === null && loadError === null ? <p role="status">불러오는 중…</p> : null}
      {shop !== null ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {FIELDS.map((field) => {
            const problem = error?.problemFor(field.key)
            return (
              <div key={field.key} className="field">
                <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
                <input
                  id={`${id}-${field.key}`}
                  className="input"
                  autoComplete="off"
                  inputMode={field.key === 'accountNumber' ? 'numeric' : undefined}
                  placeholder={field.placeholder}
                  value={shop[field.key]}
                  aria-invalid={problem !== undefined}
                  aria-describedby={problem === undefined ? undefined : `${id}-${field.key}-error`}
                  onChange={(event) => change(field.key, event.target.value)}
                />
                {problem !== undefined ? (
                  <p className="field-error" role="alert" id={`${id}-${field.key}-error`}>
                    {problem.message}
                  </p>
                ) : null}
              </div>
            )
          })}
          <section className="receipt-account stack-tight" aria-label="확인서에 나올 모양">
            <h3 className="sub-title">확인서에 나올 모양</h3>
            {preview === 'none' ? <p>{NO_ACCOUNT_ON_RECEIPT}</p> : null}
            {preview === 'partial' ? (
              <p className="warning" data-tone="warning">
                {ACCOUNT_INCOMPLETE}
              </p>
            ) : null}
            {preview !== null && typeof preview === 'object' ? (
              <div className="quote">
                <p>{preview.text}</p>
                {preview.note !== null ? <p>{preview.note}</p> : null}
              </div>
            ) : null}
          </section>
          <div className="row">
            <button type="submit" className="button button-primary" disabled={saving}>
              저장
            </button>
            {saving ? <span role="status">저장하는 중…</span> : null}
          </div>
          {saved ? (
            <p className="notice" role="status" data-tone="success">
              {SAVED}
            </p>
          ) : null}
          {error !== null ? <RequestError error={error} omitFields={fieldKeys} /> : null}
        </form>
      ) : null}
    </section>
  )
}

function BackupSection() {
  const id = useId()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    get<BackupStatus>('/api/backups').then(
      (result) => {
        if (alive) setStatus(result)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <section className="card stack-tight" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        백업
      </h2>
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      {status === null && error === null ? <p role="status">불러오는 중…</p> : null}
      {status !== null ? (
        <>
          {backupStopped(status) ? (
            <p className="notice" role="alert" data-tone="warning">
              {BACKUP_STOPPED}
            </p>
          ) : null}
          <p>마지막 자동 백업: {status.lastSuccessAt === null ? '없음' : kstDateTimeLong(status.lastSuccessAt)}</p>
          <p>백업은 {String(status.retentionDays)}일 동안 보관해요.</p>
          {status.backups.length > 0 ? (
            <ul className="plain-list backup-list" aria-label="보관 중인 백업">
              {status.backups.map((backup) => (
                <li key={backup.createdAt}>
                  {kstDateTimeLong(backup.createdAt)} · {sizeWords(backup.size)}
                </li>
              ))}
            </ul>
          ) : (
            <p>보관 중인 백업이 없어요.</p>
          )}
          <p className="hint">{RESTORE_HINT}</p>
        </>
      ) : null}
    </section>
  )
}

function ExportSection() {
  const id = useId()
  return (
    <section className="card stack-tight" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        전체 기록 내려받기
      </h2>
      <p className="warning" data-tone="warning">
        {EXPORT_WARNING}
      </p>
      <div className="stack-tight">
        <DownloadButton label="전체 기록(JSON)" busyText="만드는 중이에요…" path="/api/export/records.json.gz" fallbackName="livejjim-records.json.gz" />
        <DownloadButton label="전체 판매대장(엑셀)" busyText="만드는 중이에요…" path="/api/export/ledger.xlsx" fallbackName="livejjim-ledger.xlsx" />
      </div>
    </section>
  )
}

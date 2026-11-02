// 가게·백업·전체 기록 칸 낱말과 미리 보기 (I2 AC-I2-02·65·66) — React 없이 쓰는 조각(앱 가게 설정 화면도 같이 쓴다, D-APPX-03).
import type { BackupStatus, Shop } from '../api/types.ts'

export const SHOP_SAVED = '저장했어요.'
/** 가게 칸 저장 성공 (I2 이름 — SHOP_SAVED와 같은 글) */
export const SAVED = SHOP_SAVED
export const NO_ACCOUNT_ON_RECEIPT = '확인서에 입금 계좌가 나오지 않아요.'
/** 계좌 칸을 일부만 적었을 때 미리 보기 (서버 거절 문장과 다른 글 — 같은 글이 두 번 보이지 않게) */
export const ACCOUNT_INCOMPLETE = '은행·계좌번호·예금주가 모두 있어야 확인서에 계좌가 나와요.'
export const BACKUP_STOPPED = '자동 백업이 멈췄어요. 운영자에게 알려 주세요.'
export const RESTORE_HINT = '백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.'
export const EXPORT_WARNING = '구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.'
/** 마지막 자동 백업이 이보다 오래되면 멈춘 것으로 본다 (AC-I2-65) */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000

export const SHOP_FIELDS = [
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

/** 파일 크기 "1.2MB" · "3.4KB" (설정 화면의 백업 목록) */
export function sizeWords(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  const mb = 1024 * 1024
  if (bytes >= mb) return `${(Math.round((bytes / mb) * 10) / 10).toFixed(1)}MB`
  const kb = Math.max(Math.round((bytes / 1024) * 10) / 10, 0.1)
  return `${kb.toFixed(1)}KB`
}

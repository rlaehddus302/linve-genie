// 30일 봉인 예고·봉인 안내 (DAT-06, D-Y11, D-I3-07, AC-I3-40·41). 봉인 예정 시각(sealAt)은 유튜브 채팅이 있는 실제 날짜에만 있다.
// 봉인 7일 전부터는 경고 상자(글자로 — 색만이 아님). 봉인한 날짜는 "볼 수만 있어요".
import { kstHourWords } from '../lib/kst.ts'
import { SEALED_READ_ONLY, SEAL_WARNING, sealSoon } from '../lib/youtube.ts'

export function sealAtWords(sealAt: string): string {
  return `이 날짜 기록은 ${kstHourWords(sealAt)}부터 잠겨요. 그 뒤로는 고칠 수 없어요.`
}

/** 봉인 예정 (봉인 시각이 없으면 아무것도 없다) */
export function SealNotice({ sealAt, sealed = false }: { readonly sealAt: string | null | undefined; readonly sealed?: boolean }) {
  if (sealed) return <SealedNotice />
  if (sealAt === null || sealAt === undefined || sealAt === '') return null
  return (
    <div className="seal-notice stack-tight">
      <p className="seal-at">{sealAtWords(sealAt)}</p>
      {sealSoon(sealAt) ? (
        <p className="warning" role="note">
          {SEAL_WARNING}
        </p>
      ) : null}
    </div>
  )
}

/** 봉인한 날짜 (쓰기 버튼은 잠긴다) */
export function SealedNotice() {
  return (
    <p className="warning sealed-notice" role="note">
      {SEALED_READ_ONLY}
    </p>
  )
}

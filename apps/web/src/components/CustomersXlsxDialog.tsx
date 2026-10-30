// "모든 손님"의 [엑셀로 받기] (KP1 CR-6, AC-KP1-12·13): 창 하나 — 처음엔 빈 "연락처·주소도 넣기", 고르면 경고 한 줄.
// 파일은 서버가 만든다(`GET /api/customers.xlsx?contact=0|1`) — 받은 바이트를 그 이름으로 저장만 한다. 받을 때마다 서버가 누가·언제·연락처 포함 여부를 남긴다.
import { useId, useState } from 'react'
import { XLSX_BUSY, XLSX_BUTTON, XLSX_CONTACT_LABEL, XLSX_CONTACT_WARNING, XLSX_HELP, XLSX_TITLE, customersXlsxPath } from '../lib/ledger.ts'
import { kstToday } from '../lib/kst.ts'
import { useDownload } from './downloads.tsx'
import { RequestError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

/** 받는 날 이름 (응답에 이름이 없을 때만 — 보통은 서버 이름 `손님-YYYY-MM-DD.xlsx`) */
export const xlsxFallbackName = (): string => `손님-${kstToday()}.xlsx`

export function CustomersXlsxButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="button button-tall" onClick={() => setOpen(true)}>
        {XLSX_BUTTON}
      </button>
      {open ? <CustomersXlsxDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function CustomersXlsxDialog({ onClose }: { readonly onClose: () => void }) {
  const id = useId()
  // 처음엔 늘 비어 있다 (지난번 고른 것을 기억하지 않는다 — CR-6)
  const [contact, setContact] = useState(false)
  const download = useDownload()
  return (
    <Modal
      title={XLSX_TITLE}
      onClose={onClose}
      closeDisabled={download.busy}
      actions={
        <button type="button" className="button button-primary button-tall" disabled={download.busy} onClick={() => void download.run(customersXlsxPath(contact), xlsxFallbackName())}>
          {download.busy ? XLSX_BUSY : '받기'}
        </button>
      }
    >
      <p>{XLSX_HELP}</p>
      <label className="choice ledger-choice">
        <input type="checkbox" checked={contact} aria-describedby={contact ? `${id}-warning` : undefined} onChange={(event) => setContact(event.target.checked)} />
        <span>{XLSX_CONTACT_LABEL}</span>
      </label>
      {contact ? (
        <p className="notice" role="note" data-tone="warning" id={`${id}-warning`}>
          {XLSX_CONTACT_WARNING}
        </p>
      ) : null}
      {download.busy ? <p role="status">{XLSX_BUSY}</p> : null}
      {download.error !== null ? <RequestError error={download.error} /> : null}
    </Modal>
  )
}

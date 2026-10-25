// AC-V3-71 판매대장 .xlsx "음성 기록" 시트 (R-25, D-V3-65): 열·값·글 칸·기존 시트 그대로.
import { describe, expect, it } from 'vitest'
import { LEDGER_COLUMNS, VOICE_LEDGER_COLUMNS, ledgerToXlsx, voiceLedgerRowValues, type VoiceLedgerRow } from '../src/index.ts'
import { readXlsx } from './helpers.ts'

const T = Date.UTC(2026, 9, 25, 11, 5, 0) // 한국 20:05
const rows: VoiceLedgerRow[] = [
  { at: T, no: 62, action: 'PRICE', before: 100000, after: 20000, source: 'voice', claims: 2, heard: '자 62번 2만 원 끝자리 ****', marks: ['BIG_CHANGE', 'WITH_CLAIMS'] },
  { at: T + 1000, no: 93, action: 'NAME', before: null, after: '청개구리', source: 'seller-note', claims: 0, heard: '93번🍀[청개구리] ₩70,000', marks: [] },
  { at: T + 2000, no: 65, toNo: 61, action: 'RENUMBER', before: 65, after: 61, source: 'voice', claims: 0, heard: '=아까 65번은 61번이야', marks: [] },
]

describe('AC-V3-71 음성 기록 시트', () => {
  it('음성 기록을 넘기면 "판매대장" 다음에 "음성 기록" 시트, 열 9개, 기존 시트·열은 그대로', async () => {
    const sheets = await readXlsx(await ledgerToXlsx([], false, { voiceLog: rows }))
    expect(sheets.map((sheet) => sheet.name)).toEqual(['판매대장', '음성 기록'])
    expect(sheets[0]?.rows[0]?.map((cell) => cell.value)).toEqual([...LEDGER_COLUMNS])
    const voice = sheets[1]
    expect(voice?.rows[0]?.map((cell) => cell.value)).toEqual(['시각', '번호', '한 일', '전', '후', '출처', '찜 수', '들은 말', '표시'])
    expect(VOICE_LEDGER_COLUMNS).toHaveLength(9)
    expect(voice?.rows.slice(1).map((cells) => cells.map((cell) => (cell.value === null ? '' : cell.value)))).toEqual(rows.map(voiceLedgerRowValues))
    expect(voice?.views).toEqual([expect.objectContaining({ state: 'frozen', ySplit: 1 })])
  })
  it('값: 한 일·출처·표시는 쉬운 말, 가격은 수 칸(#,##0), 들은 말은 글 칸(=로 시작해도 수식 아님)', async () => {
    expect(voiceLedgerRowValues(rows[0] as VoiceLedgerRow)).toEqual(['2026-10-25 20:05:00', 62, '가격 고침', 100000, 20000, '음성', 2, '자 62번 2만 원 끝자리 ****', '크게 바뀜, 찜 있을 때 고침'])
    expect(voiceLedgerRowValues(rows[2] as VoiceLedgerRow).slice(1, 3)).toEqual(['65 → 61', '번호 옮기기'])
    const voice = (await readXlsx(await ledgerToXlsx([], false, { voiceLog: rows })))[1]
    const first = voice?.rows[1] ?? []
    expect(first[3]).toMatchObject({ type: 'Number', numFmt: '#,##0' })
    expect(first[6]?.type).toBe('Number')
    expect(first[7]?.type).toBe('String')
    const third = voice?.rows[3] ?? []
    expect(third[7]).toMatchObject({ type: 'String', value: '=아까 65번은 61번이야' })
  })
  it('음성 기록을 넘기지 않으면 지금처럼 시트 하나', async () => {
    expect((await readXlsx(await ledgerToXlsx([]))).map((sheet) => sheet.name)).toEqual(['판매대장'])
  })
})

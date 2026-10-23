// TD-T1-001 · D-T1-16·17: 보내는 사람 이름 1~30자(가게 이름 상한과 같음), 칸 코드는 받는 분과 같고 sender.<칸> 문장만 보내는 사람 줄(PC-2 6).
import { describe, expect, it } from 'vitest'
import { ADDRESS_ERROR_MESSAGES, SENDER_ERROR_MESSAGES, SENDER_FIELDS, readSender, senderProblems } from '../src/parcel/rules.ts'
import { ADDRESS, D, SENDER, bookOk, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, sell } from './t1-support.ts'

const NAME_30 = '초록다육 다육이 전문 농장 직영 라이브 판매점 본점이다'

type Problem = { field: string; message: string }
const problemsOf = (body: Record<string, unknown>): Problem[] => (body.error as { problems: Problem[] }).problems

describe('보내는 사람 칸 문장 (PC-2 6, D-T1-17)', () => {
  it('이름·전화번호 네 코드는 보내는 사람 문장, 주소·상세·우편번호는 받는 분과 같은 문장', () => {
    expect(SENDER_ERROR_MESSAGES).toEqual({
      NAME_EMPTY: '보내는 사람 이름을 적어 주세요.',
      NAME_TOO_LONG: '보내는 사람 이름은 30자까지 적어 주세요.',
      PHONE_EMPTY: '전화번호를 적어 주세요.',
      PHONE_INVALID: '전화번호를 숫자로 적어 주세요. 예: 010-1234-5678, 031-123-4567',
      ADDRESS_EMPTY: '주소를 적어 주세요.',
      ADDRESS_TOO_LONG: '주소는 100자까지 적어 주세요.',
      DETAIL_TOO_LONG: '상세 주소는 100자까지 적어 주세요.',
      ZIP_INVALID: '우편번호는 숫자 5자리로 적어 주세요. 모르면 비워 두세요.',
    })
    // 받는 분 문장은 그대로
    expect(ADDRESS_ERROR_MESSAGES.NAME_TOO_LONG).toBe('받는 분은 20자까지 적어 주세요.')
    expect(ADDRESS_ERROR_MESSAGES.PHONE_INVALID).toBe('연락처는 010으로 시작하는 숫자로 적어 주세요.')
    expect(senderProblems(['NAME_TOO_LONG', 'PHONE_INVALID', 'ZIP_INVALID'])).toEqual([
      { field: 'sender.name', message: '보내는 사람 이름은 30자까지 적어 주세요.' },
      { field: 'sender.phone', message: '전화번호를 숫자로 적어 주세요. 예: 010-1234-5678, 031-123-4567' },
      { field: 'sender.zip', message: '우편번호는 숫자 5자리로 적어 주세요. 모르면 비워 두세요.' },
    ])
  })

  it('readSender: 칸마다 하나, 칸 순서대로 — 이름이 길고 다른 칸도 틀리면 이름이 먼저', () => {
    expect(SENDER_FIELDS).toEqual(['name', 'phone', 'address', 'detail', 'zip'])
    expect(readSender({ name: `${NAME_30}요`, phone: 'abc', address: '', detail: 'x'.repeat(101), zip: '12' })).toEqual({
      errors: ['NAME_TOO_LONG', 'PHONE_INVALID', 'ADDRESS_EMPTY', 'DETAIL_TOO_LONG', 'ZIP_INVALID'],
    })
    expect(readSender({ name: ' ', phone: '', address: '서울', detail: '', zip: '' })).toEqual({ errors: ['NAME_EMPTY', 'PHONE_EMPTY'] })
    // 이름 상한만 다르다: 30자 이름도 다른 칸이 틀리면 그 칸만
    expect(readSender({ name: NAME_30, phone: '010', address: '서울', detail: '', zip: '' })).toEqual({ errors: ['PHONE_INVALID'] })
  })
})

describe('설정 "택배" 보내는 사람 (AC-T1-23, D-T1-16·17)', () => {
  it('이름 30자는 저장되고 그대로 읽히며 택배사에도 자르지 않고 간다, 31자는 sender.name에 보내는 사람 문장', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    const api = parcelApi(world, seller.cookie)
    const saved = await expect200(api.putSettings({ sender: { ...SENDER, name: NAME_30 } }))
    expect(saved.body.settings).toMatchObject({ sender: { ...SENDER, name: NAME_30, phone: '0311234567' } })
    expect((await expect200(api.settings())).body.settings).toMatchObject({ sender: { name: NAME_30 } })

    const long = await api.putSettings({ sender: { ...SENDER, name: `${NAME_30}요` } })
    expect(long.status).toBe(400)
    expect(long.body.codes).toEqual(['NAME_TOO_LONG'])
    expect(problemsOf(long.body)).toEqual([{ field: 'sender.name', message: '보내는 사람 이름은 30자까지 적어 주세요.' }])
    // 틀리면 저장하지 않는다
    expect((await expect200(api.settings())).body.settings).toMatchObject({ sender: { name: NAME_30 } })

    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    expect((await bookOk(world, seller, [{ buyer: 'UC_A' }]))[0]).toMatchObject({ ok: true })
    const body = world.carrier.requests.find((item) => item.op === 'book')?.body as { sender: { name: string } }
    expect(body.sender.name).toBe(NAME_30)
  })

  it('비거나 틀린 칸은 sender.<칸>에 보내는 사람 문장, 받는 분 배송지는 받는 분 문장 그대로', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    const api = parcelApi(world, seller.cookie)
    const empty = await api.putSettings({ sender: { name: '', phone: '', address: '', detail: '', zip: '' } })
    expect(empty.status).toBe(400)
    expect(empty.body.codes).toEqual(['NAME_EMPTY', 'PHONE_EMPTY', 'ADDRESS_EMPTY'])
    expect(problemsOf(empty.body)).toEqual([
      { field: 'sender.name', message: '보내는 사람 이름을 적어 주세요.' },
      { field: 'sender.phone', message: '전화번호를 적어 주세요.' },
      { field: 'sender.address', message: '주소를 적어 주세요.' },
    ])
    const phone = await api.putSettings({ sender: { ...SENDER, phone: '031-123-456-78-9' } })
    expect(problemsOf(phone.body)).toEqual([{ field: 'sender.phone', message: '전화번호를 숫자로 적어 주세요. 예: 010-1234-5678, 031-123-4567' }])

    await sell(world, seller, [['UC_A', '가람', 1]])
    const receiver = await api.putAddress('UC_A', { ...ADDRESS, name: '가'.repeat(21), phone: 'abc' }, D)
    expect(receiver.status).toBe(400)
    expect(problemsOf(receiver.body)).toEqual([
      { field: 'address.name', message: '받는 분은 20자까지 적어 주세요.' },
      { field: 'address.phone', message: '연락처는 010으로 시작하는 숫자로 적어 주세요.' },
    ])
  })
})

// JSON 끌어오기 읽개 (RA-I2-005 — 백업 파일을 글 하나로 만들지 않고 조각으로 읽는다): 조각을 어디서 잘라도 같은 값, 잘못된 JSON·상한을 넘는 값은 쉬운 문장
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { JsonPullReader, JsonStreamError } from '../src/json-stream.ts'

async function* chunks(text: string, cuts: readonly number[]): AsyncGenerator<string> {
  let start = 0
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    if (cut <= start || cut >= text.length) continue
    yield text.slice(start, cut)
    start = cut
  }
  yield text.slice(start)
}

/** [값, 값, …] 배열을 원소마다 읽는다 */
async function readArray(text: string, cuts: readonly number[]): Promise<unknown[]> {
  const reader = new JsonPullReader(chunks(text, cuts))
  const out: unknown[] = []
  await reader.expect('[')
  if (!(await reader.take(']'))) {
    do out.push(await reader.readValue())
    while (await reader.take(','))
    await reader.expect(']')
  }
  await reader.end()
  return out
}

describe('JsonPullReader', () => {
  it('조각을 어디서 잘라도 원소마다 JSON.parse와 같은 값 (문자열 안의 괄호·따옴표·역슬래시·서로게이트 포함)', async () => {
    const value = fc.jsonValue({ maxDepth: 3 })
    await fc.assert(
      fc.asyncProperty(fc.array(value, { maxLength: 8 }), fc.array(fc.nat({ max: 400 }), { maxLength: 12 }), fc.boolean(), async (list, cuts, pretty) => {
        const text = pretty ? JSON.stringify(list, null, 2) : JSON.stringify(list)
        expect(await readArray(text, cuts)).toEqual(JSON.parse(text))
      }),
      { numRuns: 400 },
    )
    expect(await readArray('["{[\\"]}", "\\\\", "🌵", "a\\u0000b", 1e3, -0.5, true, null, {"k":[1,{"x":"}"}]}]', [3, 4, 9, 15, 22, 23, 40])).toEqual(['{["]}', '\\', '🌵', 'a\u0000b', 1000, -0.5, true, null, { k: [1, { x: '}' }] }])
  })

  it('객체 키·차례 읽기와 문서 끝', async () => {
    const reader = new JsonPullReader(chunks('{ "a" : 1 , "b":{"c":[1,2]} }  ', [2, 7, 12]))
    await reader.expect('{')
    expect(await reader.readKey()).toBe('a')
    expect(await reader.readValue()).toBe(1)
    expect(await reader.take(',')).toBe(true)
    expect(await reader.readKey()).toBe('b')
    expect(await reader.readValue()).toEqual({ c: [1, 2] })
    expect(await reader.take(',')).toBe(false)
    await reader.expect('}')
    await reader.end()
  })

  it('잘못된 JSON·끝나지 않은 글·뒤에 남은 글·상한을 넘는 값 → JsonStreamError(쉬운 문장)', async () => {
    const fails = async (text: string, max?: number) => {
      const reader = new JsonPullReader(chunks(text, [1, 2, 5]))
      const run = async () => {
        await reader.expect('[')
        await reader.readValue(max)
        await reader.expect(']')
        await reader.end()
      }
      await expect(run()).rejects.toBeInstanceOf(JsonStreamError)
    }
    await fails('[{"a":1]')
    await fails('[{"a":1}')
    await fails('[tru]')
    await fails('[1] x')
    await fails('["abc')
    await fails('[]')
    await fails(`["${'x'.repeat(100)}"]`, 50)
    await expect(new JsonPullReader(chunks('[1]', [])).readKey()).rejects.toThrow('백업 파일의 내용을 읽지 못했어요(JSON이 아니에요).')
  })

  it('상한은 값 하나의 길이다 — 작은 값이 많은 긴 배열은 상한과 상관없이 끝까지 읽는다', async () => {
    const list = Array.from({ length: 20_000 }, (_, i) => ({ seq: i + 1, body: `{"text":"${'가'.repeat(20)}"}` }))
    const text = JSON.stringify(list)
    const reader = new JsonPullReader(chunks(text, Array.from({ length: 300 }, (_, i) => i * 4099 + 7)))
    await reader.expect('[')
    let n = 0
    do {
      const item = (await reader.readValue(200)) as { seq: number }
      n++
      expect(item.seq).toBe(n)
    } while (await reader.take(','))
    await reader.expect(']')
    await reader.end()
    expect(n).toBe(20_000)
    expect(text.length).toBeGreaterThan(200 * 1000)
  })
})

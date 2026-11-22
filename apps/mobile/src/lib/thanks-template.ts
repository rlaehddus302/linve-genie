// 찜 감사 채팅 양식 (D-THANKS-FMT-01): 서버 판매자 설정(GET·PUT /api/settings/thanks-template)과 화면에 보일 예시 양식.
// 블록·검사·글 만들기는 코어(format.ts) 하나를 같이 쓴다 — 서버가 올리는 글과 화면 미리 보기가 글자까지 같다.
import { DEFAULT_THANKS_TEMPLATE, renderThanks, sameThanksTemplate, type ThanksBlock, type ThanksTemplate } from '@livejjim/core/format'
import { isApiError, put } from '../api/client.ts'
import { rememberCached } from './cached-get.ts'

export const THANKS_TEMPLATE_PATH = '/api/settings/thanks-template'
/** 라이브 관리 줄 이름·양식 화면 제목 */
export const THANKS_TEMPLATE_TITLE = '찜 감사 채팅 양식'
/** 직접 만들기 줄·블록 화면 제목 */
export const THANKS_CUSTOM_TITLE = '직접 만들기'
export const THANKS_TEMPLATE_HELP = '찜이 확정되면 이 모양으로 채팅에 올라가요.'

/** 미리 보기에 넣는 예시 값 (지어낸 이름) */
export const THANKS_SAMPLE_VALUES = { no: 15, name: '핑크프릴', price: 10_000, buyerName: '홍길동' } as const

export interface ThanksSample {
  readonly id: string
  readonly name: string
  readonly blocks: ThanksTemplate
}

/** 한 줄에 하나씩 보이는 예시 양식 (맨 아래에 "직접 만들기") */
export const THANKS_SAMPLES: readonly ThanksSample[] = [
  { id: 'basic', name: '기본', blocks: DEFAULT_THANKS_TEMPLATE },
  { id: 'nick-first', name: '닉네임 먼저', blocks: [{ k: 'buyer' }, { k: 'no' }, { k: 'name' }, { k: 'price' }, { k: 'text', t: '찜 확정이에요' }] },
  { id: 'no-price', name: '가격 빼고', blocks: [{ k: 'no' }, { k: 'name' }, { k: 'buyer' }, { k: 'text', t: '감사합니다' }] },
  { id: 'cheer', name: '축하', blocks: [{ k: 'text', t: '축하해요!' }, { k: 'buyer' }, { k: 'no' }, { k: 'name' }, { k: 'text', t: '찜 성공' }] },
  { id: 'short', name: '짧게', blocks: [{ k: 'no' }, { k: 'buyer' }, { k: 'text', t: '감사해요' }] },
]

/** 예시 값으로 만든 미리 보기 글 */
export function thanksPreview(blocks: ThanksTemplate): string {
  return renderThanks(blocks, THANKS_SAMPLE_VALUES)
}

/** 이 양식과 같은 예시 (없으면 직접 만든 양식) */
export function sampleOf(blocks: ThanksTemplate): ThanksSample | null {
  return THANKS_SAMPLES.find((sample) => sameThanksTemplate(sample.blocks, blocks)) ?? null
}

/** 라이브 관리 줄 오른쪽 글 */
export function thanksTemplateLabel(blocks: ThanksTemplate | null): string | undefined {
  if (blocks === null) return undefined
  return sampleOf(blocks)?.name ?? THANKS_CUSTOM_TITLE
}

/** 서버 응답 → 양식 (모양이 다르면 null) */
export function readThanksTemplate(body: unknown): ThanksTemplate | null {
  if (typeof body !== 'object' || body === null) return null
  const blocks = (body as { blocks?: unknown }).blocks
  return Array.isArray(blocks) ? (blocks as ThanksBlock[]) : null
}

/** 저장 — 저장한 양식을 화면 자료 기억에도 남긴다(관리 줄이 바로 바뀌게). 못 하면 쉬운 문장을 던진다 */
export async function saveThanksTemplate(blocks: ThanksTemplate): Promise<ThanksTemplate> {
  try {
    const body = await put<{ blocks: ThanksTemplate }>(THANKS_TEMPLATE_PATH, { blocks })
    const saved = readThanksTemplate(body) ?? blocks
    rememberCached(THANKS_TEMPLATE_PATH, { blocks: saved })
    return saved
  } catch (caught) {
    throw new Error(isApiError(caught) ? caught.message : '저장하지 못했어요. 다시 눌러 주세요.', { cause: caught })
  }
}

/** 블록 하나를 from 자리에서 to 자리로 옮긴다 (꾹 눌러 끌기) */
export function moveBlock<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item as T)
  return next
}

// 출력 화면 시험 도우미: 서버 출력 계약 모양(harness/sprints/I1/dev-notes.md "dev-server > 바뀐 계약")의 값 만들기.
import { defaultTemplate } from '@livejjim/label'
import type { JobView, LabelView, PrintOverview, QueueSummary, Templates } from '../src/api/print-types.ts'
import { DATE } from './support.ts'

export function queue(patch: Partial<QueueSummary> = {}): QueueSummary {
  return { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, ...patch }
}

export function device(id: string, patch: Partial<NonNullable<QueueSummary['device']>> = {}): NonNullable<QueueSummary['device']> {
  return { id, name: 'PC', live: true, printerConnected: true, releasing: false, ...patch }
}

export function job(id: string, patch: Partial<JobView> = {}): JobView {
  return {
    id,
    date: DATE,
    kind: 'product',
    reason: 'auto',
    status: 'WAITING',
    word: '작업 대기',
    voided: false,
    discard: false,
    discardedAt: null,
    attempts: 0,
    lastError: null,
    label: { key: `c-${id}@1`, claim: `c-${id}`, version: 1, broadcast: 'b1', no: 15, buyerId: null, buyer: { kind: 'youtube', name: '우주천사' } },
    page: null,
    pages: null,
    data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
    device: null,
    printedAt: null,
    createdAt: '2026-10-19T11:00:00.000Z',
    ...patch,
  }
}

export function labelView(key: string, patch: Partial<LabelView> = {}): LabelView {
  const [claim, version] = key.split('@')
  return {
    key,
    claim: claim ?? null,
    version: Number(version ?? '1'),
    broadcast: 'b1',
    no: 15,
    buyerId: null,
    buyer: { kind: 'youtube', name: '우주천사' },
    date: DATE,
    kind: 'product',
    state: 'NONE',
    word: '',
    voided: false,
    discard: 0,
    reprintNeeded: false,
    printed: 0,
    history: [],
    winner: true,
    data: { no: 15, name: '핑크프릴', price: 10000, date: DATE, buyer: { kind: 'youtube', name: '우주천사' } },
    canPrint: true,
    canReprint: false,
    ...patch,
  }
}

export function overview(patch: Partial<PrintOverview> = {}): PrintOverview {
  return { queue: queue(), jobs: [], discard: [], ...patch }
}

export function templates(): Templates {
  return { product: { template: defaultTemplate('product'), version: 0 }, packing: { template: defaultTemplate('packing'), version: 0 } }
}

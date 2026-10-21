// 작업 풀 시험용 워커 (i2-work.test.ts — work-pool.ts의 시간·메모리 상한·줄·끊김·조각을 실제 워커 스레드로 확인한다). work-worker.ts와 같은 주고받기 모양이다.
import { parentPort, threadId } from 'node:worker_threads'

interface Request {
  readonly id: number
  readonly kind?: string
  readonly input?: unknown
  readonly streamed?: boolean
  readonly chunk?: unknown
  readonly end?: boolean
}

const port = parentPort
if (port === null) throw new Error('워커로만 띄운다')

const pending = new Map<number, { kind: string; input: unknown; chunks: unknown[] }>()
const kept: unknown[] = []

function spin(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // 바쁘게 돈다 (CPU를 쓰는 작업 흉내)
  }
}

function handle(id: number, kind: string, input: unknown, chunks: readonly unknown[]): void {
  switch (kind) {
    case 'echo':
      port?.postMessage({ id, ok: true, value: { threadId, input } })
      return
    case 'spin':
      spin(input as number)
      port?.postMessage({ id, ok: true, value: threadId })
      return
    case 'sum':
      port?.postMessage({ id, ok: true, value: (chunks as number[]).reduce((a, b) => a + b, 0) })
      return
    case 'boom':
      port?.postMessage({ id, ok: false })
      return
    case 'oom':
      // 힙 상한을 넘을 때까지 잡아 둔다 (워커만 죽어야 한다)
      for (;;) kept.push(new Array(1_000_000).fill(kept.length))
    default:
      port?.postMessage({ id, ok: false })
  }
}

port.on('message', (message: Request) => {
  if (message.kind !== undefined) {
    if (message.streamed === true) pending.set(message.id, { kind: message.kind, input: message.input, chunks: [] })
    else handle(message.id, message.kind, message.input, [])
    return
  }
  const job = pending.get(message.id)
  if (job === undefined) return
  if (message.end === true) {
    pending.delete(message.id)
    handle(message.id, job.kind, job.input, job.chunks)
  } else job.chunks.push(message.chunk)
})

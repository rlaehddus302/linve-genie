// LV1 연습·시험용 모의 받아쓰기 일꾼 (D-LV1-09). 실제 일꾼과 같은 약속(hello·open·close·result, 4바이트 흐름 번호 + PCM16)으로 중계에 먼저 잇는다.
// 정해진 표지 소리(markerChunk)만 알아듣고 "15번 핑크프릴 이만 원"을 돌려준다 — 진짜 마이크 소리에는 아무 글도 돌려주지 않는다. 소리·글은 저장하지 않는다.
import { WebSocket } from 'ws'
import { MARKER_CHUNKS, PRACTICE_SPEECH, STREAM_CHUNK_BYTES, markerChunk } from './stream-audio.ts'

const MARKERS = Array.from({ length: MARKER_CHUNKS }, (_, i) => markerChunk(i))
const CHUNK_MS = 100

export interface MockWorker { close(): void; readonly connected: () => boolean }

export function startMockWorker(options: { url: string; token: string; text?: string; maxStreams?: number }): MockWorker {
  const text = options.text ?? PRACTICE_SPEECH
  let ws: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | null = null
  const streams = new Map<number, { bytes: number; matched: number; startMs: number; rest: Buffer }>()
  const connect = () => {
    if (closed) return
    const socket = new WebSocket(options.url, { headers: { Authorization: `Bearer ${options.token}` } })
    ws = socket
    socket.on('error', () => {})
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', maxStreams: options.maxStreams ?? 1 })))
    socket.on('close', () => {
      streams.clear()
      if (!closed) { retry = setTimeout(connect, 1_000); retry.unref?.() }
    })
    socket.on('message', (data, binary) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (!binary) {
        try {
          const value = JSON.parse(bytes.toString('utf8')) as { type?: string; stream?: number }
          if (value.type === 'open' && typeof value.stream === 'number') streams.set(value.stream, { bytes: 0, matched: 0, startMs: 0, rest: Buffer.alloc(0) })
          if (value.type === 'close' && typeof value.stream === 'number') streams.delete(value.stream)
        } catch { /* 모르는 글은 버린다 */ }
        return
      }
      if (bytes.length < 4) return
      const id = bytes.readUInt32BE(0)
      const flow = streams.get(id)
      if (flow === undefined) return
      let buffer = Buffer.concat([flow.rest, bytes.subarray(4)])
      while (buffer.length >= STREAM_CHUNK_BYTES) {
        const chunk = buffer.subarray(0, STREAM_CHUNK_BYTES)
        buffer = buffer.subarray(STREAM_CHUNK_BYTES)
        const at = (flow.bytes / STREAM_CHUNK_BYTES) * CHUNK_MS
        flow.bytes += STREAM_CHUNK_BYTES
        if (chunk.equals(MARKERS[flow.matched]!)) {
          if (flow.matched === 0) flow.startMs = at
          flow.matched++
          if (flow.matched === MARKER_CHUNKS) {
            flow.matched = 0
            socket.send(JSON.stringify({ type: 'result', stream: id, text, startMs: flow.startMs, endMs: at + CHUNK_MS, procMs: 50 }))
          }
        } else {
          flow.matched = chunk.equals(MARKERS[0]!) ? 1 : 0
          if (flow.matched === 1) flow.startMs = at
        }
      }
      flow.rest = Buffer.from(buffer)
    })
  }
  connect()
  return {
    connected: () => ws?.readyState === WebSocket.OPEN,
    close: () => { closed = true; if (retry !== null) clearTimeout(retry); ws?.terminate() },
  }
}

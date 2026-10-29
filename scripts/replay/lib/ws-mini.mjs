// 재생 측정용 아주 작은 웹소켓 서버 (RFC 6455의 필요한 만큼: 업그레이드·글/이진 틀·핑/퐁·닫기). 127.0.0.1에서만 연다.
// 측정 도구 전용이다 — 라이브지니 서버의 웹소켓(apps/server)과 상관없다. 새 의존성을 들이지 않으려고 직접 쓴다.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 연결 하나 */
class Peer {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.fragments = null
    this.closed = false
    this.onText = () => {}
    this.onBinary = () => {}
    this.onClose = () => {}
    socket.on('data', (data) => this.read(data))
    socket.on('close', () => this.finish())
    socket.on('error', () => this.finish())
  }

  finish() {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }

  frame(opcode, payload) {
    const length = payload.length
    let head
    if (length < 126) head = Buffer.from([0x80 | opcode, length])
    else if (length < 65_536) {
      head = Buffer.alloc(4)
      head[0] = 0x80 | opcode
      head[1] = 126
      head.writeUInt16BE(length, 2)
    } else {
      head = Buffer.alloc(10)
      head[0] = 0x80 | opcode
      head[1] = 127
      head.writeBigUInt64BE(BigInt(length), 2)
    }
    if (!this.closed) this.socket.write(Buffer.concat([head, payload]))
  }

  sendText(text) {
    this.frame(0x1, Buffer.from(text, 'utf8'))
  }

  sendBinary(bytes) {
    this.frame(0x2, Buffer.from(bytes))
  }

  close() {
    if (this.closed) return
    this.frame(0x8, Buffer.from([0x03, 0xe8]))
    this.socket.end()
  }

  read(data) {
    this.buffer = Buffer.concat([this.buffer, data])
    for (;;) {
      if (this.buffer.length < 2) return
      const first = this.buffer[0]
      const second = this.buffer[1]
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) return
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        length = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }
      const maskLength = masked ? 4 : 0
      if (this.buffer.length < offset + maskLength + length) return
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null
      const payload = Buffer.from(this.buffer.subarray(offset + maskLength, offset + maskLength + length))
      if (mask !== null) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4]
      this.buffer = this.buffer.subarray(offset + maskLength + length)
      this.handle(fin, opcode, payload)
    }
  }

  handle(fin, opcode, payload) {
    if (opcode === 0x8) {
      this.close()
      return
    }
    if (opcode === 0x9) {
      this.frame(0xa, payload)
      return
    }
    if (opcode === 0xa) return
    if (opcode === 0x0) {
      if (this.fragments === null) return
      this.fragments.parts.push(payload)
    } else {
      this.fragments = { opcode, parts: [payload] }
    }
    if (!fin) return
    const whole = Buffer.concat(this.fragments.parts)
    const kind = this.fragments.opcode
    this.fragments = null
    if (kind === 0x1) this.onText(whole.toString('utf8'))
    else if (kind === 0x2) this.onBinary(whole)
  }
}

/**
 * 웹소켓 서버를 연다. accept(request) → 거절할 HTTP 상태 번호 또는 null(받음). onPeer(peer, request).
 * 돌려주는 값: { port, close() }
 */
export function startWsServer({ accept, onPeer }) {
  const server = createServer((_, response) => {
    response.writeHead(404)
    response.end()
  })
  server.on('upgrade', (request, socket) => {
    const reject = accept(request)
    if (reject !== null) {
      socket.end(`HTTP/1.1 ${String(reject)} No\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      return
    }
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad\r\n\r\n')
      return
    }
    const answer = createHash('sha1').update(key + GUID).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${answer}\r\n\r\n`)
    socket.setNoDelay(true)
    onPeer(new Peer(socket), request)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((done) => server.close(() => done())) })
    })
  })
}

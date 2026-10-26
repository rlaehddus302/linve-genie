// wav(PCM) 정보 읽기와 구간 잘라 쓰기. afplay는 시작 위치를 못 고르므로 이어서 틀 구간을 파일로 만든다.
import { closeSync, openSync, readSync, writeSync, fstatSync } from 'node:fs'

/** RIFF 덩어리를 훑어 fmt·data 위치를 찾는다 (FLLR 같은 덩어리가 끼어 있어도) */
export function wavInfo(file) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error('wav 파일이 아니에요')
    let pos = 12
    let fmt = null
    while (pos + 8 <= size) {
      const ch = Buffer.alloc(8)
      readSync(fd, ch, 0, 8, pos)
      const id = ch.toString('ascii', 0, 4)
      const len = ch.readUInt32LE(4)
      if (id === 'fmt ') {
        const b = Buffer.alloc(len)
        readSync(fd, b, 0, len, pos + 8)
        fmt = { format: b.readUInt16LE(0), channels: b.readUInt16LE(2), sampleRate: b.readUInt32LE(4), byteRate: b.readUInt32LE(8), blockAlign: b.readUInt16LE(12), bits: b.readUInt16LE(14), raw: b }
      } else if (id === 'data') {
        if (fmt === null) throw new Error('fmt 덩어리가 data보다 뒤에 있어요')
        const dataSize = Math.min(len, size - pos - 8)
        return { ...fmt, dataOffset: pos + 8, dataSize, duration: dataSize / fmt.byteRate }
      }
      pos += 8 + len + (len % 2)
    }
    throw new Error('data 덩어리를 찾지 못했어요')
  } finally {
    closeSync(fd)
  }
}

/** [from, to) 초 구간을 새 wav로 쓴다 */
export function sliceWav(file, info, from, to, out) {
  const start = Math.max(0, Math.floor(from * info.sampleRate)) * info.blockAlign
  const end = Math.min(info.dataSize, Math.floor(to * info.sampleRate) * info.blockAlign)
  const length = Math.max(0, end - start)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(info.format, 20)
  header.writeUInt16LE(info.channels, 22)
  header.writeUInt32LE(info.sampleRate, 24)
  header.writeUInt32LE(info.byteRate, 28)
  header.writeUInt16LE(info.blockAlign, 32)
  header.writeUInt16LE(info.bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(length, 40)
  const src = openSync(file, 'r')
  const dst = openSync(out, 'w')
  try {
    writeSync(dst, header)
    const chunk = Buffer.alloc(1 << 20)
    let done = 0
    while (done < length) {
      const n = readSync(src, chunk, 0, Math.min(chunk.length, length - done), info.dataOffset + start + done)
      if (n <= 0) break
      writeSync(dst, chunk, 0, n)
      done += n
    }
  } finally {
    closeSync(src)
    closeSync(dst)
  }
  return length / info.byteRate
}

// 16kHz 모노 PCM16 바꾸기와 조각 만들기 (VOC-06 소리 형식, D-APP-06, D-APP1-09) — 순수 함수, 가져오는 것 없음.
// 브라우저 AudioWorklet 처리기 안에서도 그대로 쓸 수 있게 이 파일은 다른 모듈을 import하지 않는다(하위 경로 `@livejjim/voice/pcm16`).
//  - 입력 표본률이 무엇이든(44.1k·48k 등) 누적 위치로 선형 보간해 16kHz로 바꾼다. 조각 경계에서 위치를 이어 간다(길이가 틀리게 쌓이지 않음).
//  - 1,600표본(3,200바이트, 100ms)이 찰 때마다 조각 하나. 남은 표본은 다음 조각으로.
//  - -1~1 실수 → 정수: 32,767을 곱해 반올림하고 -32,768~32,767로 자른다. little-endian.
// 입력 1초(44,100 또는 48,000표본)를 넣으면 정확히 16,000표본(조각 10개)이 나온다.

export const PCM_SAMPLE_RATE = 16_000
export const PCM_CHUNK_SAMPLES = 1_600
export const PCM_CHUNK_BYTES = 3_200
/** 조각 하나의 길이 (ms) */
export const PCM_CHUNK_MS = 100
/** PCM16 바이트 → 밀리초: 16kHz 모노 16비트 = 1ms에 32바이트 */
export const PCM_BYTES_PER_MS = 32

/** -1~1 실수 표본 하나 → PCM16 정수 (NaN은 0) */
export function floatToPcm16(sample: number): number {
  if (!Number.isFinite(sample)) return sample > 0 ? 32_767 : sample < 0 ? -32_768 : 0
  const scaled = Math.round(sample * 32_767)
  if (scaled > 32_767) return 32_767
  if (scaled < -32_768) return -32_768
  return scaled === 0 ? 0 : scaled
}

/** 여러 채널 → 모노 (평균). 채널이 없으면 빈 배열 */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0]
  if (first === undefined) return new Float32Array(0)
  if (channels.length === 1) return first
  const out = new Float32Array(first.length)
  for (const channel of channels) {
    const length = Math.min(channel.length, out.length)
    for (let index = 0; index < length; index++) out[index] = (out[index] ?? 0) + (channel[index] ?? 0)
  }
  for (let index = 0; index < out.length; index++) out[index] = (out[index] ?? 0) / channels.length
  return out
}

/**
 * 기기 표본률 → 16kHz PCM16 조각. push(표본)마다 다 찬 조각(3,200바이트 Uint8Array)들을 돌려준다.
 * 위치는 "입력 표본 번호 × 16,000"인 정수로 들고 다녀 소수 오차가 쌓이지 않는다.
 */
export class Pcm16Resampler {
  readonly inputRate: number
  /** 아직 다 쓰지 않은 입력 (보간에 필요한 뒤쪽) */
  private pending: Float32Array = new Float32Array(0)
  /** 다음 출력 표본의 입력 위치 × 16,000 (pending[0] 기준) */
  private position = 0
  private chunk = new Uint8Array(PCM_CHUNK_BYTES)
  private view = new DataView(this.chunk.buffer)
  private filled = 0

  constructor(inputRate: number) {
    const rate = Math.round(inputRate)
    if (!Number.isFinite(inputRate) || rate < 1) throw new RangeError('입력 표본률은 1 이상이어야 한다')
    this.inputRate = rate
  }

  /** 지금 채우는 중인 조각의 표본 수 (0~1,599) */
  get bufferedSamples(): number {
    return this.filled / 2
  }

  /** 다시 이을 때: 채우던 조각과 남은 입력을 버린다 (끊긴 동안의 소리는 보내지 않는다, D-APP-05) */
  reset(): void {
    this.pending = new Float32Array(0)
    this.position = 0
    this.filled = 0
  }

  push(samples: Float32Array): Uint8Array[] {
    const data = this.join(samples)
    const out: Uint8Array[] = []
    const step = this.inputRate
    let position = this.position
    for (;;) {
      const index = Math.floor(position / PCM_SAMPLE_RATE)
      const remainder = position - index * PCM_SAMPLE_RATE
      const needed = remainder === 0 ? index : index + 1
      if (needed >= data.length) break
      const left = data[index] ?? 0
      const value = remainder === 0 ? left : left + ((data[index + 1] ?? 0) - left) * (remainder / PCM_SAMPLE_RATE)
      this.view.setInt16(this.filled, floatToPcm16(value), true)
      this.filled += 2
      if (this.filled === PCM_CHUNK_BYTES) {
        out.push(this.chunk)
        this.chunk = new Uint8Array(PCM_CHUNK_BYTES)
        this.view = new DataView(this.chunk.buffer)
        this.filled = 0
      }
      position += step
    }
    const consumed = Math.min(Math.floor(position / PCM_SAMPLE_RATE), data.length)
    this.pending = data.slice(consumed)
    this.position = position - consumed * PCM_SAMPLE_RATE
    return out
  }

  private join(samples: Float32Array): Float32Array {
    if (this.pending.length === 0) return samples
    const data = new Float32Array(this.pending.length + samples.length)
    data.set(this.pending, 0)
    data.set(samples, this.pending.length)
    return data
  }
}

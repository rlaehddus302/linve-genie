/** AudioWorklet의 128표본 틀을 16kHz/모노/PCM16 3,200바이트 조각으로 바꾼다. */
class LiveGeniePcm extends globalThis.AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.position = 0; this.frame = new Int16Array(1600); this.used = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || !channels[0]) return true;
    for (let n = 0; n < channels[0].length; n++) {
      let sample = 0; for (const channel of channels) sample += channel[n] || 0;
      this.samples.push(sample / channels.length);
    }
    const step = globalThis.sampleRate / 16000;
    while (this.position + 1 < this.samples.length) {
      const left = Math.floor(this.position), fraction = this.position - left;
      const sample = Math.max(-1, Math.min(1, this.samples[left] * (1 - fraction) + this.samples[left + 1] * fraction));
      this.frame[this.used++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      this.position += step;
      if (this.used === 1600) {
        const bytes = new ArrayBuffer(3200), view = new DataView(bytes);
        for (let i = 0; i < 1600; i++) view.setInt16(i * 2, this.frame[i], true);
        this.port.postMessage(bytes, [bytes]); this.used = 0;
      }
    }
    const consumed = Math.floor(this.position); this.samples.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
globalThis.registerProcessor('livegenie-pcm', LiveGeniePcm);


// AVAudioEngine 입력 탭 → 16kHz 모노 PCM16 100ms 틀 (APP-02, D-APP-06).
// - AVAudioSession .playAndRecord + mixWithOthers(앱의 안내음·다른 앱 소리를 막지 않음) + allowBluetooth, 백그라운드 오디오 모드에서 계속 돈다.
// - AVAudioConverter로 기기 형식(48kHz float 등) → 16kHz Int16 모노. 3,200바이트가 찰 때마다 틀 하나. 자투리는 멈출 때 버린다.
// - 끼어들기(전화·시리): began → 엔진 멈춤·INTERRUPTED, ended(shouldResume) → 다시 켬·LISTENING. 경로 바뀜(이어폰)·미디어 서비스 재시작도 다시 켠다.
// - 소리는 파일·로그에 남기지 않는다(D-APP-03).
import AVFoundation
import Foundation

final class PcmCapture {
  static let sampleRate = 16000
  static let bytesPerMs = 32

  typealias FrameHandler = (Data, Double) -> Void
  typealias StateHandler = (String, String?) -> Void

  private let frameBytes: Int
  private let onFrame: FrameHandler
  private let onState: StateHandler
  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var pending = Data()
  private var frames: Int = 0
  private var observers: [NSObjectProtocol] = []
  private var running = false
  private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(PcmCapture.sampleRate), channels: 1, interleaved: true)!

  init(frameMs: Int, onFrame: @escaping FrameHandler, onState: @escaping StateHandler) {
    self.frameBytes = frameMs * PcmCapture.bytesPerMs
    self.onFrame = onFrame
    self.onState = onState
  }

  func start() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])
    try session.setPreferredSampleRate(Double(PcmCapture.sampleRate))
    try session.setPreferredIOBufferDuration(0.02)
    try session.setActive(true, options: [])
    observe()
    try startEngine()
    running = true
    onState("LISTENING", nil)
  }

  func stop() {
    running = false
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
    stopEngine()
    pending.removeAll()
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    NSLog("LivejjimAudio 녹음 끝: 틀 %d 개", frames)
  }

  private func startEngine() throws {
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
      throw NSError(domain: "LivejjimAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "마이크 입력 형식을 읽지 못했어요"])
    }
    converter = AVAudioConverter(from: inputFormat, to: outputFormat)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
      self?.handle(buffer: buffer)
    }
    engine.prepare()
    try engine.start()
  }

  private func stopEngine() {
    engine.inputNode.removeTap(onBus: 0)
    if engine.isRunning { engine.stop() }
    converter = nil
  }

  private func restartEngine() {
    stopEngine()
    pending.removeAll()
    do {
      try AVAudioSession.sharedInstance().setActive(true, options: [])
      try startEngine()
      onState("LISTENING", nil)
    } catch {
      onState("INTERRUPTED", nil)
      // 1초 뒤 다시 시도
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
        guard let self = self, self.running else { return }
        if !self.engine.isRunning { self.restartEngine() }
      }
    }
  }

  private func handle(buffer: AVAudioPCMBuffer) {
    guard let converter = converter else { return }
    let ratio = outputFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 16
    guard let out = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
    var consumed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    if error != nil || out.frameLength == 0 { return }
    guard let channel = out.int16ChannelData?[0] else { return }
    let bytes = Int(out.frameLength) * MemoryLayout<Int16>.size
    pending.append(UnsafeBufferPointer(start: UnsafeRawPointer(channel).assumingMemoryBound(to: UInt8.self), count: bytes))
    while pending.count >= frameBytes {
      let frame = pending.prefix(frameBytes)
      pending.removeFirst(frameBytes)
      frames += 1
      // 틀의 첫 표본 시각 = 지금 − 틀 길이 (벽시계, 밀리초)
      let capturedAt = (Date().timeIntervalSince1970 * 1000.0) - Double(frameBytes / PcmCapture.bytesPerMs)
      onFrame(Data(frame), capturedAt.rounded())
    }
  }

  private func observe() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let self = self, self.running else { return }
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
      switch type {
      case .began:
        self.stopEngine()
        self.onState("INTERRUPTED", nil)
      case .ended:
        self.restartEngine()
      @unknown default:
        break
      }
    })
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
      guard let self = self, self.running else { return }
      guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
      if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable { self.restartEngine() }
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self = self, self.running else { return }
      self.restartEngine()
    })
  }
}

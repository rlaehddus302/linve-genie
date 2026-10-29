// 라이브지니 앱 마이크 모듈 (Expo Modules API, 이름 LivejjimAudio — APP-02).
// JS에 보이는 것: start(options) · stop() · getPermission() · requestPermission() · 사건 "frame"(pcm base64, capturedAtMs) · "state".
// 백그라운드 오디오 모드(앱 Info.plist UIBackgroundModes: audio)에서 AVAudioEngine 탭이 계속 돌아 뒤에서도 듣는다.
// 소리는 파일·로그에 남기지 않는다(D-APP-03).
import AVFoundation
import ExpoModulesCore

struct StartOptions: Record {
  @Field var sampleRate: Int = 16000
  @Field var frameMs: Int = 100
  @Field var notificationTitle: String = "라이브지니"
  @Field var notificationText: String = "음성 듣는 중 · 눌러서 돌아가기"
}

final class PermissionDeniedException: GenericException<String> {
  override var code: String { "E_PERMISSION_DENIED" }
  override var reason: String { "마이크 사용이 막혀 있어요" }
}

final class UnsupportedRateException: GenericException<Int> {
  override var code: String { "E_UNSUPPORTED" }
  override var reason: String { "표본률 \(param) 은 받지 않는다 (16000만)" }
}

final class DeviceErrorException: GenericException<String> {
  override var code: String { "E_DEVICE" }
  override var reason: String { "마이크를 켜지 못했어요: \(param)" }
}

public class LivejjimAudioModule: Module {
  private var capture: PcmCapture?

  public func definition() -> ModuleDefinition {
    Name("LivejjimAudio")
    Events("frame", "state")

    OnDestroy {
      self.capture?.stop()
      self.capture = nil
    }

    AsyncFunction("getPermission") { () -> [String: Any] in
      return self.permissionMap()
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { _ in promise.resolve(self.permissionMap()) }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { _ in promise.resolve(self.permissionMap()) }
      }
    }

    AsyncFunction("start") { (options: StartOptions) throws in
      if options.sampleRate != PcmCapture.sampleRate { throw UnsupportedRateException(options.sampleRate) }
      if !self.isGranted() { throw PermissionDeniedException("denied") }
      if self.capture != nil { return }
      let capture = PcmCapture(frameMs: options.frameMs) { [weak self] pcm, capturedAtMs in
        self?.sendEvent("frame", ["pcm": pcm.base64EncodedString(), "capturedAtMs": capturedAtMs])
      } onState: { [weak self] state, reason in
        var payload: [String: Any] = ["state": state]
        if let reason = reason { payload["reason"] = reason }
        self?.sendEvent("state", payload)
      }
      do {
        try capture.start()
      } catch {
        throw DeviceErrorException(error.localizedDescription)
      }
      self.capture = capture
    }

    AsyncFunction("stop") {
      self.capture?.stop()
      self.capture = nil
      self.sendEvent("state", ["state": "OFF"])
    }
  }

  private func isGranted() -> Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    }
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  private func permissionMap() -> [String: Any] {
    let status: String
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: status = "granted"
      case .denied: status = "denied"
      default: status = "undetermined"
      }
    } else {
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: status = "granted"
      case .denied: status = "denied"
      default: status = "undetermined"
      }
    }
    // 아이폰은 한 번 거절하면 설정에서만 바꿀 수 있다
    return ["status": status, "granted": status == "granted", "canAskAgain": status == "undetermined"]
  }
}

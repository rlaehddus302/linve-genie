// 단축어 자동화에서 부르는 동작 "라이브지니에 문자 보내기" (App Intent, iOS 16+). 아이폰은 문자만 보낸다(SPEC ORD-13 C-01 — channel SMS).
// 판매자가 단축어 앱 → 자동화 → 메시지(받을 때) → 이 동작을 고르고 "보낸 사람"·"내용"에 단축어 변수를 끼운다.
// 앱을 열지 않고(openAppWhenRun false) 뒤에서 돈다. 꺼져 있거나 토큰이 없으면 아무 것도 보내지 않는다.
// 앱의 아이폰 안내는 이 동작 하나다(D-REAL-01 — D-SMS3-23을 바꿈). 웹 설정의 "URL 콘텐츠 가져오기" 안내는 앱 없이 쓰는 사람용으로 웹에만 남는다.
// 문구는 판매자에게 보이므로 쉬운 한국어. 토큰·본문은 로그에 남기지 않는다.
import AppIntents
import Foundation

@available(iOS 16.0, macOS 13.0, *)
public struct SendNoticeIntent: AppIntent {
    public static var title: LocalizedStringResource = "라이브지니에 문자 보내기"
    public static var description = IntentDescription("받은 문자를 라이브지니로 보내 찜 접수와 입금 확인에 씁니다.")
    public static var openAppWhenRun: Bool = false

    @Parameter(title: "보낸 사람", description: "문자를 보낸 전화번호나 이름")
    public var sender: String

    @Parameter(title: "내용", description: "받은 문자 내용")
    public var message: String

    public init() {}

    public init(sender: String, message: String) {
        self.sender = sender
        self.message = message
    }

    public static var parameterSummary: some ParameterSummary {
        Summary("\(\.$sender)에게 받은 \(\.$message) 보내기")
    }

    public func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = await NoticeService.shared.receive(sender: sender, body: message)
        switch outcome {
        case .off: return .result(dialog: "문자 받기가 꺼져 있어요. 라이브지니 앱에서 켜 주세요.")
        case .empty: return .result(dialog: "내용이 비어 있어서 보내지 않았어요.")
        case .filtered: return .result(dialog: "광고·인증·결제 같은 문자라서 보내지 않았어요.")
        case .duplicate: return .result(dialog: "이미 보낸 문자예요.")
        case .dropped: return .result(dialog: "쌓인 문자가 너무 많아 오래된 것부터 지웠어요. 라이브지니 앱을 열어 주세요.")
        case .inboxOff: return .result(dialog: "웹 설정에서 휴대폰 알림 받기가 꺼져 있어요. 켜면 모아 둔 문자를 보내요.")
        case .queued(_, let pending):
            return .result(dialog: pending == 0 ? "라이브지니로 보냈어요." : "문자를 담았어요. 인터넷이 연결되면 라이브지니로 보내요.")
        }
    }
}

@available(iOS 16.4, macOS 13.0, *)
public struct LivejjimNoticeShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SendNoticeIntent(), phrases: ["\(.applicationName)에 문자 보내기"], shortTitle: "문자 보내기", systemImageName: "message")
    }
}

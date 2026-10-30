// 모듈과 앱 동작(App Intent)이 함께 쓰는 한 곳 — 문자 한 건을 거르고, 암호화 대기열에 넣고, 보낸다.
import Foundation

public final class NoticeService {
    public static let shared = NoticeService()
    public let store: NoticeStore
    public let sender: NoticeSender
    /// 상태가 바뀌었다는 알림(모듈이 JS 사건으로 바꾼다)
    public var onChange: (() -> Void)?

    public init(store: NoticeStore = .standard(), sender: NoticeSender? = nil) {
        self.store = store
        self.sender = sender ?? NoticeSender(store: store)
    }

    public enum Outcome: Equatable { case off, empty, filtered, duplicate, dropped, queued(sentNow: Int, pending: Int) }

    /// 단축어 동작이 넘긴 문자 한 건. 꺼져 있으면 아무것도 하지 않는다
    @discardableResult
    public func receive(sender senderName: String, body: String, kind: String = "sms", nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) async -> Outcome {
        guard store.isEnabled else { return .off }
        guard let candidate = NoticeExtractor.shortcutCandidate(sender: senderName, body: body, kind: kind == "bank" ? "bank" : "sms", nowMs: nowMs) else { return .empty }
        if NoticeFilter.match(store.rules(), kindHint: candidate.kindHint, source: candidate.source, body: candidate.body) != nil {
            store.bump("filtered")
            onChange?()
            return .filtered
        }
        switch store.enqueue(candidate, nowMs: nowMs) {
        case .duplicate: onChange?(); return .duplicate
        case .dropped: onChange?(); return .dropped
        case .queued:
            onChange?()
            let result = await sender.drain()
            onChange?()
            return .queued(sentNow: result.sent, pending: result.pending)
        }
    }
}

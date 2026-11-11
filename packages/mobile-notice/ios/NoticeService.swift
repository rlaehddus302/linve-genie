// 모듈과 앱 동작(App Intent)이 함께 쓰는 한 곳 — 문자 한 건을 거르고(서버 skipWords, 받기 전엔 R-26 3 사본 — 은행 대표번호 문자는 거르지 않음, D-SMS3-26),
// 암호화 대기열에 넣고, 보낸다. id는 TS shortcutCandidate와 같은 규칙(보낸 곳·본문·1분 칸) — 본문이 다르면 늘 다른 id라 고정 id 문제가 없다(D-SMS3-32).
import Foundation

public final class NoticeService {
    public static let shared = NoticeService()
    public let store: NoticeStore
    public let sender: NoticeSender
    /// 상태가 바뀌었다는 알림(모듈이 JS 사건으로 바꾼다)
    public var onChange: (() -> Void)?
    /// 저장된 연락처 이름 → 휴대폰 번호 (D-SMS-CONTACT — 시험은 가짜를 넣는다)
    public var contactNumber: (String) -> String? = ContactNumber.number(forName:)

    public init(store: NoticeStore = .standard(), sender: NoticeSender? = nil) {
        self.store = store
        self.sender = sender ?? NoticeSender(store: store)
    }

    /// inboxOff: 담았지만 웹 설정에서 받기가 꺼져 있어(403) 보내지 못했다 — 켜면 모아 둔 것을 보낸다
    public enum Outcome: Equatable { case off, empty, filtered, duplicate, dropped, inboxOff(pending: Int), queued(sentNow: Int, pending: Int) }

    /// 단축어 동작이 넘긴 문자 한 건(channel SMS). 꺼져 있으면 아무것도 하지 않는다
    @discardableResult
    public func receive(sender senderName: String, body: String, nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) async -> Outcome {
        guard store.isEnabled else { return .off }
        // 연락처에 저장한 손님이라 이름만 왔으면 그 연락처의 휴대폰 번호로 (D-SMS-CONTACT — 접근 허용 안 했으면 이름 그대로)
        let from = NoticeExtractor.phoneLike(senderName) == nil ? (contactNumber(senderName) ?? senderName) : senderName
        guard let candidate = NoticeExtractor.shortcutCandidate(sender: from, body: body, nowMs: nowMs) else { return .empty }
        if NoticeFilter.skipWordFor(channel: candidate.channel, from: candidate.from, text: candidate.text, store.filters()) != nil {
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
            if result.stoppedBy == "OFF" { return .inboxOff(pending: result.pending) }
            return .queued(sentNow: result.sent, pending: result.pending)
        }
    }
}

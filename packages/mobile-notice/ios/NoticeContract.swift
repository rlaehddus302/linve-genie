// 서버 받는 입구 약속 (아이폰 쪽 한 곳, SPEC ORD-13 C-04) — TS src/contract.ts·안드로이드 NoticeContract.kt와 같은 값이어야 한다(공용 사례가 잠근다).
// 요청 { device, messages: [{ id, channel, from, title, text, receivedAt }] } (0~20건), 응답 200 { results: [{ id, status }], filters: { skipWords, bankApps, bankNumbers } }.
// 401 토큰 거절(멈춤) · 403 받기 꺼짐(큐·토큰 지키고 10분 뒤·앱을 열 때 0건 요청으로 다시 봄, D-SMS3-27) · 5xx 같은 id로 다시(D-SMS3-31).
// 받는 주소는 /api/inbox/messages (JS가 붙여 넘기므로 여기에는 경로가 없다). 순수 Foundation(앱 없이 단위 시험이 돈다).
import Foundation

/// 요청의 메시지 한 건 (C-04). from·title은 없으면 nil, receivedAt은 밀리초
public struct InboxMessage: Equatable {
    public let id: String
    public let channel: String
    public let from: String?
    public let title: String?
    public let text: String
    public let receivedAt: Int64

    public init(id: String, channel: String, from: String?, title: String?, text: String, receivedAt: Int64) {
        self.id = id
        self.channel = channel
        self.from = from
        self.title = title
        self.text = text
        self.receivedAt = receivedAt
    }
}

/// 200 응답에서 읽은 것
public struct InboxResponse: Equatable {
    public let results: [String: String]
    public let filters: NoticeFilters?
}

public enum NoticeContract {
    public static let messageFields = ["id", "channel", "from", "title", "text", "receivedAt"]
    public static let resultStatuses = ["SAVED", "DUPLICATE", "IGNORED"]
    public static let textMaxChars = 1000
    public static let fromMaxChars = 200
    public static let deviceNameMaxChars = 30
    public static let batchMax = 20
    /// 대기열 최대 (D-SMS3-28) — 넘으면 오래된 것부터 버리고 버린 건수를 앱에 보인다
    public static let queueMax = 1000
    /// 429 뒤 기다림
    public static let tooManyWaitMs: Int64 = 60_000
    /// 403 받기 꺼짐 뒤 0건 요청으로 다시 볼 간격 (D-SMS3-27)
    public static let inboxOffRecheckMs: Int64 = 600_000
    public static let contentType = "application/json"
    public static let tokenPattern = "^[A-Za-z0-9._~+/-]{16,512}=*$"
    private static let loopback = ["http://localhost:", "http://localhost/", "http://127.0.0.1:", "http://127.0.0.1/"]

    public static func isValidToken(_ token: String) -> Bool { token.range(of: tokenPattern, options: .regularExpression) != nil }

    /// 기기 이름: 제어 문자 없이, 앞뒤 빈칸을 뺀 1~30자(UTF-16) — JS cleanDeviceName과 같다
    public static func cleanDeviceName(_ value: String) -> String? {
        if value.utf16.contains(where: { $0 < 0x20 || $0 == 0x7F }) { return nil }
        let trimmed = NoticeExtractor.clean(value)
        if trimmed.isEmpty || trimmed.utf16.count > deviceNameMaxChars { return nil }
        return trimmed
    }

    /// 토큰이 실리므로 https만. 개발용 루프백만 http
    public static func isAllowedEndpoint(_ endpoint: String) -> Bool {
        if endpoint.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.contains($0) || $0.value < 0x20 }) { return false }
        if endpoint.hasPrefix("https://") && endpoint.count > "https://".count {
            let authority = endpoint.dropFirst("https://".count).prefix(while: { $0 != "/" })
            return !authority.contains("@")
        }
        return loopback.contains { endpoint.hasPrefix($0) }
    }

    public static func bearer(_ token: String) -> String { "Bearer \(token)" }

    /// 서버 답 → 할 일: done · bad · token(401) · off(403 받기 꺼짐) · wait · retry
    public static func classify(_ status: Int?) -> String {
        guard let status else { return "retry" }
        if (200...299).contains(status) { return "done" }
        if status == 401 { return "token" }
        if status == 403 { return "off" }
        if status == 429 { return "wait" }
        if status == 408 || status == 425 { return "retry" }
        if (400...499).contains(status) { return "bad" }
        return "retry"
    }

    /// 메시지 한 건 JSON (칸 순서 = messageFields). 대기열에도 이 글을 암호화해 둔다
    public static func messageJson(_ m: InboxMessage) -> String {
        "{\"id\":\(quote(m.id)),\"channel\":\(quote(m.channel)),\"from\":\(m.from.map(quote) ?? "null"),\"title\":\(m.title.map(quote) ?? "null"),\"text\":\(quote(m.text)),\"receivedAt\":\(m.receivedAt)}"
    }

    /// 요청 본문 JSON
    public static func requestJson(device: String, messages: [InboxMessage]) -> String {
        "{\"device\":\(quote(device)),\"messages\":[\(messages.map(messageJson).joined(separator: ","))]}"
    }

    /// 대기열 글 → 메시지. 틀리면 nil
    public static func message(fromJson text: String) -> InboxMessage? {
        guard let data = text.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id"] as? String, let channel = o["channel"] as? String, channel == "SMS" || channel == "APP",
              let body = o["text"] as? String, let at = (o["receivedAt"] as? NSNumber)?.int64Value else { return nil }
        return InboxMessage(id: id, channel: channel, from: o["from"] as? String, title: o["title"] as? String, text: body, receivedAt: at)
    }

    /// 200 응답 본문 읽기. JSON이 아니면 빈 결과
    public static func parseResponse(_ body: Data) -> InboxResponse {
        guard let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return InboxResponse(results: [:], filters: nil) }
        var results: [String: String] = [:]
        for item in (o["results"] as? [Any]) ?? [] {
            guard let r = item as? [String: Any], let id = r["id"] as? String, let status = r["status"] as? String, resultStatuses.contains(status) else { continue }
            results[id] = status
        }
        return InboxResponse(results: results, filters: NoticeFilter.parse(o["filters"]))
    }

    public static func quote(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\u{2028}": out += "\\u2028"
            case "\u{2029}": out += "\\u2029"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }
}

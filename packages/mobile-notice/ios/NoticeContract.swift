// 서버 입구 약속 (아이폰 쪽 한 곳) — TS src/contract.ts·안드로이드 NoticeContract.kt와 같은 값이어야 한다(공용 사례가 잠근다).
// 받는 주소는 /api/inbox/messages (JS가 붙여 넘기므로 여기에는 경로가 없다). 순수 Foundation(앱 없이 JVM처럼 단위 시험이 돈다).
import Foundation

public struct NoticeCandidate: Equatable {
    public let kindHint: String
    public let sourceType: String
    public let source: String
    public let body: String
    public let receivedAtMs: Int64
    public let localId: String

    public init(kindHint: String, sourceType: String, source: String, body: String, receivedAtMs: Int64, localId: String) {
        self.kindHint = kindHint
        self.sourceType = sourceType
        self.source = source
        self.body = body
        self.receivedAtMs = receivedAtMs
        self.localId = localId
    }
}

public enum NoticeContract {
    public static let envelopeFields = ["kindHint", "sourceType", "source", "body", "receivedAtMs", "sentAtMs", "deviceId", "localId"]
    public static let bodyMaxChars = 2000
    public static let sourceMaxChars = 200
    public static let contentType = "application/json"
    public static let tokenPattern = "^[A-Za-z0-9._~+/-]{16,512}=*$"
    public static let deviceIdPattern = "^[A-Za-z0-9._:-]{1,128}$"
    private static let loopback = ["http://localhost:", "http://localhost/", "http://127.0.0.1:", "http://127.0.0.1/"]

    public static func isValidToken(_ token: String) -> Bool { token.range(of: tokenPattern, options: .regularExpression) != nil }
    public static func isValidDeviceId(_ id: String) -> Bool { id.range(of: deviceIdPattern, options: .regularExpression) != nil }

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

    /// 서버 답 → 할 일: accepted · duplicate · rejected · token · retry
    public static func classify(_ status: Int?) -> String {
        guard let status else { return "retry" }
        if (200...299).contains(status) { return "accepted" }
        if status == 409 { return "duplicate" }
        if status == 401 || status == 403 { return "token" }
        if status == 408 || status == 425 || status == 429 { return "retry" }
        if (400...499).contains(status) { return "rejected" }
        return "retry"
    }

    /// 봉투 JSON (칸 순서 = envelopeFields)
    public static func envelopeJson(_ c: NoticeCandidate, sentAtMs: Int64, deviceId: String) -> String {
        "{\"kindHint\":\(quote(c.kindHint)),\"sourceType\":\(quote(c.sourceType)),\"source\":\(quote(c.source)),\"body\":\(quote(c.body)),\"receivedAtMs\":\(c.receivedAtMs),\"sentAtMs\":\(sentAtMs),\"deviceId\":\(quote(deviceId)),\"localId\":\(quote(c.localId))}"
    }

    /// 대기열 한 건(암호화 전 글)
    public static func candidateJson(_ c: NoticeCandidate) -> String {
        "{\"kindHint\":\(quote(c.kindHint)),\"sourceType\":\(quote(c.sourceType)),\"source\":\(quote(c.source)),\"body\":\(quote(c.body)),\"receivedAtMs\":\(c.receivedAtMs),\"localId\":\(quote(c.localId))}"
    }

    public static func candidate(fromJson text: String) -> NoticeCandidate? {
        guard let data = text.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let kind = o["kindHint"] as? String, let type = o["sourceType"] as? String, let source = o["source"] as? String,
              let body = o["body"] as? String, let at = (o["receivedAtMs"] as? NSNumber)?.int64Value, let id = o["localId"] as? String else { return nil }
        return NoticeCandidate(kindHint: kind, sourceType: type, source: source, body: body, receivedAtMs: at, localId: id)
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

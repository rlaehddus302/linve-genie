// 단축어 문자 → 봉투 후보 · 기기 안 거르기 (아이폰) — TS src/extract.ts·rules.ts, 안드로이드 NoticeCore.kt와 같은 규칙이다.
// 아이폰은 알림을 읽지 못한다. 판매자가 단축어 자동화("메시지를 받으면")를 만들고, 그 동작(NoticeIntents.swift)이 보낸 사람·본문을 넘긴다.
import CryptoKit
import Foundation

public enum NoticeExtractor {
    public static let shortcutSourceApp = "ios.shortcut.messages"
    public static let unknownSender = "모름"

    /// 앞뒤 빈칸·줄 끝을 다듬는다 (JS trim과 같은 빈칸)
    public static func clean(_ value: String?) -> String {
        let text = (value ?? "").replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        return trimJS(text)
    }

    private static func isJSSpace(_ s: Unicode.Scalar) -> Bool { s.value == 0xFEFF || (s.properties.isWhitespace && s.value != 0x85) }

    private static func trimJS(_ text: String) -> String {
        var scalars = Array(text.unicodeScalars)
        while let last = scalars.last, isJSSpace(last) { scalars.removeLast() }
        var start = 0
        while start < scalars.count, isJSSpace(scalars[start]) { start += 1 }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[start...])
        return String(out)
    }

    /// UTF-16 단위로 자른다. 짝 대리 문자 가운데서 잘리면 앞쪽 반을 뺀다
    public static func cutUtf16(_ value: String, _ max: Int) -> String {
        let units = Array(value.utf16)
        if units.count <= max { return value }
        var head = Array(units.prefix(max))
        if let last = head.last, (0xD800...0xDBFF).contains(last) { head.removeLast() }
        return String(decoding: head, as: UTF16.self)
    }

    /// 전화번호처럼 생긴 글 → 숫자만(앞 + 유지). 아니면 nil
    public static func phoneDigits(_ value: String) -> String? {
        let trimmed = trimJS(value)
        let allowed = Set("+ ()-.0123456789")
        if trimmed.isEmpty || !trimmed.allSatisfy({ allowed.contains($0) }) { return nil }
        if trimmed.dropFirst().contains("+") { return nil }
        let digits = trimmed.filter { $0 >= "0" && $0 <= "9" }
        if digits.count < 3 || digits.count > 20 { return nil }
        return trimmed.hasPrefix("+") ? "+" + digits : digits
    }

    /// 보낸 사람: tel: 주소 → 번호, 번호 모양 이름 → 숫자, 아니면 이름 그대로
    public static func senderOf(_ name: String?, _ uri: String?) -> String {
        if let uri, uri.lowercased().hasPrefix("tel:") {
            let raw = String(uri.dropFirst(4))
            let decoded = raw.removingPercentEncoding ?? raw
            if let digits = phoneDigits(decoded) { return digits }
        }
        let n = clean(name)
        if n.isEmpty { return unknownSender }
        return phoneDigits(n) ?? cutUtf16(n, NoticeContract.sourceMaxChars)
    }

    /// 같은 알림 두 번 막기 열쇠: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 본문) 앞 16바이트 16진
    public static func localIdOf(_ packageName: String, _ source: String, _ receivedAtMs: Int64, _ body: String) -> String {
        let text = "\(packageName)\u{1F}\(source)\u{1F}\(receivedAtMs)\u{1F}\(body)"
        return SHA256.hash(data: Data(text.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    /// 단축어가 넘긴 문자 → 후보. 본문이 비면 nil. 받은 시각 = 지금(1분 단위로 두 번 막기 열쇠를 만든다)
    public static func shortcutCandidate(sender: String, body: String, kind: String, nowMs: Int64) -> NoticeCandidate? {
        let cleaned = cutUtf16(clean(body), NoticeContract.bodyMaxChars)
        if cleaned.isEmpty { return nil }
        let source = senderOf(sender, nil)
        let bucket = Int64((Double(nowMs) / 60_000.0).rounded(.down)) * 60_000
        return NoticeCandidate(kindHint: kind, sourceType: "sms_number", source: source, body: cleaned, receivedAtMs: nowMs, localId: localIdOf(shortcutSourceApp, source, bucket, cleaned))
    }
}

public struct FilterRule: Equatable {
    public let id: String
    public let field: String
    public let op: String
    public let value: String
    public let kinds: [String]?
}

/// 기기 안 거르기 — 인증번호·광고. 서버가 규칙을 내려주면(setFilterRules) 그것, 없으면 기본 규칙
public enum NoticeFilter {
    public static let defaultRules: [FilterRule] = [
        FilterRule(id: "otp-ko", field: "body", op: "contains", value: "인증번호", kinds: nil),
        FilterRule(id: "otp-ko-code", field: "body", op: "contains", value: "인증코드", kinds: nil),
        FilterRule(id: "otp-ko-confirm", field: "body", op: "contains", value: "확인코드", kinds: nil),
        FilterRule(id: "otp-ko-auth", field: "body", op: "contains", value: "본인확인", kinds: nil),
        FilterRule(id: "otp-en", field: "body", op: "contains", value: "verification code", kinds: nil),
        FilterRule(id: "ad-mark", field: "body", op: "contains", value: "(광고)", kinds: nil),
        FilterRule(id: "ad-optout", field: "body", op: "contains", value: "무료수신거부", kinds: nil),
        FilterRule(id: "ad-optout-short", field: "body", op: "contains", value: "무료거부", kinds: nil),
    ]
    public static let rulesMax = 200
    public static let valueMax = 100

    /// 비교용 글: 모든 빈칸을 빼고 영문자만 소문자로
    public static func normalize(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for s in text.unicodeScalars {
            if s.value == 0xFEFF || (s.properties.isWhitespace && s.value != 0x85) { continue }
            if s.value >= 65 && s.value <= 90 { out.append(Unicode.Scalar(s.value + 32)!) } else { out.append(s) }
        }
        return String(out)
    }

    public static func match(_ rules: [FilterRule], kindHint: String, source: String, body: String) -> String? {
        let b = normalize(body)
        let s = normalize(source)
        for rule in rules {
            if let kinds = rule.kinds, !kinds.contains(kindHint) { continue }
            let needle = normalize(rule.value)
            if needle.isEmpty { continue }
            let text = rule.field == "body" ? b : s
            let hit = rule.op == "contains" ? text.contains(needle) : text.hasPrefix(needle)
            if hit { return rule.id }
        }
        return nil
    }

    /// 서버 규칙 JSON 배열 글 → 규칙. 하나라도 틀리면 nil(기본 규칙을 쓴다)
    public static func parse(_ json: String) -> [FilterRule]? {
        guard let data = json.data(using: .utf8), let array = try? JSONSerialization.jsonObject(with: data) as? [Any], array.count <= rulesMax else { return nil }
        var out: [FilterRule] = []
        for item in array {
            guard let o = item as? [String: Any], let id = o["id"] as? String, let field = o["field"] as? String, let op = o["op"] as? String, let value = o["value"] as? String else { return nil }
            if id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) == nil { return nil }
            if field != "body" && field != "source" { return nil }
            if op != "contains" && op != "startsWith" { return nil }
            if normalize(value).isEmpty || value.utf16.count > valueMax { return nil }
            var kinds: [String]? = nil
            if o.keys.contains("kinds") {
                guard let k = o["kinds"] as? [Any], !k.isEmpty else { return nil }
                var list: [String] = []
                for entry in k {
                    guard let kind = entry as? String, kind == "sms" || kind == "bank" else { return nil }
                    if !list.contains(kind) { list.append(kind) }
                }
                kinds = list
            }
            out.append(FilterRule(id: id, field: field, op: op, value: value, kinds: kinds))
        }
        return out
    }
}

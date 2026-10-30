// 단축어 문자 → 보낼 메시지 · 기기에서 먼저 거르기 (아이폰, SPEC ORD-13 C-01·C-03) — TS src/extract.ts·rules.ts, 안드로이드 NoticeCore.kt와 같은 규칙이다.
// 아이폰은 다른 앱 알림을 읽지 못한다(은행 앱 알림 없음 — D-SMS3-02). 판매자가 단축어 자동화("메시지를 받으면")를 만들고,
// 그 동작(NoticeIntents.swift)이 보낸 곳·본문을 넘긴다 → channel "SMS". skipWords가 든 문자는 보내지 않는다.
import CryptoKit
import Foundation

public enum NoticeExtractor {
    public static let shortcutSourceApp = "ios.shortcut.messages"

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

    /// 전화번호처럼 생긴 글인가 — 맞으면 앞뒤 빈칸만 뺀 글 그대로, 아니면 nil.
    /// 괄호·점·빈칸·하이픈·앞 +를 지우지 않는다: 서버가 보낸 곳 원문으로 은행 대표번호인지 본다(DP-9 1, D-DEP2-10).
    public static func phoneLike(_ value: String) -> String? {
        let trimmed = clean(value)
        let allowed = Set("+ ()-.0123456789")
        if trimmed.isEmpty || !trimmed.allSatisfy({ allowed.contains($0) }) { return nil }
        if trimmed.dropFirst().contains("+") { return nil }
        let digits = trimmed.filter { $0 >= "0" && $0 <= "9" }.count
        if digits < 3 || digits > 20 { return nil }
        return trimmed
    }

    /// 보낸 곳(C-04 from): 글을 바꾸지 않는다(앞뒤 빈칸만 뺀다, 200자까지 — D-DEP2-10). tel: 주소가 번호면 %XX만 푼 그 글, 아니면 이름. 없으면 nil
    public static func senderOf(_ name: String?, _ uri: String?) -> String? {
        if let uri, uri.lowercased().hasPrefix("tel:") {
            let raw = String(uri.dropFirst(4))
            let decoded = raw.removingPercentEncoding ?? raw
            if let number = phoneLike(decoded) { return cutUtf16(number, NoticeContract.fromMaxChars) }
        }
        let n = clean(name)
        if n.isEmpty { return nil }
        return cutUtf16(n, NoticeContract.fromMaxChars)
    }

    /// 메시지 id: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 제목 ␟ 본문) 앞 16바이트 16진. nil 칸은 빈 글
    public static func messageIdOf(_ packageName: String, _ from: String?, _ receivedAt: Int64, _ title: String?, _ text: String) -> String {
        let joined = "\(packageName)\u{1F}\(from ?? "")\u{1F}\(receivedAt)\u{1F}\(title ?? "")\u{1F}\(text)"
        return SHA256.hash(data: Data(joined.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    /// 단축어가 넘긴 문자 → 보낼 메시지(channel SMS). 본문이 비면 nil. 받은 시각 = 지금(1분 단위로 같은 id — 두 번 막기)
    public static func shortcutCandidate(sender: String, body: String, nowMs: Int64) -> InboxMessage? {
        let text = cutUtf16(clean(body), NoticeContract.textMaxChars)
        if text.isEmpty { return nil }
        let from = senderOf(sender, nil)
        let bucket = Int64((Double(nowMs) / 60_000.0).rounded(.down)) * 60_000
        return InboxMessage(id: messageIdOf(shortcutSourceApp, from, bucket, nil, text), channel: "SMS", from: from, title: nil, text: text, receivedAt: nowMs)
    }
}

/// 서버가 주는 거르기 목록 (C-04 응답 filters)
public struct NoticeFilters: Equatable {
    public let skipWords: [String]
    public let bankApps: [String]
    public init(skipWords: [String], bankApps: [String]) {
        self.skipWords = skipWords
        self.bankApps = bankApps
    }
}

/// 기기에서 먼저 거르기 — skipWords가 든 문자는 보내지 않는다(영문 대소문자 무시, 들어 있나). 목록을 받기 전에는 R-26 3 사본
public enum NoticeFilter {
    public static let defaultSkipWords = ["(광고)", "[광고]", "web발신", "국제발신", "해외발신", "인증", "승인", "결제", "택배"]
    public static let skipWordsMax = 200
    public static let skipWordMaxChars = 100
    public static let bankAppsMax = 100
    private static let packageName = "^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$"

    /// 영문 대문자(A-Z)만 소문자로
    public static func lowerAscii(_ text: String) -> String {
        var out = String.UnicodeScalarView()
        for s in text.unicodeScalars {
            if s.value >= 65 && s.value <= 90 { out.append(Unicode.Scalar(s.value + 32)!) } else { out.append(s) }
        }
        return String(out)
    }

    /// 문자 본문에 든 거를 낱말 (없으면 nil). 비교는 UTF-16 단위 "들어 있나"(TS includes와 같게)
    public static func skipWordIn(_ text: String, _ filters: NoticeFilters?) -> String? {
        let haystack = Array(lowerAscii(text).utf16)
        for word in filters?.skipWords ?? defaultSkipWords {
            let needle = Array(lowerAscii(word).utf16)
            if !needle.isEmpty && containsUnits(haystack, needle) { return word }
        }
        return nil
    }

    private static func containsUnits(_ haystack: [UInt16], _ needle: [UInt16]) -> Bool {
        if needle.count > haystack.count { return false }
        var i = 0
        while i + needle.count <= haystack.count {
            if haystack[i] == needle[0] && Array(haystack[i..<(i + needle.count)]) == needle { return true }
            i += 1
        }
        return false
    }

    /// 서버 filters 검사 — 하나라도 틀리면 nil(전에 저장한 목록을 그대로 쓴다)
    public static func parse(_ value: Any?) -> NoticeFilters? {
        guard let o = value as? [String: Any], let skip = o["skipWords"] as? [Any], let apps = o["bankApps"] as? [Any] else { return nil }
        if skip.count > skipWordsMax || apps.count > bankAppsMax { return nil }
        var words: [String] = []
        for item in skip {
            guard let word = item as? String, !(item is NSNumber), !word.isEmpty, word.utf16.count <= skipWordMaxChars else { return nil }
            if !words.contains(word) { words.append(word) }
        }
        var bank: [String] = []
        for item in apps {
            guard let app = item as? String, !(item is NSNumber), app.utf16.count <= 150, app.range(of: packageName, options: .regularExpression) != nil else { return nil }
            if !bank.contains(app) { bank.append(app) }
        }
        return NoticeFilters(skipWords: words, bankApps: bank)
    }

    /// 저장 글 → filters
    public static func parseJson(_ json: String) -> NoticeFilters? {
        guard let data = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return parse(o)
    }

    public static func serialize(_ filters: NoticeFilters) -> String {
        "{\"skipWords\":[\(filters.skipWords.map(NoticeContract.quote).joined(separator: ","))],\"bankApps\":[\(filters.bankApps.map(NoticeContract.quote).joined(separator: ","))]}"
    }
}

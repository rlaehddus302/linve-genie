// 암호화 대기열 · 설정 · 기기 토큰 (아이폰) — 안드로이드 NoticeStore.kt와 같은 일.
// - 대기열 한 건 = 파일 하나(AES-GCM 암호화, 키는 키체인에만 — 잠금 해제 뒤 첫 사용 전까지 접근 불가). 평문 본문·번호를 디스크에 두지 않는다.
// - 토큰·서버 주소·기기 번호도 같은 키로 암호화한 파일. 로그에는 남기지 않는다.
// - 같은 알림 두 번 막기: 최근 SEEN_MAX개 localId를 기억한다.
import CryptoKit
import Foundation
import Security

public protocol NoticeKeyProvider {
    func key() throws -> SymmetricKey
}

/// 키체인에 둔 키 (이 기기에서만, 기기 잠금 해제 뒤)
public struct KeychainKeyProvider: NoticeKeyProvider {
    private let account = "livejjim_notice_v1"
    private let service = "com.livejjim.notice"
    public init() {}

    public func key() throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data { return SymmetricKey(data: data) }
        let fresh = SymmetricKey(size: .bits256)
        let data = fresh.withUnsafeBytes { Data($0) }
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem, SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let again = item as? Data { return SymmetricKey(data: again) }
        guard status == errSecSuccess else { throw NSError(domain: "livejjim.notice", code: Int(status)) }
        return fresh
    }
}

public struct TokenConfig: Equatable {
    public let token: String
    public let endpoint: String
    public let deviceId: String
}

public final class NoticeStore {
    public static let queueMax = 5_000
    public static let seenMax = 5_000
    public static let counters = ["sent", "filtered", "duplicates", "rejected", "dropped"]

    private let directory: URL
    private let defaults: UserDefaults
    private let keys: NoticeKeyProvider
    private let lock = NSLock()
    private var sequence: Int64 = 0

    public init(directory: URL, defaults: UserDefaults, keys: NoticeKeyProvider) {
        self.directory = directory
        self.defaults = defaults
        self.keys = keys
        try? FileManager.default.createDirectory(at: queueDirectory, withIntermediateDirectories: true)
    }

    public static func standard() -> NoticeStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("livejjim-notice", isDirectory: true)
        return NoticeStore(directory: base, defaults: UserDefaults(suiteName: "livejjim.notice") ?? .standard, keys: KeychainKeyProvider())
    }

    private var queueDirectory: URL { directory.appendingPathComponent("queue", isDirectory: true) }
    private var tokenFile: URL { directory.appendingPathComponent("token.bin") }
    private var seenFile: URL { directory.appendingPathComponent("seen.bin") }

    // MARK: 암호화
    private func seal(_ plain: Data, purpose: String) throws -> Data {
        let box = try AES.GCM.seal(plain, using: try keys.key(), authenticating: Data(purpose.utf8))
        return box.combined!
    }

    private func open(_ blob: Data, purpose: String) -> Data? {
        guard let box = try? AES.GCM.SealedBox(combined: blob), let key = try? keys.key() else { return nil }
        return try? AES.GCM.open(box, using: key, authenticating: Data(purpose.utf8))
    }

    private func writeAtomic(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    // MARK: 설정
    public var isEnabled: Bool { defaults.bool(forKey: "enabled") }
    public var enabledAtMs: Int64 { Int64(defaults.double(forKey: "enabledAtMs")) }
    public func setEnabled(_ enabled: Bool, nowMs: Int64) {
        if enabled && !isEnabled { defaults.set(Double(nowMs), forKey: "enabledAtMs") }
        defaults.set(enabled, forKey: "enabled")
    }

    public func rules() -> [FilterRule] {
        defaults.string(forKey: "rulesJson").flatMap(NoticeFilter.parse) ?? NoticeFilter.defaultRules
    }
    public var serverRules: Bool { defaults.string(forKey: "rulesJson").flatMap(NoticeFilter.parse) != nil }
    public func setRulesJson(_ json: String) {
        if json.isEmpty { defaults.removeObject(forKey: "rulesJson") } else { defaults.set(json, forKey: "rulesJson") }
    }

    // MARK: 토큰
    public var hasToken: Bool { FileManager.default.fileExists(atPath: tokenFile.path) }
    public var isTokenRejected: Bool { defaults.bool(forKey: "tokenRejected") }
    public func setTokenRejected() { defaults.set(true, forKey: "tokenRejected") }

    public func token() -> TokenConfig? {
        guard let blob = try? Data(contentsOf: tokenFile), let plain = open(blob, purpose: "livejjim-notice-token"),
              let o = try? JSONSerialization.jsonObject(with: plain) as? [String: String],
              let token = o["token"], let endpoint = o["endpoint"], let deviceId = o["deviceId"] else { return nil }
        return TokenConfig(token: token, endpoint: endpoint, deviceId: deviceId)
    }

    public func setToken(_ config: TokenConfig?) throws {
        guard let config else {
            try? FileManager.default.removeItem(at: tokenFile)
            defaults.set(false, forKey: "tokenRejected")
            return
        }
        let plain = try JSONSerialization.data(withJSONObject: ["token": config.token, "endpoint": config.endpoint, "deviceId": config.deviceId])
        try writeAtomic(try seal(plain, purpose: "livejjim-notice-token"), to: tokenFile)
        defaults.set(false, forKey: "tokenRejected")
    }

    // MARK: 숫자
    public func bump(_ counter: String) { defaults.set(defaults.integer(forKey: "count_\(counter)") + 1, forKey: "count_\(counter)") }
    public func count(_ counter: String) -> Int { defaults.integer(forKey: "count_\(counter)") }
    public var lastError: String? { defaults.string(forKey: "lastError") }
    public func setLastError(_ value: String?) { if let value { defaults.set(value, forKey: "lastError") } else { defaults.removeObject(forKey: "lastError") } }
    public func markSent(nowMs: Int64) { defaults.set(Double(nowMs), forKey: "lastSentAtMs") }

    // MARK: 대기열
    public enum EnqueueResult: Equatable { case queued, duplicate, dropped }

    public func enqueue(_ candidate: NoticeCandidate, nowMs: Int64) -> EnqueueResult {
        lock.lock(); defer { lock.unlock() }
        var seen = loadSeen()
        if seen.contains(candidate.localId) { bump("duplicates"); return .duplicate }
        if pendingFiles().count >= NoticeStore.queueMax { bump("dropped"); return .dropped }
        guard let blob = try? seal(Data(NoticeContract.candidateJson(candidate).utf8), purpose: "livejjim-notice-queue") else { bump("dropped"); return .dropped }
        sequence += 1
        let name = String(format: "%016lld-%06lld.q", nowMs, sequence)
        guard (try? writeAtomic(blob, to: queueDirectory.appendingPathComponent(name))) != nil else { bump("dropped"); return .dropped }
        seen.append(candidate.localId)
        if seen.count > NoticeStore.seenMax { seen = Array(seen.suffix(NoticeStore.seenMax)) }
        saveSeen(seen)
        defaults.set(Double(nowMs), forKey: "lastQueuedAtMs")
        return .queued
    }

    public func pendingFiles() -> [URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: queueDirectory, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "q" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
    public var pendingCount: Int { pendingFiles().count }

    /// 읽지 못하는(깨진·키가 바뀐) 파일은 지우고 nil
    public func read(_ file: URL) -> NoticeCandidate? {
        if let blob = try? Data(contentsOf: file), let plain = open(blob, purpose: "livejjim-notice-queue"),
           let text = String(data: plain, encoding: .utf8), let candidate = NoticeContract.candidate(fromJson: text) { return candidate }
        try? FileManager.default.removeItem(at: file)
        return nil
    }
    public func remove(_ file: URL) { try? FileManager.default.removeItem(at: file) }

    private func loadSeen() -> [String] {
        guard let blob = try? Data(contentsOf: seenFile), let plain = open(blob, purpose: "livejjim-notice-seen"), let text = String(data: plain, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").map(String.init)
    }
    private func saveSeen(_ ids: [String]) {
        if let blob = try? seal(Data(ids.joined(separator: "\n").utf8), purpose: "livejjim-notice-seen") { try? writeAtomic(blob, to: seenFile) }
    }

    // MARK: JS로 비출 상태
    public func stateMap() -> [String: Any] {
        var map: [String: Any] = [
            "platform": "ios", "enabled": isEnabled, "access": "shortcut", "connected": false, "hasToken": hasToken,
            "tokenRejected": isTokenRejected, "pending": pendingCount, "bankPackages": [String](), "serverRules": serverRules,
        ]
        for counter in NoticeStore.counters { map[counter] = Double(count(counter)) }
        if defaults.double(forKey: "lastQueuedAtMs") > 0 { map["lastQueuedAtMs"] = defaults.double(forKey: "lastQueuedAtMs") }
        if defaults.double(forKey: "lastSentAtMs") > 0 { map["lastSentAtMs"] = defaults.double(forKey: "lastSentAtMs") }
        if let lastError { map["lastError"] = lastError }
        return map
    }
}

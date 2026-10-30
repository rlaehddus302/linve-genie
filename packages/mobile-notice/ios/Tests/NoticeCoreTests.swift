// 공용 사례(test-vectors/notice-vectors.json)를 Swift 본이 그대로 내는지 + 암호화 대기열·보내기 처리.
// TS(test/vectors.test.ts)·Kotlin(NoticeVectorsTest.kt)과 같은 파일을 읽는다.
import CryptoKit
import Foundation
#if canImport(XCTest)
import XCTest
#endif
#if canImport(NoticeCore)
@testable import NoticeCore
#endif

private func vectorsJSON() throws -> [String: Any] {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("test-vectors/notice-vectors.json")
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
}

private func items(_ v: [String: Any], _ key: String) -> [[String: Any]] { v[key] as! [[String: Any]] }
private func str(_ o: [String: Any], _ k: String) -> String? { o[k] as? String }
private func int64(_ o: [String: Any], _ k: String) -> Int64 { (o[k] as! NSNumber).int64Value }
private func candidate(_ o: [String: Any]) -> NoticeCandidate {
    NoticeCandidate(kindHint: str(o, "kindHint")!, sourceType: str(o, "sourceType")!, source: str(o, "source")!, body: str(o, "body")!, receivedAtMs: int64(o, "receivedAtMs"), localId: str(o, "localId")!)
}

final class NoticeVectorsTests: XCTestCase {
    func testLocalId() throws {
        for v in items(try vectorsJSON(), "localId") {
            XCTAssertEqual(NoticeExtractor.localIdOf(str(v, "packageName")!, str(v, "source")!, int64(v, "receivedAtMs"), str(v, "body")!), str(v, "localId"))
        }
    }
    func testPhone() throws {
        for v in items(try vectorsJSON(), "phone") { XCTAssertEqual(NoticeExtractor.phoneDigits(str(v, "input")!), str(v, "output"), "\(v)") }
    }
    func testSender() throws {
        for v in items(try vectorsJSON(), "sender") { XCTAssertEqual(NoticeExtractor.senderOf(str(v, "name"), str(v, "uri")), str(v, "output"), "\(v)") }
    }
    func testNormalize() throws {
        for v in items(try vectorsJSON(), "normalize") { XCTAssertEqual(NoticeFilter.normalize(str(v, "input")!), str(v, "output"), "\(v)") }
    }
    func testCut() throws {
        for v in items(try vectorsJSON(), "cut") { XCTAssertEqual(NoticeExtractor.cutUtf16(str(v, "input")!, (v["max"] as! NSNumber).intValue), str(v, "output"), "\(v)") }
    }
    func testFilter() throws {
        for v in items(try vectorsJSON(), "filter") {
            let rules: [FilterRule]? = v["rules"] is NSNull ? NoticeFilter.defaultRules : NoticeFilter.parse(String(data: try JSONSerialization.data(withJSONObject: v["rules"]!), encoding: .utf8)!)
            XCTAssertNotNil(rules, "\(v)")
            XCTAssertEqual(NoticeFilter.match(rules ?? [], kindHint: str(v, "kindHint")!, source: str(v, "source")!, body: str(v, "body")!), str(v, "rule"), "\(v)")
        }
    }
    func testClassify() throws {
        for v in items(try vectorsJSON(), "classify") { XCTAssertEqual(NoticeContract.classify((v["status"] as? NSNumber)?.intValue), str(v, "action"), "\(v)") }
    }
    func testShortcut() throws {
        for v in items(try vectorsJSON(), "shortcut") {
            let input = v["input"] as! [String: Any]
            let got = NoticeExtractor.shortcutCandidate(sender: str(input, "sender")!, body: str(input, "body")!, kind: str(input, "kind")!, nowMs: int64(v, "nowMs"))
            XCTAssertEqual(got, v["candidate"] is NSNull ? nil : candidate(v["candidate"] as! [String: Any]), "\(v)")
        }
    }
    func testEnvelope() throws {
        let v = try vectorsJSON()["envelope"] as! [String: Any]
        let json = NoticeContract.envelopeJson(candidate(v["candidate"] as! [String: Any]), sentAtMs: int64(v, "sentAtMs"), deviceId: str(v, "deviceId")!)
        let got = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
        let want = v["json"] as! [String: Any]
        XCTAssertEqual(NSDictionary(dictionary: got), NSDictionary(dictionary: want))
        // 칸 순서 = ENVELOPE_FIELDS
        var last = json.startIndex
        for field in NoticeContract.envelopeFields {
            let r = json.range(of: "\"\(field)\":", range: last..<json.endIndex)
            XCTAssertNotNil(r, field)
            last = r?.upperBound ?? last
        }
    }
    func testEndpoint() {
        XCTAssertTrue(NoticeContract.isAllowedEndpoint("https://livejjim.example/api/inbox/messages"))
        XCTAssertTrue(NoticeContract.isAllowedEndpoint("http://127.0.0.1:7760/api/inbox/messages"))
        XCTAssertFalse(NoticeContract.isAllowedEndpoint("http://livejjim.example/api/inbox/messages"))
        XCTAssertFalse(NoticeContract.isAllowedEndpoint("https://user:pw@livejjim.example/x"))
        XCTAssertFalse(NoticeContract.isAllowedEndpoint("https://livejjim.example/a b"))
    }
}

private struct FixedKey: NoticeKeyProvider {
    let k = SymmetricKey(data: Data(repeating: 7, count: 32))
    func key() throws -> SymmetricKey { k }
}

final class NoticeQueueTests: XCTestCase {
    private func makeStore() -> (NoticeStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("notice-test-\(UUID().uuidString)")
        let defaults = UserDefaults(suiteName: "notice-test-\(UUID().uuidString)")!
        return (NoticeStore(directory: dir, defaults: defaults, keys: FixedKey()), dir)
    }
    private func message(_ i: Int) -> NoticeCandidate {
        NoticeExtractor.shortcutCandidate(sender: "010-1234-5678", body: "찜 \(i)번", kind: "sms", nowMs: 1_761_800_000_000 + Int64(i) * 120_000)!
    }

    func testQueueIsEncryptedAndDeduped() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(store.enqueue(message(3), nowMs: 1), .queued)
        XCTAssertEqual(store.enqueue(message(3), nowMs: 2), .duplicate)
        XCTAssertEqual(store.pendingCount, 1)
        XCTAssertEqual(store.count("duplicates"), 1)
        let raw = try Data(contentsOf: store.pendingFiles()[0])
        XCTAssertNil(raw.range(of: Data("찜 3번".utf8)), "본문이 평문으로 디스크에 있으면 안 된다")
        XCTAssertNil(raw.range(of: Data("01012345678".utf8)))
        XCTAssertEqual(store.read(store.pendingFiles()[0]), message(3))
    }

    func testTokenStoredEncrypted() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        let config = TokenConfig(token: "abcdefghijklmnop1234", endpoint: "https://x.example/api/inbox/messages", deviceId: "phone-a")
        try store.setToken(config)
        XCTAssertEqual(store.token(), config)
        XCTAssertNil(try Data(contentsOf: dir.appendingPathComponent("token.bin")).range(of: Data("abcdefghijklmnop1234".utf8)))
        try store.setToken(nil)
        XCTAssertFalse(store.hasToken)
    }

    func testDrainHandlesServerAnswers() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(TokenConfig(token: "abcdefghijklmnop1234", endpoint: "https://x.example/api/inbox/messages", deviceId: "phone-a"))
        for i in 1...4 { XCTAssertEqual(store.enqueue(message(i), nowMs: Int64(i)), .queued) }
        var bodies: [String] = []
        var answers: [Int?] = [200, 409, 422, nil]
        let sender = NoticeSender(store: store) { request, body in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer abcdefghijklmnop1234")
            XCTAssertEqual(request.url?.path, "/api/inbox/messages")
            bodies.append(String(data: body, encoding: .utf8)!)
            return answers.removeFirst()
        }
        let result = await sender.drain()
        XCTAssertEqual(result, DrainResult(sent: 1, pending: 1, stoppedBy: "NETWORK"))
        XCTAssertEqual(bodies.count, 4)
        XCTAssertEqual(store.count("sent"), 1)
        XCTAssertEqual(store.count("rejected"), 1)
        // 연결 실패한 한 건은 남아 있고, 다음에 보내면 나간다
        answers = [200]
        let again = await sender.drain()
        XCTAssertEqual(again, DrainResult(sent: 1, pending: 0, stoppedBy: nil))
    }

    func testTokenRejectedStopsAndKeepsQueue() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(TokenConfig(token: "abcdefghijklmnop1234", endpoint: "https://x.example/api/inbox/messages", deviceId: "phone-a"))
        XCTAssertEqual(store.enqueue(message(1), nowMs: 1), .queued)
        let sender = NoticeSender(store: store) { _, _ in 401 }
        let result = await sender.drain()
        XCTAssertEqual(result, DrainResult(sent: 0, pending: 1, stoppedBy: "TOKEN"))
        XCTAssertTrue(store.isTokenRejected)
        let blocked = await sender.drain()
        XCTAssertEqual(blocked.stoppedBy, "TOKEN")
    }

    func testServiceFiltersAndRespectsOffSwitch() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        let service = NoticeService(store: store, sender: NoticeSender(store: store) { _, _ in 200 })
        let off = await service.receive(sender: "010-1234-5678", body: "찜 3번")
        XCTAssertEqual(off, .off)
        store.setEnabled(true, nowMs: 1)
        let ad = await service.receive(sender: "15880000", body: "(광고) 할인 무료수신거부")
        XCTAssertEqual(ad, .filtered)
        XCTAssertEqual(store.pendingCount, 0)
        let blank = await service.receive(sender: "010", body: "   ")
        XCTAssertEqual(blank, .empty)
        let ok = await service.receive(sender: "010-1234-5678", body: "찜 3번")
        XCTAssertEqual(ok, .queued(sentNow: 0, pending: 1), "토큰이 없으면 담아 두기만 한다")
    }
}

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
private func message(_ o: [String: Any]) -> InboxMessage {
    InboxMessage(id: str(o, "id")!, channel: str(o, "channel")!, from: str(o, "from"), title: str(o, "title"), text: str(o, "text")!, receivedAt: int64(o, "receivedAt"))
}
private func filtersOf(_ o: [String: Any], _ k: String) -> NoticeFilters? { o[k] is NSNull ? nil : NoticeFilter.parse(o[k]) }

final class NoticeVectorsTests: XCTestCase {
    func testMessageId() throws {
        for v in items(try vectorsJSON(), "messageId") {
            XCTAssertEqual(NoticeExtractor.messageIdOf(str(v, "packageName")!, str(v, "from"), int64(v, "receivedAt"), str(v, "title"), str(v, "text")!), str(v, "id"), "\(v)")
        }
    }
    func testPhone() throws {
        for v in items(try vectorsJSON(), "phoneLike") { XCTAssertEqual(NoticeExtractor.phoneLike(str(v, "input")!), str(v, "output"), "\(v)") }
    }
    func testSender() throws {
        for v in items(try vectorsJSON(), "sender") { XCTAssertEqual(NoticeExtractor.senderOf(str(v, "name"), str(v, "uri")), str(v, "output"), "\(v)") }
    }
    func testCut() throws {
        for v in items(try vectorsJSON(), "cut") { XCTAssertEqual(NoticeExtractor.cutUtf16(str(v, "input")!, (v["max"] as! NSNumber).intValue), str(v, "output"), "\(v)") }
    }
    func testLowerAscii() throws {
        for v in items(try vectorsJSON(), "lowerAscii") { XCTAssertEqual(NoticeFilter.lowerAscii(str(v, "input")!), str(v, "output"), "\(v)") }
    }
    func testSkip() throws {
        for v in items(try vectorsJSON(), "skip") { XCTAssertEqual(NoticeFilter.skipWordIn(str(v, "text")!, filtersOf(v, "filters")), str(v, "word"), "\(v)") }
    }
    func testSmsSkip() throws {
        for v in items(try vectorsJSON(), "smsSkip") {
            let filters = filtersOf(v, "filters")
            if !(v["filters"] is NSNull) { XCTAssertNotNil(filters, str(v, "name")!) }
            XCTAssertEqual(NoticeFilter.skipWordFor(channel: str(v, "channel")!, from: str(v, "from"), text: str(v, "text")!, filters), str(v, "word"), str(v, "name")!)
        }
    }
    func testFilters() throws {
        for v in items(try vectorsJSON(), "filters") {
            let want = filtersOf(v, "output")
            XCTAssertEqual(NoticeFilter.parse(v["input"] is NSNull ? nil : v["input"]), want, "\(v)")
            if let want { XCTAssertEqual(NoticeFilter.parseJson(NoticeFilter.serialize(want)), want) }
        }
    }
    func testClassify() throws {
        for v in items(try vectorsJSON(), "classify") { XCTAssertEqual(NoticeContract.classify((v["status"] as? NSNumber)?.intValue), str(v, "action"), "\(v)") }
    }
    func testShortcut() throws {
        for v in items(try vectorsJSON(), "shortcut") {
            let input = v["input"] as! [String: Any]
            let got = NoticeExtractor.shortcutCandidate(sender: str(input, "sender")!, body: str(input, "body")!, nowMs: int64(v, "nowMs"))
            XCTAssertEqual(got, v["candidate"] is NSNull ? nil : message(v["candidate"] as! [String: Any]), "\(v)")
        }
    }
    func testRequest() throws {
        let v = try vectorsJSON()["request"] as! [String: Any]
        let messages = (v["messages"] as! [[String: Any]]).map(message)
        let json = NoticeContract.requestJson(device: str(v, "device")!, messages: messages)
        let got = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
        XCTAssertEqual(str(got, "device"), str(v, "device"))
        let gotMessages = (got["messages"] as! [[String: Any]]).map(message)
        XCTAssertEqual(gotMessages, messages)
        for m in messages {
            let one = NoticeContract.messageJson(m)
            XCTAssertEqual(NoticeContract.message(fromJson: one), m)
            // 칸 순서 = messageFields
            var last = one.startIndex
            for field in NoticeContract.messageFields {
                let r = one.range(of: "\"\(field)\":", range: last..<one.endIndex)
                XCTAssertNotNil(r, field)
                last = r?.upperBound ?? last
            }
        }
        XCTAssertTrue(json.contains("\\u2028"))
    }
    func testResponse() throws {
        for v in items(try vectorsJSON(), "response") {
            let got = NoticeContract.parseResponse(Data(str(v, "body")!.utf8))
            XCTAssertEqual(got.results, v["results"] as! [String: String], "\(v)")
            XCTAssertEqual(got.filters, filtersOf(v, "filters"), "\(v)")
        }
    }
    func testDeviceNameAndEndpoint() {
        XCTAssertEqual(NoticeContract.cleanDeviceName("  내 아이폰 15 "), "내 아이폰 15")
        XCTAssertNil(NoticeContract.cleanDeviceName(String(repeating: "가", count: 31)))
        XCTAssertNil(NoticeContract.cleanDeviceName("폰\n1"))
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

private let filtersJSON = #"{"skipWords":["(광고)","인증"],"bankApps":[]}"#

/// 가짜 서버: 요청의 모든 id를 SAVED로 답하고 filters를 붙인다
private func okReply(_ body: Data) -> NoticeSender.Reply {
    let request = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
    let ids = (request["messages"] as! [[String: Any]]).map { $0["id"] as! String }
    let results = ids.map { #"{"id":"\#($0)","status":"SAVED"}"# }.joined(separator: ",")
    return (200, Data(#"{"results":[\#(results)],"filters":\#(filtersJSON)}"#.utf8))
}

final class NoticeQueueTests: XCTestCase {
    private func makeStore() -> (NoticeStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("notice-test-\(UUID().uuidString)")
        let defaults = UserDefaults(suiteName: "notice-test-\(UUID().uuidString)")!
        return (NoticeStore(directory: dir, defaults: defaults, keys: FixedKey()), dir)
    }
    private func message(_ i: Int) -> InboxMessage {
        NoticeExtractor.shortcutCandidate(sender: "010-1234-5678", body: "찜 \(i)번", nowMs: 1_761_800_000_000 + Int64(i) * 120_000)!
    }
    private let config = TokenConfig(token: "abcdefghijklmnop1234", endpoint: "https://x.example/api/inbox/messages", deviceName: "내 아이폰")

    func testQueueIsEncryptedAndDeduped() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertEqual(store.enqueue(message(3), nowMs: 1), .queued)
        XCTAssertEqual(store.enqueue(message(3), nowMs: 2), .duplicate)
        XCTAssertEqual(store.pendingCount, 1)
        XCTAssertEqual(store.count("duplicates"), 1)
        let raw = try Data(contentsOf: store.pendingFiles()[0])
        XCTAssertNil(raw.range(of: Data("찜 3번".utf8)), "본문이 평문으로 디스크에 있으면 안 된다")
        XCTAssertNil(raw.range(of: Data("010-1234-5678".utf8)))
        XCTAssertEqual(store.read(store.pendingFiles()[0]), message(3))
    }

    func testQueueKeepsNewest1000() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        for i in 1...1003 { _ = store.enqueue(message(i), nowMs: Int64(i)) }
        XCTAssertEqual(store.pendingCount, 1000)
        XCTAssertEqual((store.stateMap()["dropped"] as? Double).map { Int($0) }, 3)
        XCTAssertEqual(store.count("dropped"), 3)
        XCTAssertEqual(store.read(store.pendingFiles()[0])?.text, "찜 4번")
    }

    func testTokenStoredEncrypted() throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        XCTAssertEqual(store.token(), config)
        XCTAssertNil(try Data(contentsOf: dir.appendingPathComponent("token.bin")).range(of: Data("abcdefghijklmnop1234".utf8)))
        try store.setToken(nil)
        XCTAssertFalse(store.hasToken)
    }

    func testDrainBatchesAndStoresFilters() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        for i in 1...23 { XCTAssertEqual(store.enqueue(message(i), nowMs: Int64(i)), .queued) }
        var sizes: [Int] = []
        let sender = NoticeSender(store: store) { request, body in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer abcdefghijklmnop1234")
            XCTAssertEqual(request.url?.path, "/api/inbox/messages")
            let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
            XCTAssertEqual(o["device"] as? String, "내 아이폰")
            sizes.append((o["messages"] as! [Any]).count)
            return okReply(body)
        }
        let result = await sender.drain()
        XCTAssertEqual(result, DrainResult(sent: 23, pending: 0, stoppedBy: nil))
        XCTAssertEqual(sizes, [20, 3])
        // 서버가 bankNumbers 없이 주면 기기 사본(DP-9 1 표)
        XCTAssertEqual(store.filters(), NoticeFilters(skipWords: ["(광고)", "인증"], bankApps: [], bankNumbers: NoticeFilter.defaultBankNumbers))
    }

    func testRetryKeepsSameIdAnd429Waits() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        XCTAssertEqual(store.enqueue(message(1), nowMs: 1), .queued)
        var ids: [String] = []
        var answers: [Int?] = [nil, 503, 429]
        var clock: Int64 = 1_000
        let sender = NoticeSender(store: store) { _, body in
            let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
            ids.append(contentsOf: (o["messages"] as! [[String: Any]]).map { $0["id"] as! String })
            if answers.isEmpty { return okReply(body) }
            return (answers.removeFirst(), Data())
        }
        let first = await sender.drain(nowMs: { clock })
        XCTAssertEqual(first.stoppedBy, "NETWORK")
        let second = await sender.drain(nowMs: { clock })
        XCTAssertEqual(second.stoppedBy, "SERVER")
        let third = await sender.drain(nowMs: { clock })
        XCTAssertEqual(third.stoppedBy, "BUSY")
        clock += 59_999
        let early = await sender.drain(nowMs: { clock })
        XCTAssertEqual(early, DrainResult(sent: 0, pending: 1, stoppedBy: "BUSY"))
        XCTAssertEqual(ids.count, 3)
        clock += 1
        let done = await sender.drain(nowMs: { clock })
        XCTAssertEqual(done, DrainResult(sent: 1, pending: 0, stoppedBy: nil))
        XCTAssertEqual(Set(ids).count, 1, "같은 id로 다시 보낸다")
    }

    func testBadRequestIsolatesOne() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        for i in 1...3 { _ = store.enqueue(message(i), nowMs: Int64(i)) }
        let sender = NoticeSender(store: store) { _, body in
            let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
            let texts = (o["messages"] as! [[String: Any]]).map { $0["text"] as! String }
            return texts.contains("찜 2번") ? (400, Data()) : okReply(body)
        }
        let result = await sender.drain()
        XCTAssertEqual(result, DrainResult(sent: 2, pending: 0, stoppedBy: nil))
        XCTAssertEqual(store.count("rejected"), 1)
    }

    func testTokenRejectedStopsAndKeepsQueue() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        XCTAssertEqual(store.enqueue(message(1), nowMs: 1), .queued)
        let sender = NoticeSender(store: store) { _, _ in (401, Data()) }
        let result = await sender.drain()
        XCTAssertEqual(result, DrainResult(sent: 0, pending: 1, stoppedBy: "TOKEN"))
        XCTAssertTrue(store.isTokenRejected)
        let blocked = await sender.drain()
        XCTAssertEqual(blocked.stoppedBy, "TOKEN")
    }

    /// 공용 사례 drain (D-SMS3-21 (a)(b)) — TS 가짜 구현·Kotlin NoticeDrain과 같은 사례
    func testDrainVectors() async throws {
        let v = try vectorsJSON()
        let serverFilters = try JSONSerialization.data(withJSONObject: v["drainFilters"] as! [String: Any])
        for c in items(v, "drain") {
            let name = str(c, "name")!
            let (store, dir) = makeStore()
            defer { try? FileManager.default.removeItem(at: dir) }
            try store.setToken(config)
            if (c["startOff"] as? Bool) == true { store.setInboxOff(true, checkAtMs: 1_761_800_600_000) }
            let queue = c["queue"] as! [String]
            for (i, text) in queue.enumerated() {
                let m = NoticeExtractor.shortcutCandidate(sender: "010-1234-5678", body: text, nowMs: 1_761_800_000_000 + Int64(i) * 120_000)!
                XCTAssertEqual(store.enqueue(m, nowMs: 1), .queued, name)
            }
            let replies = c["replies"] as! [[String: Any]]
            var requests: [Int] = []
            let sender = NoticeSender(store: store) { _, body in
                let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
                let messages = o["messages"] as! [[String: Any]]
                let texts = messages.map { $0["text"] as! String }
                requests.append(texts.count)
                let rule = replies.first { r in (r["ifText"] as? String).map { texts.contains($0) } ?? true }
                let status = (rule?["status"] as? NSNumber)?.intValue
                if status != 200 { return (status, Data()) }
                let results = messages.map { #"{"id":"\#($0["id"] as! String)","status":"SAVED"}"# }.joined(separator: ",")
                return (200, Data(#"{"results":[\#(results)],"filters":"#.utf8) + serverFilters + Data("}".utf8))
            }
            let result = await sender.drain(fetchFilters: true, nowMs: { 1_761_800_600_000 })
            let stoppedBy = c["stoppedBy"] as? String
            XCTAssertEqual(requests, c["requests"] as! [Int], name)
            XCTAssertEqual(result, DrainResult(sent: (c["sent"] as! NSNumber).intValue, pending: (c["pending"] as! NSNumber).intValue, stoppedBy: stoppedBy), name)
            XCTAssertEqual(store.count("sent"), (c["sent"] as! NSNumber).intValue, name)
            XCTAssertEqual(store.count("rejected"), (c["rejected"] as! NSNumber).intValue, name)
            XCTAssertEqual(store.isTokenRejected, c["tokenRejected"] as! Bool, name)
            XCTAssertEqual(store.filters() != nil, c["hasFilters"] as! Bool, name)
            XCTAssertEqual(store.isInboxOff, c["inboxOff"] as! Bool, name)
            XCTAssertEqual(store.stateMap()["inboxOff"] as? Bool, (c["inboxOff"] as! Bool), name)
            if store.isInboxOff && !store.isTokenRejected {
                // 받기 꺼짐: 10분 동안은 묻지 않고 대기열은 그대로, 앱을 열 때(fetchFilters)는 바로 다시 본다
                XCTAssertEqual(store.offCheckAtMs, 1_761_800_600_000 + NoticeContract.inboxOffRecheckMs, name)
                let waiting = await sender.drain(nowMs: { 1_761_800_600_000 + 599_999 })
                XCTAssertEqual(waiting.stoppedBy, "OFF", name)
                XCTAssertEqual(requests, c["requests"] as! [Int], name)
                let left = store.pendingFiles().compactMap { store.read($0)?.text }
                XCTAssertEqual(left, Array(queue.suffix((c["pending"] as! NSNumber).intValue)), name)
            }
            XCTAssertEqual(store.stateMap()["lastError"] as? String, stoppedBy, name)
            XCTAssertEqual((store.stateMap()["rejected"] as? Double).map { Int($0) }, (c["rejected"] as! NSNumber).intValue, name)
            if store.isTokenRejected {
                // 새 토큰 전에는 다시 밀어도 보내지 않고 대기열은 그대로
                let again = await sender.drain(fetchFilters: true, nowMs: { 1_761_800_600_000 })
                XCTAssertEqual(again.stoppedBy, "TOKEN", name)
                XCTAssertEqual(requests, c["requests"] as! [Int], name)
                let left = store.pendingFiles().compactMap { store.read($0)?.text }
                XCTAssertEqual(left, Array(queue.suffix((c["pending"] as! NSNumber).intValue)), name)
            }
        }
    }

    /// 403(받기 꺼짐, D-SMS3-27): 토큰 거절이 아니다 — 큐·토큰을 지키고, 10분 뒤 0건 요청으로 다시 보고, 켜졌으면 같은 id로 보낸다
    func testInboxOffKeepsTokenAndRechecks() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        for i in 1...2 { _ = store.enqueue(message(i), nowMs: Int64(i)) }
        var bodies: [[String]] = []
        var status = 403
        let sender = NoticeSender(store: store) { _, body in
            let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
            bodies.append((o["messages"] as! [[String: Any]]).map { $0["id"] as! String })
            return status == 200 ? okReply(body) : (status, Data())
        }
        var clock: Int64 = 1_000
        let first = await sender.drain(nowMs: { clock })
        XCTAssertEqual(first, DrainResult(sent: 0, pending: 2, stoppedBy: "OFF"))
        XCTAssertFalse(store.isTokenRejected)
        XCTAssertTrue(store.isInboxOff)
        XCTAssertTrue(store.hasToken)
        XCTAssertEqual(store.lastError, "OFF")
        let ids = bodies[0]
        clock += 599_999
        let early = await sender.drain(nowMs: { clock })
        XCTAssertEqual(early.stoppedBy, "OFF")
        XCTAssertEqual(bodies.count, 1, "10분 안에는 묻지 않는다")
        clock += 1
        let still = await sender.drain(nowMs: { clock })
        XCTAssertEqual(still.stoppedBy, "OFF")
        XCTAssertEqual(bodies.last, [], "다시 볼 때는 0건 요청")
        status = 200
        let opened = await sender.drain(fetchFilters: true, nowMs: { clock + 1 })
        XCTAssertEqual(opened, DrainResult(sent: 2, pending: 0, stoppedBy: nil), "앱을 열면 10분을 기다리지 않는다")
        XCTAssertEqual(Array(bodies.suffix(2)), [[], ids])
        XCTAssertFalse(store.isInboxOff)
        XCTAssertNil(store.lastError)
    }

    func testServerErrorKeepsSameIds() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        for i in 1...2 { _ = store.enqueue(message(i), nowMs: Int64(i)) }
        var bodies: [[String]] = []
        var status = 500
        let sender = NoticeSender(store: store) { _, body in
            let o = try! JSONSerialization.jsonObject(with: body) as! [String: Any]
            bodies.append((o["messages"] as! [[String: Any]]).map { $0["id"] as! String })
            return status == 200 ? okReply(body) : (status, Data())
        }
        let failed = await sender.drain()
        XCTAssertEqual(failed, DrainResult(sent: 0, pending: 2, stoppedBy: "SERVER"))
        status = 200
        let done = await sender.drain()
        XCTAssertEqual(done.sent, 2)
        XCTAssertEqual(bodies[0], bodies[1])
    }

    func testEmptyQueueFetchesFilters() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.setToken(config)
        var bodies: [String] = []
        let sender = NoticeSender(store: store) { _, body in bodies.append(String(data: body, encoding: .utf8)!); return okReply(body) }
        _ = await sender.drain()
        XCTAssertEqual(bodies, [#"{"device":"내 아이폰","messages":[]}"#])
        XCTAssertNotNil(store.filters())
        _ = await sender.drain()
        XCTAssertEqual(bodies.count, 1, "목록이 있으면 빈 대기열로 다시 묻지 않는다")
        _ = await sender.drain(fetchFilters: true)
        XCTAssertEqual(bodies.count, 2)
    }

    func testServiceFiltersAndRespectsOffSwitch() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        let service = NoticeService(store: store, sender: NoticeSender(store: store) { _, body in okReply(body) })
        let off = await service.receive(sender: "010-1234-5678", body: "찜 3번")
        XCTAssertEqual(off, .off)
        store.setEnabled(true, nowMs: 1)
        let ad = await service.receive(sender: "15880000", body: "[Web발신] 결제 승인")
        XCTAssertEqual(ad, .filtered)
        // 은행 대표번호 문자는 [Web발신]·승인이 들어도 거르지 않는다 (D-SMS3-26)
        let bank = await service.receive(sender: "1588-9999", body: "[Web발신] 승인 12,000원 출금 잔액 38,000원")
        XCTAssertEqual(bank, .queued(sentNow: 0, pending: 1))
        let spoof = await service.receive(sender: "+82 1588-9999", body: "[Web발신] 홍길동 입금 14,000원")
        XCTAssertEqual(spoof, .filtered)
        let otp = await service.receive(sender: "15880000", body: "인증번호 123456")
        XCTAssertEqual(otp, .filtered)
        XCTAssertEqual(store.pendingCount, 1)
        let blank = await service.receive(sender: "010", body: "   ")
        XCTAssertEqual(blank, .empty)
        let ok = await service.receive(sender: "010-1234-5678", body: "찜 3번")
        XCTAssertEqual(ok, .queued(sentNow: 0, pending: 2), "토큰이 없으면 담아 두기만 한다")
    }

    // D-SMS-CONTACT: 연락처에 저장한 손님이라 단축어가 이름을 넘기면 그 연락처의 휴대폰 번호로 바꿔 담는다
    func testServiceTurnsSavedContactNameIntoNumber() async throws {
        let (store, dir) = makeStore()
        defer { try? FileManager.default.removeItem(at: dir) }
        let service = NoticeService(store: store, sender: NoticeSender(store: store) { _, body in okReply(body) })
        var asked: [String] = []
        service.contactNumber = { name in asked.append(name); return name == "김손님" ? "01012345678" : nil }
        store.setEnabled(true, nowMs: 1)
        _ = await service.receive(sender: "김손님", body: "찜 3번")
        _ = await service.receive(sender: "모르는 이름", body: "찜 4번")
        _ = await service.receive(sender: "010-5555-6666", body: "찜 5번")
        XCTAssertEqual(asked, ["김손님", "모르는 이름"], "번호로 온 문자는 연락처를 보지 않는다")
        let froms = Set(store.pendingFiles().compactMap { store.read($0)?.from })
        XCTAssertEqual(froms, ["01012345678", "모르는 이름", "010-5555-6666"])
    }

    func testContactPickNeedsExactlyOneMobile() {
        XCTAssertEqual(ContactPick.mobile(["010-1234-5678"]), "01012345678")
        XCTAssertEqual(ContactPick.mobile(["+82 10-1234-5678", "010 1234 5678", "02-123-4567"]), "01012345678")
        XCTAssertNil(ContactPick.mobile([]))
        XCTAssertNil(ContactPick.mobile(["02-123-4567", "1588-1234"]))
        XCTAssertNil(ContactPick.mobile(["010-1234-5678", "010-9999-8888"]))
    }
}

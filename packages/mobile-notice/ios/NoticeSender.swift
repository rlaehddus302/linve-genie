// 서버로 보내기 (아이폰, SPEC ORD-13 C-04, AC-SMS3-27) — 받은 차례대로 20건씩 POST(Authorization: Bearer). 안드로이드 NoticeSender.kt와 같은 처리:
// 200이면 묶음을 지우고 결과(SAVED·DUPLICATE·IGNORED)를 세고 응답 filters를 저장, 400·413이면 한 건씩 다시 보내 틀린 한 건만 버리고 "서버가 받지 않음"(rejected)으로 세고,
// 401은 멈추고 대기열을 지키고(새 토큰까지), 403(받기 꺼짐, D-SMS3-27)은 토큰·대기열을 지키고 10분 뒤(앱을 열면 바로) 0건 요청으로 먼저 다시 보고,
// 429는 1분 동안 보내지 않고, 연결 실패·5xx(500 잠깐의 오류 포함, D-SMS3-31)는 멈추고 다음에 같은 id로 다시 보낸다.
// 아이폰은 뒤에서 깨울 일꾼이 없어 10분 뒤 다시 보기는 다음 단축어 문자·앱을 열 때 한다.
// 대기열이 비었고 filters를 아직 받지 못했으면(또는 켤 때·토큰을 넣을 때) 0건 요청으로 filters만 받는다.
// 리다이렉트는 따라가지 않는다(토큰이 다른 곳으로 가지 않게). 토큰·본문·번호는 로그에 남기지 않는다.
import Foundation

public struct DrainResult: Equatable {
    public let sent: Int
    public let pending: Int
    public let stoppedBy: String?
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public final class NoticeSender {
    private let store: NoticeStore
    /// 서버 답: 상태 번호(연결 실패는 nil)와 본문
    public typealias Reply = (status: Int?, body: Data)
    private let post: (URLRequest, Data) async -> Reply
    private let lock = NSLock()
    private var draining = false

    /// post를 바꿔 끼우면 시험이 네트워크 없이 돈다. 기본은 URLSession(리다이렉트 안 따름)
    public init(store: NoticeStore, post: ((URLRequest, Data) async -> Reply)? = nil) {
        self.store = store
        if let post { self.post = post } else {
            let delegate = NoRedirect()
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.waitsForConnectivity = false
            let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
            self.post = { request, body in
                do {
                    let (data, response) = try await session.upload(for: request, from: body)
                    return ((response as? HTTPURLResponse)?.statusCode, data)
                } catch {
                    return (nil, Data())
                }
            }
        }
    }

    private func begin() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if draining { return false }
        draining = true
        return true
    }

    private func end() {
        lock.lock(); defer { lock.unlock() }
        draining = false
    }

    /// fetchFilters = 앱을 열 때(켜기·토큰 넣기·지금 보내기) — 받기 꺼짐이어도 10분을 기다리지 않고 바로 다시 본다
    public func drain(fetchFilters: Bool = false, nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) async -> DrainResult {
        if !begin() { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: nil) }
        defer { end() }

        guard let config = store.token() else { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "NO_TOKEN") }
        if store.isTokenRejected { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "TOKEN") }
        if nowMs() < store.notBeforeMs { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "BUSY") }
        if store.isInboxOff && !fetchFilters && nowMs() < store.offCheckAtMs { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "OFF") }
        guard NoticeContract.isAllowedEndpoint(config.endpoint), let url = URL(string: config.endpoint) else { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "NETWORK") }
        var sent = 0
        var single = false
        var askedFilters = false
        // 받기 꺼짐 뒤에는 대기열을 싣지 않고 0건 요청으로 먼저 본다(D-SMS3-27)
        var probe = store.isInboxOff
        while true {
            let files: [URL] = probe ? [] : Array(store.pendingFiles().prefix(single ? 1 : NoticeContract.batchMax))
            var batch: [(URL, InboxMessage)] = []
            for file in files { if let m = store.read(file) { batch.append((file, m)) } }
            if !files.isEmpty && batch.isEmpty {
                // 풀지 못한 파일만 있었다 — 지워졌으면 다음 묶음, 지우지 못했으면 멈춘다
                if files.contains(where: { FileManager.default.fileExists(atPath: $0.path) }) { break }
                continue
            }
            if batch.isEmpty && !probe {
                if askedFilters || !(fetchFilters || store.filters() == nil) { break }
                askedFilters = true
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(NoticeContract.bearer(config.token), forHTTPHeaderField: "Authorization")
            request.setValue(NoticeContract.contentType, forHTTPHeaderField: "Content-Type")
            request.setValue(NoticeContract.contentType, forHTTPHeaderField: "Accept")
            let reply = await post(request, Data(NoticeContract.requestJson(device: config.deviceName, messages: batch.map { $0.1 }).utf8))
            let action = NoticeContract.classify(reply.status)
            if probe && (action == "done" || action == "bad") {
                // 꺼짐이 풀렸다(서버가 403이 아닌 답을 했다) — 이제 대기열을 보낸다
                probe = false
                askedFilters = true
                store.setInboxOff(false, checkAtMs: 0)
            }
            switch action {
            case "done":
                let response = NoticeContract.parseResponse(reply.body)
                if let filters = response.filters { store.setFilters(filters) }
                for (file, message) in batch {
                    store.remove(file)
                    switch response.results[message.id] {
                    case "DUPLICATE": store.bump("duplicates")
                    case "IGNORED": store.bump("ignored")
                    default: store.bump("sent"); sent += 1
                    }
                }
                if batch.isEmpty { store.setLastError(nil) } else { store.markSent(nowMs: nowMs()) }
            case "bad":
                if batch.count > 1 { single = true } else if let only = batch.first { store.remove(only.0); store.bump("rejected") }
            case "token":
                store.setTokenRejected()
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: "TOKEN")
            case "off":
                store.setInboxOff(true, checkAtMs: nowMs() + NoticeContract.inboxOffRecheckMs)
                store.setLastError("OFF")
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: "OFF")
            case "wait":
                store.setNotBeforeMs(nowMs() + NoticeContract.tooManyWaitMs)
                store.setLastError("BUSY")
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: "BUSY")
            default:
                let why = reply.status == nil ? "NETWORK" : "SERVER"
                store.setLastError(why)
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: why)
            }
        }
        store.setLastError(nil)
        return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: nil)
    }
}

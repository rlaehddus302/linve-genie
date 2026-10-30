// 서버로 보내기 (아이폰) — 받은 차례대로 한 건씩 POST(Authorization: Bearer). 안드로이드 NoticeSender.kt와 같은 처리:
// 2xx·409는 지우고, 그 밖의 4xx는 버리고 건수만, 401·403은 멈추고 대기열을 지키고, 연결 실패·5xx·429는 멈추고 다음에 다시 보낸다.
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
    private let post: (URLRequest, Data) async -> Int?
    private let lock = NSLock()
    private var draining = false

    /// post를 바꿔 끼우면 시험이 네트워크 없이 돈다. 기본은 URLSession(리다이렉트 안 따름)
    public init(store: NoticeStore, post: ((URLRequest, Data) async -> Int?)? = nil) {
        self.store = store
        if let post { self.post = post } else {
            let delegate = NoRedirect()
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.waitsForConnectivity = false
            let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
            self.post = { request, body in
                do {
                    let (_, response) = try await session.upload(for: request, from: body)
                    return (response as? HTTPURLResponse)?.statusCode
                } catch {
                    return nil
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

    public func drain(nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) async -> DrainResult {
        if !begin() { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: nil) }
        defer { end() }

        guard let config = store.token() else { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "NO_TOKEN") }
        if store.isTokenRejected { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "TOKEN") }
        guard NoticeContract.isAllowedEndpoint(config.endpoint), let url = URL(string: config.endpoint) else { return DrainResult(sent: 0, pending: store.pendingCount, stoppedBy: "NETWORK") }
        var sent = 0
        for file in store.pendingFiles() {
            guard let candidate = store.read(file) else { continue }
            let now = nowMs()
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(NoticeContract.bearer(config.token), forHTTPHeaderField: "Authorization")
            request.setValue(NoticeContract.contentType, forHTTPHeaderField: "Content-Type")
            request.setValue(NoticeContract.contentType, forHTTPHeaderField: "Accept")
            let status = await post(request, Data(NoticeContract.envelopeJson(candidate, sentAtMs: now, deviceId: config.deviceId).utf8))
            switch NoticeContract.classify(status) {
            case "accepted":
                store.remove(file); store.bump("sent"); store.markSent(nowMs: now); sent += 1
            case "duplicate":
                store.remove(file); store.markSent(nowMs: now)
            case "rejected":
                store.remove(file); store.bump("rejected")
            case "token":
                store.setTokenRejected()
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: "TOKEN")
            default:
                let why = status == nil ? "NETWORK" : "SERVER"
                store.setLastError(why)
                return DrainResult(sent: sent, pending: store.pendingCount, stoppedBy: why)
            }
        }
        store.setLastError(nil)
        return DrainResult(sent: sent, pending: 0, stoppedBy: nil)
    }
}

// 가짜 Marklife (YXQ·L11) — packages/printer/src/fake-bluetooth.ts의 createFakeBluetooth 응답 로직을 옮겼다.
// 흐름 제어(ff03): 알림을 켜면 `01 n`(첫 크레딧, 기본 4) + (옵션) `02 lo hi`(MTU), 조각을 하나 받을 때마다 `01 m`(기본 1).
// 끝 알림(ff01): 작업을 끝까지 받으면 `AA`. 작업의 시작은 방식마다의 시작 바이트, 끝은 래스터 머리로 계산한 길이(fakeJobLength).
// 앞 작업을 끝까지 받지 못한 채 다음 작업의 시작이 오면 앞 시도를 닫고 새 시도로 센다(조각 경계에서 나누기 포함).
// 시각·블루투스를 모른다 — write()가 그 쓰기에 대한 알림을 돌려준다.

public enum MarklifeProtocol: String, CaseIterable {
    case yxq2 = "MARKLIFE_YXQ2"
    case yxq3 = "MARKLIFE_YXQ3"
    case yxq8 = "MARKLIFE_YXQ8"
    case l11 = "MARKLIFE_L11"
}

/// GATT 꾸러미 A (16비트 UUID)
public let marklifeServiceUUID = "FF00"
public let marklifeWriteUUID = "FF02"
public let marklifeNotifyUUID = "FF01"
public let marklifeFlowUUID = "FF03"

public enum MarklifeChannel: String, Equatable {
    case notify = "ff01"
    case flow = "ff03"
}

public struct MarklifeOutput: Equatable {
    public let channel: MarklifeChannel
    public let bytes: [UInt8]
    public init(_ channel: MarklifeChannel, _ bytes: [UInt8]) {
        self.channel = channel
        self.bytes = bytes
    }
}

/// 아무 값이나 받는 자리 (농도)
private let any = -1

private func jobStart(_ p: MarklifeProtocol) -> [Int] {
    let zeros = { (n: Int) in [Int](repeating: 0, count: n) }
    let yxq38: [Int] = [0x1F, 0x80, 0x02, 0x20, 0x1F, 0x70, 0x02, any] + zeros(6) + [0x1F, 0xC0, 0x01, 0x00, 0x1F, 0x11, 0x51, 0x1F, 0x10]
    switch p {
    case .yxq2: return [0x1F, 0x70, 0x01, any, 0x10, 0xFF, 0xF1, 0x02, 0x1F, 0x10]
    case .yxq3, .yxq8: return yxq38
    case .l11: return zeros(15) + [0x10, 0xFF, 0xF1, 0x02, 0x1D, 0x76, 0x30, 0x00]
    }
}

public enum StartMatch: Equatable { case yes, no, maybe }

/// bytes의 at 자리부터가 작업 시작 바이트인지 (fakeJobStartAt)
public func marklifeJobStartAt(_ p: MarklifeProtocol, _ bytes: [UInt8], _ at: Int) -> StartMatch {
    let start = jobStart(p)
    let n = min(start.count, bytes.count - at)
    if n > 0 {
        for i in 0..<n {
            let want = start[i]
            if want != any && Int(bytes[at + i]) != want { return .no }
        }
    }
    return n == start.count ? .yes : .maybe
}

/// 작업 길이 (fakeJobLength): nil = 래스터 머리를 아직 못 받음, -1 = 꼴이 틀림(NaN)
public func marklifeJobLength(_ p: MarklifeProtocol, _ bytes: [UInt8]) -> Int? {
    func at(_ i: Int) -> Int { Int(bytes[i]) }
    if p == .l11 {
        let head = 19
        if bytes.count < head + 8 { return nil }
        if at(head) != 0x1D || at(head + 1) != 0x76 || at(head + 2) != 0x30 || at(head + 3) != 0x00 { return -1 }
        let wb = at(head + 4) | (at(head + 5) << 8)
        let h = at(head + 6) | (at(head + 7) << 8)
        return head + 8 + wb * h + 2 + 4
    }
    let head = p == .yxq2 ? 8 : 21
    let tail = p == .yxq2 ? 2 + 4 : 4 + 4 + 3
    if bytes.count < head + 10 { return nil }
    if at(head) != 0x1F || at(head + 1) != 0x10 { return -1 }
    let length = (at(head + 6) << 24) | (at(head + 7) << 16) | (at(head + 8) << 8) | at(head + 9)
    return head + 10 + length + tail
}

/// 출력 시도 하나
public final class MarklifeAttempt {
    public let index: Int
    public fileprivate(set) var packets: [[UInt8]]
    public fileprivate(set) var bytes: [UInt8]
    public fileprivate(set) var complete = false
    public fileprivate(set) var acked = false
    public fileprivate(set) var writes: Int
    fileprivate var starts: [(packet: Int, at: Int)]

    init(index: Int, packets: [[UInt8]] = [], bytes: [UInt8] = [], writes: Int = 0, starts: [(packet: Int, at: Int)] = []) {
        self.index = index
        self.packets = packets
        self.bytes = bytes
        self.writes = writes
        self.starts = starts
    }

    /// 작업 길이만큼 (끝까지 받았을 때)
    public func jobBytes(_ p: MarklifeProtocol) -> [UInt8] {
        guard let total = marklifeJobLength(p, bytes), total > 0 else { return bytes }
        return Array(bytes.prefix(total))
    }
}

public enum MarklifeAckMode: Equatable {
    /// 작업을 다 받은 그 쓰기 안에서 `AA`
    case send
    /// 보내지 않음
    case none
}

public final class MarklifeEmulator {
    public let proto: MarklifeProtocol
    /// 첫 크레딧 (nil = 보내지 않음)
    public let initialCredits: UInt8?
    /// 조각마다 크레딧 (0 = 보내지 않음)
    public let creditsPerPacket: UInt8
    /// 첫 크레딧 뒤 MTU 알림 (nil = 없음)
    public var mtu: Int?
    public let ack: MarklifeAckMode

    public private(set) var attempts: [MarklifeAttempt] = []
    public private(set) var packets: [[UInt8]] = []
    /// 마지막 write에서 끝까지 받은 작업
    public private(set) var completedInLastWrite: [MarklifeAttempt] = []
    private var open: MarklifeAttempt?
    private var out: [MarklifeOutput] = []

    public init(proto: MarklifeProtocol, initialCredits: UInt8? = 4, creditsPerPacket: UInt8 = 1, mtu: Int? = nil, ack: MarklifeAckMode = .send) {
        self.proto = proto
        self.initialCredits = initialCredits
        self.creditsPerPacket = creditsPerPacket
        self.mtu = mtu
        self.ack = ack
    }

    /// 흐름 제어(ff03) 알림을 켰을 때 보낼 것
    public func onFlowSubscribed() -> [MarklifeOutput] {
        var result: [MarklifeOutput] = []
        if let c = initialCredits { result.append(MarklifeOutput(.flow, [0x01, c])) }
        if let m = mtu { result.append(MarklifeOutput(.flow, [0x02, UInt8(m & 0xFF), UInt8((m >> 8) & 0xFF)])) }
        return result
    }

    /// 연결이 끊겼다 — 끝나지 않은 시도를 닫는다
    public func dropLink() {
        open = nil
    }

    /// 쓰기 조각 하나 — 이 쓰기로 나온 알림을 순서대로 돌려준다
    public func write(_ packet: [UInt8]) -> [MarklifeOutput] {
        out = []
        completedInLastWrite = []
        // 끝까지 받지 못한 시도에 새 작업의 첫 조각이 오면 그 시도를 닫는다
        if open != nil && marklifeJobStartAt(proto, packet, 0) == .yes { open = nil }
        if open == nil {
            let a = MarklifeAttempt(index: attempts.count + 1)
            open = a
            attempts.append(a)
        }
        let attempt = open!
        attempt.writes += 1
        packets.append(packet)
        // 조각이 시작 바이트보다 짧으면 이 조각만으로 가리지 못한다 — 후보로 두고 뒤 조각과 함께 본다
        if attempt.packets.count > 0 && marklifeJobStartAt(proto, packet, 0) != .no {
            attempt.starts.append((packet: attempt.packets.count, at: attempt.bytes.count))
        }
        attempt.packets.append(packet)
        attempt.bytes.append(contentsOf: packet)
        if creditsPerPacket > 0 { out.append(MarklifeOutput(.flow, [0x01, creditsPerPacket])) }
        settle(attempt)
        return out
    }

    private func splitAt(_ attempt: MarklifeAttempt, _ start: (packet: Int, at: Int)) -> MarklifeAttempt {
        let next = MarklifeAttempt(
            index: attempts.count + 1,
            packets: Array(attempt.packets[start.packet...]),
            bytes: Array(attempt.bytes[start.at...]),
            writes: attempt.packets.count - start.packet,
            starts: attempt.starts.filter { $0.packet > start.packet }.map { (packet: $0.packet - start.packet, at: $0.at - start.at) }
        )
        attempt.packets = Array(attempt.packets[..<start.packet])
        attempt.bytes = Array(attempt.bytes[..<start.at])
        attempt.starts = []
        attempts.append(next)
        open = next
        return next
    }

    private func settle(_ first: MarklifeAttempt) {
        var attempt = first
        while true {
            let current = attempt
            current.starts = current.starts.filter { marklifeJobStartAt(proto, current.bytes, $0.at) != .no }
            guard let found = current.starts.first(where: { marklifeJobStartAt(proto, current.bytes, $0.at) == .yes }) else { break }
            attempt = splitAt(current, found)
        }
        guard let total = marklifeJobLength(proto, attempt.bytes), total >= 0, attempt.bytes.count >= total else { return }
        if attempt.starts.contains(where: { $0.at < total }) { return }
        onComplete(attempt)
    }

    private func onComplete(_ attempt: MarklifeAttempt) {
        attempt.complete = true
        open = nil
        completedInLastWrite.append(attempt)
        if ack == .send {
            attempt.acked = true
            out.append(MarklifeOutput(.notify, [0xAA]))
        }
    }

    /// 나중에 보낸 끝 알림을 적어 둔다 (늦게 보내기 옵션)
    public func markAcked(_ attempt: MarklifeAttempt) {
        attempt.acked = true
    }
}

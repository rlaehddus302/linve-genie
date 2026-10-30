// 가짜 B1 (바이트 수준) — packages/mobile-ble/src/fake.ts의 createFakeB1을 그대로 옮겼다.
// niimbluelib 패킷(55 55 cmd len data chk aa aa)을 받아 B1처럼 답한다: 연결 협상, 모델(B1 = 4096), 심박, 농도·라벨 종류·인쇄 시작·쪽 시작·쪽 크기,
// 래스터 줄(일방향, 셈만), 쪽 끝, 인쇄 상태(쪽을 다 받으면 1쪽 100%), 인쇄 끝. 모르는 요청은 "지원 안 함"(In_NotSupported).
// 시각·블루투스를 모른다 — write()가 그 쓰기에 대한 답(알림 바이트)을 돌려준다. 보내는 것은 부르는 쪽(main.swift)이 한다.

/// niimbluelib 명령 번호 (RequestCommandId / ResponseCommandId, @mmote/niimbluelib 0.47.1)
public enum B1Command {
    public static let connect: UInt8 = 0xC1
    public static let printerInfo: UInt8 = 0x40
    public static let heartbeat: UInt8 = 0xDC
    public static let setDensity: UInt8 = 0x21
    public static let setLabelType: UInt8 = 0x23
    public static let printStart: UInt8 = 0x01
    public static let pageStart: UInt8 = 0x03
    public static let setPageSize: UInt8 = 0x13
    public static let printEmptyRow: UInt8 = 0x84
    public static let printBitmapRow: UInt8 = 0x85
    public static let printBitmapRowIndexed: UInt8 = 0x83
    public static let pageEnd: UInt8 = 0xE3
    public static let printStatus: UInt8 = 0xA3
    public static let printEnd: UInt8 = 0xF3
}

public enum B1Response {
    public static let connect: UInt8 = 0xC2
    public static let printerCode: UInt8 = 0x48
    public static let chargeLevel: UInt8 = 0x4A
    public static let heartbeatAdvanced1: UInt8 = 0xDD
    public static let setDensity: UInt8 = 0x31
    public static let setLabelType: UInt8 = 0x33
    public static let printStart: UInt8 = 0x02
    public static let pageStart: UInt8 = 0x04
    public static let setPageSize: UInt8 = 0x14
    public static let pageEnd: UInt8 = 0xE4
    public static let printStatus: UInt8 = 0xB3
    public static let printEnd: UInt8 = 0xF4
    public static let notSupported: UInt8 = 0x00
}

/// PrinterInfoType · HeartbeatType · ConnectResult
let printerInfoModelId: UInt8 = 8
let printerInfoBattery: UInt8 = 10
let heartbeatAdvanced1: UInt8 = 1
let connectResultConnectedNew: UInt8 = 2

/// B1 서비스와 특성 (niimbluelib이 찾는 NIIMBOT 꼴)
public let b1ServiceUUID = "E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"
public let b1CharacteristicUUID = "BEF8D6C9-9C21-4C9E-B632-BD58C1009F9F"
public let b1ModelId: UInt16 = 4096

public struct B1Page: Equatable {
    public let rows: Int
    public let cols: Int
    public let copies: Int
    public let density: Int
    public let labelType: Int
    /// 받은 래스터 줄 수 (빈 줄 묶음 포함)
    public let rasterRows: Int
    /// 줄 폭 = ceil(cols/8) 바이트, 1 = 검정 점
    public let bitmap: [UInt8]

    public var bitmapImage: Bitmap { Bitmap(width: cols, height: rows, data: bitmap) }
}

/// 한 번의 write 안에서 일어난 일 (지연 기록용)
public enum B1Event: Equatable {
    case printStart
    case pageStart
    case raster
    case pageEnd(index: Int)
    case printStatus(done: Bool)
    case printEnd
}

/// NIIMBOT 패킷 바이트: 55 55 cmd len data chk aa aa (chk = cmd ^ len ^ data…)
public func niimbotPacket(_ command: UInt8, _ data: [UInt8]) -> [UInt8] {
    var chk = command ^ UInt8(data.count & 0xFF)
    for b in data { chk ^= b }
    return [0x55, 0x55, command, UInt8(data.count & 0xFF)] + data + [chk, 0xAA, 0xAA]
}

public final class B1Emulator {
    public var battery: UInt8
    public var modelId: UInt16
    /// 답하지 않을 요청 (시간 초과 흉내)
    public var silent: Set<UInt8>

    public private(set) var received: [UInt8] = []
    public private(set) var writes = 0
    public private(set) var requests: [UInt8] = []
    public private(set) var printed: [B1Page] = []
    /// 마지막 write에서 일어난 일
    public private(set) var lastEvents: [B1Event] = []

    private var buffer: [UInt8] = []
    private var density = 3
    private var labelType = 1

    private struct PageState {
        var rows = 0
        var cols = 0
        var copies = 1
        var rasterRows = 0
        var bitmap: [UInt8] = []
        var done = false
    }

    private var page: PageState?
    private var out: [[UInt8]] = []

    public init(battery: UInt8 = 100, modelId: UInt16 = b1ModelId, silent: Set<UInt8> = []) {
        self.battery = battery
        self.modelId = modelId
        self.silent = silent
    }

    /// 프린터에 바이트를 쓴다 — 이 쓰기로 생긴 답(알림 바이트)을 순서대로 돌려준다
    public func write(_ bytes: [UInt8]) -> [[UInt8]] {
        writes += 1
        received.append(contentsOf: bytes)
        buffer.append(contentsOf: bytes)
        out = []
        lastEvents = []
        parse()
        return out
    }

    /// 연결이 끊겼다 — 반쯤 받은 패킷은 버린다 (TS 가짜에는 없는 일: 진짜 기기가 새 연결에서 처음부터 읽는 것을 흉내)
    public func dropLink() {
        buffer = []
    }

    public func reset() {
        buffer = []
        received = []
        writes = 0
        requests = []
        printed = []
        page = nil
    }

    private func reply(_ command: UInt8, _ data: [UInt8]) {
        out.append(niimbotPacket(command, data))
    }

    private func notSupported() { reply(B1Response.notSupported, [1]) }

    private func at(_ data: ArraySlice<UInt8>, _ i: Int) -> UInt8? {
        let idx = data.startIndex + i
        return idx < data.endIndex ? data[idx] : nil
    }

    private func u16(_ hi: UInt8?, _ lo: UInt8?) -> Int { (Int(hi ?? 0) << 8) | Int(lo ?? 0) }

    private func handle(_ cmd: UInt8, _ data: ArraySlice<UInt8>) {
        requests.append(cmd)
        if silent.contains(cmd) { return }
        switch cmd {
        case B1Command.connect:
            reply(B1Response.connect, [connectResultConnectedNew])
        case B1Command.printerInfo:
            if at(data, 0) == printerInfoModelId {
                reply(B1Response.printerCode, [UInt8((modelId >> 8) & 0xFF), UInt8(modelId & 0xFF)])
            } else if at(data, 0) == printerInfoBattery {
                reply(B1Response.chargeLevel, [battery])
            } else {
                notSupported()
            }
        case B1Command.heartbeat:
            if at(data, 0) == heartbeatAdvanced1 {
                // B1 꼴 13바이트: 9 건너뜀, 덮개(0 = 닫힘), 배터리, 종이(0 = 있음), RFID(1 = 성공)
                reply(B1Response.heartbeatAdvanced1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, battery, 0, 1])
            } else {
                notSupported()
            }
        case B1Command.setDensity:
            density = Int(at(data, 0) ?? UInt8(density))
            reply(B1Response.setDensity, [1])
        case B1Command.setLabelType:
            labelType = Int(at(data, 0) ?? UInt8(labelType))
            reply(B1Response.setLabelType, [1])
        case B1Command.printStart:
            lastEvents.append(.printStart)
            reply(B1Response.printStart, [1])
        case B1Command.pageStart:
            page = PageState()
            lastEvents.append(.pageStart)
            reply(B1Response.pageStart, [1])
        case B1Command.setPageSize:
            if var p = page {
                p.rows = u16(at(data, 0), at(data, 1))
                p.cols = u16(at(data, 2), at(data, 3))
                p.copies = data.count >= 6 ? u16(at(data, 4), at(data, 5)) : 1
                p.bitmap = [UInt8](repeating: 0, count: ((p.cols + 7) / 8) * p.rows)
                page = p
            }
            reply(B1Response.setPageSize, [1])
        case B1Command.printEmptyRow:
            // 일방향: pos u16, repeats
            if var p = page {
                p.rasterRows += Int(at(data, 2) ?? 1)
                page = p
                lastEvents.append(.raster)
            }
        case B1Command.printBitmapRow:
            // 일방향: pos u16, 셈 3바이트, repeats, 줄 바이트
            if var p = page {
                let pos = u16(at(data, 0), at(data, 1))
                let repeats = Int(at(data, 5) ?? 1)
                let row = data.dropFirst(6)
                let width = (p.cols + 7) / 8
                let take = Array(row.prefix(width))
                for r in 0..<repeats {
                    let y = pos + r
                    if y < p.rows {
                        for (i, b) in take.enumerated() { p.bitmap[y * width + i] = b }
                    }
                }
                p.rasterRows += repeats
                page = p
                lastEvents.append(.raster)
            }
        case B1Command.printBitmapRowIndexed:
            // 일방향 (검정 점 6개 이하인 줄): pos u16, 셈 3바이트, repeats, 점 x 자리 u16들
            if var p = page {
                let pos = u16(at(data, 0), at(data, 1))
                let repeats = Int(at(data, 5) ?? 1)
                let width = (p.cols + 7) / 8
                for r in 0..<repeats {
                    let y = pos + r
                    if y >= p.rows { continue }
                    var i = 6
                    while i + 1 < data.count {
                        let x = u16(at(data, i), at(data, i + 1))
                        let idx = y * width + (x >> 3)
                        // TS는 범위 밖 자리에 쓰기를 조용히 무시한다 (Uint8Array) — 같게 한다
                        if idx < p.bitmap.count { p.bitmap[idx] |= UInt8(0x80 >> (x & 7)) }
                        i += 2
                    }
                }
                p.rasterRows += repeats
                page = p
                lastEvents.append(.raster)
            }
        case B1Command.pageEnd:
            if var p = page {
                p.done = true
                page = p
                printed.append(B1Page(rows: p.rows, cols: p.cols, copies: p.copies, density: density, labelType: labelType, rasterRows: p.rasterRows, bitmap: p.bitmap))
                lastEvents.append(.pageEnd(index: printed.count - 1))
            }
            reply(B1Response.pageEnd, [1])
        case B1Command.printStatus:
            let done = page?.done == true
            lastEvents.append(.printStatus(done: done))
            reply(B1Response.printStatus, [0, done ? 1 : 0, done ? 100 : 0, done ? 100 : 0])
        case B1Command.printEnd:
            page = nil
            lastEvents.append(.printEnd)
            reply(B1Response.printEnd, [1])
        default:
            notSupported()
        }
    }

    private func parse() {
        while true {
            // Connect 패킷은 앞에 03이 붙는다 (niimbluelib) — 실제 프린터처럼 건너뛴다
            if buffer.count >= 3 && buffer[0] == 0x03 && buffer[1] == 0x55 && buffer[2] == 0x55 { buffer.removeFirst() }
            if buffer.count < 7 { return }
            if buffer[0] != 0x55 || buffer[1] != 0x55 {
                buffer.removeFirst()
                continue
            }
            let len = Int(buffer[3])
            let total = 7 + len
            if buffer.count < total { return }
            let packet = Array(buffer[0..<total])
            buffer.removeFirst(total)
            if packet[total - 2] != 0xAA || packet[total - 1] != 0xAA { continue }
            handle(packet[2], packet[4..<(4 + len)])
        }
    }
}

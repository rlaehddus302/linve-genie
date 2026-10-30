// 가짜 라벨 프린터 (BLE 주변기기) — 맥이 NIIMBOT B1 또는 Marklife S2·P12인 척 광고하고, 폰 앱이 보낸 바이트에 그 기종처럼 답한다.
// 응답 로직은 FakePrinterCore(TS 가짜 createFakeB1·createFakeBluetooth를 옮긴 것). 받은 그림은 PNG로, 장마다 시각은 JSON 줄로 남긴다.
// 실행: .build/release/fake-printer --mode b1|marklife-s2|marklife-p12 [옵션]  (README.md)
import CoreBluetooth
import FakePrinterCore
import Foundation

// MARK: - 옵션

enum Mode: String {
    case b1
    case marklifeS2 = "marklife-s2"
    case marklifeP12 = "marklife-p12"
    case marklifeP50 = "marklife-p50"
    case marklifeX2 = "marklife-x2"

    var defaultName: String {
        switch self {
        case .b1: return "B1-FAKE"
        case .marklifeS2: return "S2_FAKE_BLE"
        case .marklifeP12: return "P12_FAKE"
        case .marklifeP50: return "P50_FAKE"
        case .marklifeX2: return "X2_FAKE"
        }
    }

    /// GATT 꾸러미 C(fd00): 쓰기 fd01 · 알림 fd02, 흐름 제어 없음 (X2)
    var bundleC: Bool { self == .marklifeX2 }

    var marklifeProtocol: MarklifeProtocol? {
        switch self {
        case .b1: return nil
        case .marklifeS2: return .yxq2
        case .marklifeP12: return .l11
        case .marklifeP50: return .yxq3
        case .marklifeX2: return .yxq8
        }
    }
}

enum MtuSetting {
    case none
    case auto
    case fixed(Int)
}

struct Options {
    var mode: Mode = .b1
    var name: String?
    var out = "out"
    var noCredit = false
    var mtu: MtuSetting = .none
    var noAck = false
    var ackDelayMs = 0
    var alsoB1Service = false
    var noise = false
    var battery: UInt8 = 100
    var modelId: UInt16 = b1ModelId
    var verbose = false
}

let usage = """
쓰는 법: fake-printer --mode <b1|marklife-s2|marklife-p12|marklife-p50|marklife-x2> [옵션]

  --mode b1              NIIMBOT B1인 척 (기본 이름 B1-FAKE)
  --mode marklife-s2     Marklife S2인 척 (YXQ 방식, 기본 이름 S2_FAKE_BLE)
  --mode marklife-p12    Marklife P12인 척 (L11 방식, 기본 이름 P12_FAKE)
  --mode marklife-p50    Marklife P50인 척 (YXQ3 방식, 기본 이름 P50_FAKE)
  --mode marklife-x2     Marklife X2인 척 (YXQ8 방식, GATT 꾸러미 C fd00, 기본 이름 X2_FAKE)
  --name 이름            광고 이름 바꾸기 (앱이 이름 앞자리로 고른다: B1·S2_·P12_)
  --out 폴더             PNG·기록을 둘 폴더 (기본 ./out)
  --no-credit            (Marklife) 흐름 제어 크레딧을 보내지 않는다 (D-N1-12 재현)
  --mtu auto|숫자        (Marklife) 첫 크레딧 뒤에 MTU 알림 02 lo hi를 보낸다 (auto = 연결한 폰의 값)
  --no-ack               (Marklife) 다 받아도 끝 알림 AA를 보내지 않는다 (시간 초과 재현)
  --ack-delay 밀리초     (Marklife) 끝 알림 AA를 늦게 보낸다
  --also-b1-service      (Marklife) 광고에 B1 서비스(e7810a71…)도 싣는다 (B1 목록 겹침 재현)
  --noise                광고에 상관없는 서비스(배터리·HID 등)를 함께 싣는다 — 찾기 목록에 잡음이 섞인 장소 재현
  --battery 0~100        (B1) 배터리 값 (기본 100)
  --model-id 값          (B1) 모델 번호: 숫자 또는 b1(4096)·b1se(4098)·b1pro(4097)·b21(768)·d110(2304). 기본 b1. 다르면 앱이 '다른 기종'으로 거른다
  --verbose              받은 바이트를 16진으로 찍는다
"""

func parseOptions(_ args: [String]) -> Options {
    var o = Options()
    var i = 1
    func value() -> String {
        i += 1
        guard i < args.count else {
            print("값이 빠졌다: \(args[i - 1])\n\n\(usage)")
            exit(2)
        }
        return args[i]
    }
    while i < args.count {
        switch args[i] {
        case "--mode":
            let v = value()
            guard let m = Mode(rawValue: v) else {
                print("모르는 모드: \(v)\n\n\(usage)")
                exit(2)
            }
            o.mode = m
        case "--name": o.name = value()
        case "--out": o.out = value()
        case "--no-credit": o.noCredit = true
        case "--mtu":
            let v = value()
            if v == "auto" { o.mtu = .auto } else if let n = Int(v), n >= 23, n <= 517 { o.mtu = .fixed(n) } else {
                print("MTU는 auto 또는 23~517: \(v)")
                exit(2)
            }
        case "--no-ack": o.noAck = true
        case "--ack-delay": o.ackDelayMs = max(0, Int(value()) ?? 0)
        case "--also-b1-service": o.alsoB1Service = true
        case "--noise": o.noise = true
        case "--battery": o.battery = UInt8(min(100, max(0, Int(value()) ?? 100)))
        case "--model-id":
            let v = value()
            if let id = niimbotModels[v.lowercased()] { o.modelId = id } else if let n = Int(v), n >= 0, n <= 65535 { o.modelId = UInt16(n) } else {
                print("모델은 숫자 또는 \(niimbotModels.keys.sorted().joined(separator: "·")): \(v)")
                exit(2)
            }
        case "--verbose": o.verbose = true
        case "-h", "--help":
            print(usage)
            exit(0)
        default:
            print("모르는 인자: \(args[i])\n\n\(usage)")
            exit(2)
        }
        i += 1
    }
    return o
}

/// --noise: 찾기 목록에 섞이는 상관없는 기기 흉내 (배터리 0x180F · HID 0x1812 · 기기 정보 0x180A)
let noiseServiceUUIDs: [CBUUID] = [CBUUID(string: "180F"), CBUUID(string: "1812"), CBUUID(string: "180A")]

// MARK: - 기록

final class JsonLog {
    private let handle: FileHandle
    let path: String
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init(dir: String) throws {
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        path = (dir as NSString).appendingPathComponent("log.jsonl")
        if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
        guard let h = FileHandle(forWritingAtPath: path) else { throw NSError(domain: "fake-printer", code: 1) }
        h.seekToEndOfFile()
        handle = h
    }

    func time(_ date: Date) -> String { iso.string(from: date) }

    func write(_ fields: [String: Any]) {
        var f = fields
        if f["at"] == nil { f["at"] = time(Date()) }
        guard let data = try? JSONSerialization.data(withJSONObject: f, options: [.sortedKeys]) else { return }
        handle.write(data)
        handle.write(Data([0x0A]))
    }
}

func ms(_ from: Date?, _ to: Date?) -> Any {
    guard let a = from, let b = to else { return NSNull() }
    return Int((b.timeIntervalSince(a) * 1000).rounded())
}

// MARK: - 주변기기

final class FakePrinter: NSObject, CBPeripheralManagerDelegate {
    let options: Options
    let name: String
    let log: JsonLog
    var manager: CBPeripheralManager!

    let b1: B1Emulator?
    let marklife: MarklifeEmulator?

    var writeChar: CBMutableCharacteristic!
    var notifyChar: CBMutableCharacteristic!
    var flowChar: CBMutableCharacteristic?

    /// 보낼 알림 (큐가 차면 기다렸다가 peripheralManagerIsReady에서 보낸다)
    var outbox: [(char: CBMutableCharacteristic, data: [UInt8], sent: ((Date) -> Void)?)] = []
    /// 폰마다 켠 알림
    var subscriptions: [UUID: Set<CBUUID>] = [:]
    var centrals: [UUID: CBCentral] = [:]
    var connections = 0

    // 지연 기록
    var stamp = DateFormatter()
    var b1Job: (index: Int, first: Date, lastWrite: Date?, pageEnd: Date?, done: Date?, writes: Int, bytes: Int, pngs: [String])?
    var b1Jobs = 0
    var marklifeStarted: [Int: (first: Date, writes: Int)] = [:]

    init(options: Options) throws {
        self.options = options
        name = options.name ?? options.mode.defaultName
        log = try JsonLog(dir: options.out)
        if let proto = options.mode.marklifeProtocol {
            var mtu: Int?
            if case .fixed(let n) = options.mtu { mtu = n }
            marklife = MarklifeEmulator(
                proto: proto,
                initialCredits: (options.noCredit || options.mode.bundleC) ? nil : 4,
                creditsPerPacket: (options.noCredit || options.mode.bundleC) ? 0 : 1,
                mtu: mtu,
                ack: (options.noAck || options.ackDelayMs > 0) ? .none : .send
            )
            b1 = nil
        } else {
            b1 = B1Emulator(battery: options.battery, modelId: options.modelId)
            marklife = nil
        }
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        stamp.locale = Locale(identifier: "en_US_POSIX")
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }

    func say(_ text: String) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        print("[\(f.string(from: Date()))] \(text)")
    }

    // MARK: 서비스·광고

    func setUp() {
        manager.removeAllServices()
        var advertised: [CBUUID] = []
        if options.mode == .b1 {
            let char = CBMutableCharacteristic(type: CBUUID(string: b1CharacteristicUUID), properties: [.notify, .writeWithoutResponse], value: nil, permissions: [.writeable])
            let service = CBMutableService(type: CBUUID(string: b1ServiceUUID), primary: true)
            service.characteristics = [char]
            writeChar = char
            notifyChar = char
            manager.add(service)
            advertised.append(service.uuid)
        } else {
            let c = options.mode.bundleC
            let write = CBMutableCharacteristic(type: CBUUID(string: c ? marklifeCWriteUUID : marklifeWriteUUID), properties: [.write, .writeWithoutResponse], value: nil, permissions: [.writeable])
            let notify = CBMutableCharacteristic(type: CBUUID(string: c ? marklifeCNotifyUUID : marklifeNotifyUUID), properties: [.notify], value: nil, permissions: [.readable])
            let service = CBMutableService(type: CBUUID(string: c ? marklifeCServiceUUID : marklifeServiceUUID), primary: true)
            if c {
                service.characteristics = [write, notify]
            } else {
                let flow = CBMutableCharacteristic(type: CBUUID(string: marklifeFlowUUID), properties: [.notify], value: nil, permissions: [.readable])
                service.characteristics = [write, notify, flow]
                flowChar = flow
            }
            writeChar = write
            notifyChar = notify
            manager.add(service)
            advertised.append(service.uuid)
            if options.alsoB1Service { advertised.append(CBUUID(string: b1ServiceUUID)) }
        }
        if options.noise { advertised += noiseServiceUUIDs }
        manager.startAdvertising([CBAdvertisementDataLocalNameKey: name, CBAdvertisementDataServiceUUIDsKey: advertised])
        log.write(["event": "advertise", "mode": options.mode.rawValue, "name": name, "services": advertised.map(\.uuidString)])
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            say("블루투스가 켜졌다. '\(name)'(으)로 광고를 시작한다.")
            setUp()
        case .poweredOff:
            say("맥의 블루투스가 꺼져 있다. 메뉴 막대 또는 시스템 설정에서 블루투스를 켠다.")
        case .unauthorized:
            say("블루투스 권한이 없다. 시스템 설정 → 개인정보 보호 및 보안 → 블루투스에서 이 프로그램(또는 터미널 앱)을 허락한 뒤 다시 실행한다.")
        case .unsupported:
            say("이 맥은 블루투스 주변기기 모드를 지원하지 않는다.")
        case .resetting:
            say("블루투스가 다시 켜지는 중이다.")
        default:
            say("블루투스 상태를 아직 모른다.")
        }
        log.write(["event": "radio", "state": peripheral.state.rawValue])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error { say("서비스를 올리지 못했다: \(error.localizedDescription)") }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error {
            say("광고를 시작하지 못했다: \(error.localizedDescription)")
        } else {
            say("광고 중: 이름 \(name), 서비스 \(options.mode == .b1 ? "e7810a71…" : "\(options.mode.bundleC ? "fd00" : "ff00")\(options.alsoB1Service ? " + e7810a71…" : "")")\(options.noise ? " + 잡음 서비스" : ""). 폰 앱에서 프린터 찾기를 누른다.")
        }
    }

    // MARK: 알림 켜기·끄기 (= 연결·끊김)

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        let id = central.identifier
        let first = subscriptions[id] == nil
        subscriptions[id, default: []].insert(characteristic.uuid)
        centrals[id] = central
        if first {
            connections += 1
            say("폰이 이어졌다 (\(connections)번째, 한 번에 보낼 수 있는 크기 \(central.maximumUpdateValueLength)바이트)")
            log.write(["event": "connect", "central": id.uuidString, "count": connections, "maxUpdate": central.maximumUpdateValueLength])
        }
        log.write(["event": "subscribe", "central": id.uuidString, "char": characteristic.uuid.uuidString])
        if let ml = marklife, options.mode.bundleC, characteristic.uuid == notifyChar.uuid {
            // 꾸러미 C에는 흐름 제어가 없다 — 알림(fd02)을 켜면 연결된 것으로 본다
            if case .auto = options.mtu { ml.mtu = central.maximumUpdateValueLength + 3 }
        }
        if let flow = flowChar, characteristic.uuid == flow.uuid, let ml = marklife {
            if case .auto = options.mtu { ml.mtu = central.maximumUpdateValueLength + 3 }
            for out in ml.onFlowSubscribed() { send(out.bytes, on: flow) }
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        let id = central.identifier
        subscriptions[id]?.remove(characteristic.uuid)
        log.write(["event": "unsubscribe", "central": id.uuidString, "char": characteristic.uuid.uuidString])
        if subscriptions[id]?.isEmpty ?? true {
            subscriptions[id] = nil
            centrals[id] = nil
            say("폰과 끊겼다 (알림이 모두 꺼졌다). 다시 이으면 이어서 받는다.")
            log.write(["event": "disconnect", "central": id.uuidString])
            if subscriptions.isEmpty {
                b1?.dropLink()
                marklife?.dropLink()
                outbox.removeAll()
                if let job = b1Job {
                    log.write(["event": "job-incomplete", "mode": options.mode.rawValue, "job": job.index, "firstWriteAt": log.time(job.first), "writes": job.writes, "bytes": job.bytes])
                    b1Job = nil
                }
            }
        }
    }

    // MARK: 쓰기

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        let now = Date()
        for request in requests {
            guard request.characteristic.uuid == writeChar.uuid, let value = request.value else { continue }
            let bytes = [UInt8](value)
            if options.verbose { say("받음 \(bytes.count)바이트: \(hexString(bytes))") }
            if let b1 { handleB1(bytes, at: now, printer: b1) }
            if let marklife { handleMarklife(bytes, at: now, printer: marklife) }
        }
        // 응답 있는 쓰기(write)면 답한다. 응답 없는 쓰기에는 무시된다
        if let first = requests.first { peripheral.respond(to: first, withResult: .success) }
    }

    func handleB1(_ bytes: [UInt8], at now: Date, printer: B1Emulator) {
        let replies = printer.write(bytes)
        if var job = b1Job {
            job.writes += 1
            job.bytes += bytes.count
            b1Job = job
        }
        for event in printer.lastEvents {
            switch event {
            case .printStart:
                b1Jobs += 1
                b1Job = (b1Jobs, now, nil, nil, nil, 1, bytes.count, [])
                say("출력 시작 (\(b1Jobs)번째)")
            case .raster:
                b1Job?.lastWrite = now
            case .pageEnd(let index):
                b1Job?.lastWrite = now
                b1Job?.pageEnd = now
                let page = printer.printed[index]
                let path = savePNG(page.bitmapImage, index: b1Jobs)
                if let path { b1Job?.pngs.append(path) }
                say("쪽을 다 받았다: \(page.cols)×\(page.rows)점, 농도 \(page.density), 검정 점 \(page.bitmapImage.blackDots)개 → \(path ?? "PNG 저장 실패")")
            default:
                break
            }
        }
        for reply in replies {
            send(reply, on: notifyChar) { [weak self] sentAt in self?.b1ReplySent(reply, at: sentAt) }
        }
    }

    func b1ReplySent(_ reply: [UInt8], at sentAt: Date) {
        guard reply.count >= 4 else { return }
        if reply[2] == B1Response.printStatus, reply.count > 5, reply[5] == 1, b1Job?.done == nil, b1Job != nil {
            b1Job?.done = sentAt
        }
        if reply[2] == B1Response.printEnd, let job = b1Job {
            log.write([
                "event": "job", "mode": options.mode.rawValue, "job": job.index,
                "firstWriteAt": log.time(job.first), "lastWriteAt": job.lastWrite.map(log.time) ?? NSNull(),
                "doneReplyAt": job.done.map(log.time) ?? NSNull(), "endReplyAt": log.time(sentAt),
                "firstToLastWriteMs": ms(job.first, job.lastWrite), "lastWriteToEndMs": ms(job.lastWrite, sentAt), "totalMs": ms(job.first, sentAt),
                "writes": job.writes, "bytes": job.bytes, "png": job.pngs,
            ])
            say("출력 끝 답을 보냈다 (\(job.index)번째, 처음 쓰기부터 \(ms(job.first, sentAt))ms)")
            b1Job = nil
        }
    }

    func handleMarklife(_ bytes: [UInt8], at now: Date, printer: MarklifeEmulator) {
        let before = printer.attempts.count
        let outputs = printer.write(bytes)
        // 새로 생긴 시도의 첫 쓰기 시각
        if printer.attempts.count > before {
            for a in printer.attempts[before...] {
                marklifeStarted[a.index] = (now, a.writes)
                if a.index == printer.attempts.count { say("출력 받기 시작 (\(a.index)번째 시도)") }
            }
        }
        for out in outputs {
            let char = out.channel == .flow ? flowChar! : notifyChar!
            if out.channel == .notify, out.bytes == [0xAA], let attempt = printer.completedInLastWrite.last {
                send(out.bytes, on: char) { [weak self] sentAt in self?.marklifeJobLog(attempt, lastWrite: now, ack: sentAt) }
            } else {
                send(out.bytes, on: char)
            }
        }
        for attempt in printer.completedInLastWrite {
            let path: String?
            do {
                let (bitmap, window) = try decodeMarklifeJob(printer.proto, attempt.jobBytes(printer.proto))
                path = savePNG(bitmap, index: attempt.index)
                let windowText = window.map { "zlib 창 \($0)비트" } ?? "압축 없음"
                say("작업을 다 받았다 (\(attempt.index)번째): \(bitmap.width)×\(bitmap.height)점, \(windowText), 검정 점 \(bitmap.blackDots)개 → \(path ?? "PNG 저장 실패")")
                if let w = window, w != 10 { say("주의: zlib 창이 \(w)비트다. 진짜 YXQ 프린터는 창 10비트(첫 바이트 28)가 아니면 버린다.") }
            } catch {
                path = nil
                say("작업을 다 받았지만 그림을 풀지 못했다: \(error)")
            }
            if let p = path { pngByAttempt[attempt.index] = p }
            if options.ackDelayMs > 0 && !options.noAck {
                let delay = options.ackDelayMs
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(delay)) { [weak self] in
                    guard let self, !self.subscriptions.isEmpty else { return }
                    printer.markAcked(attempt)
                    self.send([0xAA], on: self.notifyChar) { [weak self] sentAt in self?.marklifeJobLog(attempt, lastWrite: now, ack: sentAt) }
                }
            } else if options.noAck {
                marklifeJobLog(attempt, lastWrite: now, ack: nil)
            }
        }
    }

    var pngByAttempt: [Int: String] = [:]

    func marklifeJobLog(_ attempt: MarklifeAttempt, lastWrite: Date, ack: Date?) {
        let first = marklifeStarted[attempt.index]?.first
        log.write([
            "event": "job", "mode": options.mode.rawValue, "job": attempt.index,
            "firstWriteAt": first.map(log.time) ?? NSNull(), "lastWriteAt": log.time(lastWrite), "endReplyAt": ack.map(log.time) ?? NSNull(),
            "firstToLastWriteMs": ms(first, lastWrite), "lastWriteToEndMs": ms(lastWrite, ack), "totalMs": ms(first, ack ?? lastWrite),
            "writes": attempt.writes, "bytes": attempt.bytes.count, "png": pngByAttempt[attempt.index].map { [$0] } ?? [],
        ])
        say(ack == nil ? "끝 알림을 보내지 않았다 (\(attempt.index)번째, --no-ack)" : "끝 알림 AA를 보냈다 (\(attempt.index)번째, 처음 쓰기부터 \(ms(first, ack))ms)")
    }

    // MARK: 알림 보내기

    func send(_ bytes: [UInt8], on char: CBMutableCharacteristic, sent: ((Date) -> Void)? = nil) {
        outbox.append((char, bytes, sent))
        flush()
    }

    func flush() {
        while let next = outbox.first {
            let subscribed = centrals.values.filter { subscriptions[$0.identifier]?.contains(next.char.uuid) == true }
            if subscribed.isEmpty {
                // 알림을 켜지 않은 특성 — 진짜 기기처럼 버린다
                outbox.removeFirst()
                continue
            }
            if !manager.updateValue(Data(next.data), for: next.char, onSubscribedCentrals: subscribed) { return }
            outbox.removeFirst()
            if options.verbose { say("보냄 \(next.char.uuid.uuidString): \(hexString(next.data))") }
            next.sent?(Date())
        }
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        flush()
    }

    func savePNG(_ bitmap: Bitmap, index: Int) -> String? {
        let file = "\(options.mode.rawValue)-\(stamp.string(from: Date()))-\(index).png"
        let path = (options.out as NSString).appendingPathComponent(file)
        return FileManager.default.createFile(atPath: path, contents: Data(encodePNG(bitmap))) ? path : nil
    }
}

// MARK: - 시작

let options = parseOptions(CommandLine.arguments)
setvbuf(stdout, nil, _IOLBF, 0)
let printer: FakePrinter
do {
    printer = try FakePrinter(options: options)
} catch {
    print("기록 폴더를 만들지 못했다: \(options.out)")
    exit(1)
}
print("가짜 프린터: \(options.mode.rawValue) · 이름 \(printer.name) · 기록 \(printer.log.path)")
print("멈추려면 Ctrl+C")
signal(SIGINT, SIG_IGN)
let stop = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
stop.setEventHandler {
    printer.manager.stopAdvertising()
    printer.log.write(["event": "stop"])
    print("\n광고를 멈췄다.")
    exit(0)
}
stop.resume()
RunLoop.main.run()

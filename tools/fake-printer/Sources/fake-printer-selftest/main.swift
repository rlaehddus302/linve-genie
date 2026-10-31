// 자체 시험 — test/golden/*.json(TS 가짜가 만든 정답)과 Swift 응답 로직을 맞춰 본다.
// 같은 쓰기 조각에 같은 알림이 같은 순서로 나오는지, 받은 그림의 점이 같은지, 그 그림을 PNG로 저장해 다시 읽어도 점이 같은지.
// 실행: swift run fake-printer-selftest [골든 폴더]  — 블루투스를 쓰지 않는다.
import CoreGraphics
import FakePrinterCore
import Foundation
import ImageIO

struct Step: Decodable {
    let write: String
    let notify: [NotifyEntry]
}

/// B1 골든은 알림이 글("5555…"), Marklife 골든은 {char, bytes}
enum NotifyEntry: Decodable {
    case plain(String)
    case channel(String, String)

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let s = try? single.decode(String.self) {
            self = .plain(s)
            return
        }
        struct Pair: Decodable {
            let char: String
            let bytes: String
        }
        let p = try single.decode(Pair.self)
        self = .channel(p.char, p.bytes)
    }

    var text: String {
        switch self {
        case .plain(let s): return s
        case .channel(let c, let b): return "\(c):\(b)"
        }
    }
}

struct GoldenPage: Decodable {
    let rows: Int
    let cols: Int
    let copies: Int
    let density: Int
    let labelType: Int
    let rasterRows: Int
    let bitmap: String
}

struct GoldenJob: Decodable {
    let width: Int
    let height: Int
    let bitmap: String
    let length: Int
}

struct GoldenAttempt: Decodable {
    let complete: Bool
    let acked: Bool
    let length: Int
}

struct GoldenOptions: Decodable {
    let initialCredits: Int?
    let creditsPerPacket: Int
    let mtu: Int?
    /// 끝 알림: send(AA, 기본) · ok(4F 4B)
    let ack: String?
}

struct Golden: Decodable {
    let kind: String
    let bundle: String?
    let steps: [Step]
    let pages: [GoldenPage]?
    let `protocol`: String?
    let options: GoldenOptions?
    let onSubscribe: [NotifyEntry]?
    let jobs: [GoldenJob]?
    let attempts: [GoldenAttempt]?
}

var failures = 0
var checks = 0

func check(_ ok: Bool, _ message: @autoclosure () -> String) {
    checks += 1
    if !ok {
        failures += 1
        print("  실패: \(message())")
    }
}

/// PNG를 ImageIO로 다시 읽어 점(검정 = 밝기 < 128)을 비교한다
func pngMatches(_ png: [UInt8], _ bitmap: Bitmap) -> String? {
    guard let source = CGImageSourceCreateWithData(Data(png) as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        return "PNG를 읽지 못했다"
    }
    guard image.width == bitmap.width, image.height == bitmap.height else { return "PNG 크기 \(image.width)×\(image.height) ≠ \(bitmap.width)×\(bitmap.height)" }
    var gray = [UInt8](repeating: 0, count: image.width * image.height)
    let ok = gray.withUnsafeMutableBytes { buf -> Bool in
        guard let ctx = CGContext(data: buf.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return true
    }
    guard ok else { return "그리기 판을 만들지 못했다" }
    var diff = 0
    for y in 0..<bitmap.height {
        for x in 0..<bitmap.width where (gray[y * bitmap.width + x] < 128) != bitmap.pixel(x, y) { diff += 1 }
    }
    return diff == 0 ? nil : "PNG 점 \(diff)개가 다르다"
}

func runB1(_ name: String, _ g: Golden) {
    let printer = B1Emulator()
    for (i, step) in g.steps.enumerated() {
        let got = printer.write(bytesFromHex(step.write)).map(hexString)
        let want = step.notify.map(\.text)
        check(got == want, "\(name) 조각 \(i + 1): 답 \(got) ≠ \(want)")
    }
    let pages = g.pages ?? []
    check(printer.printed.count == pages.count, "\(name): 쪽 수 \(printer.printed.count) ≠ \(pages.count)")
    for (i, (got, want)) in zip(printer.printed, pages).enumerated() {
        check(got.rows == want.rows && got.cols == want.cols && got.copies == want.copies, "\(name) 쪽 \(i + 1): 크기 \(got.rows)×\(got.cols)")
        check(got.density == want.density && got.labelType == want.labelType, "\(name) 쪽 \(i + 1): 농도·라벨 종류")
        check(got.rasterRows == want.rasterRows, "\(name) 쪽 \(i + 1): 래스터 줄 \(got.rasterRows) ≠ \(want.rasterRows)")
        check(hexString(got.bitmap) == want.bitmap, "\(name) 쪽 \(i + 1): 점이 다르다")
        if let problem = pngMatches(encodePNG(got.bitmapImage), Bitmap(width: want.cols, height: want.rows, data: bytesFromHex(want.bitmap))) {
            check(false, "\(name) 쪽 \(i + 1): \(problem)")
        } else {
            check(true, "")
        }
    }
    print("\(name): 조각 \(g.steps.count)개, 쪽 \(printer.printed.count)개")
}

func runMarklife(_ name: String, _ g: Golden) {
    guard let protoName = g.protocol, let proto = MarklifeProtocol(rawValue: protoName), let options = g.options else {
        check(false, "\(name): 방식·옵션이 없다")
        return
    }
    let printer = MarklifeEmulator(
        proto: proto,
        initialCredits: options.initialCredits.map { UInt8($0) },
        creditsPerPacket: UInt8(options.creditsPerPacket),
        mtu: options.mtu,
        ack: options.ack == "ok" ? .ok : .send
    )
    // 알림 켜기 순서: ff01 → ff03 (첫 크레딧·MTU는 ff03을 켤 때)
    let channelName = { (c: MarklifeChannel) in c == .notify && g.bundle == "C" ? "fd02" : c.rawValue }
    let subscribed = printer.onFlowSubscribed().map { "\(channelName($0.channel)):\(hexString($0.bytes))" }
    check(subscribed == (g.onSubscribe ?? []).map(\.text), "\(name): 알림 켤 때 \(subscribed)")
    var completed: [MarklifeAttempt] = []
    for (i, step) in g.steps.enumerated() {
        let got = printer.write(bytesFromHex(step.write)).map { "\(channelName($0.channel)):\(hexString($0.bytes))" }
        let want = step.notify.map(\.text)
        check(got == want, "\(name) 조각 \(i + 1): 답 \(got) ≠ \(want)")
        completed += printer.completedInLastWrite
    }
    let attempts = g.attempts ?? []
    check(printer.attempts.count == attempts.count, "\(name): 시도 수 \(printer.attempts.count) ≠ \(attempts.count)")
    for (i, (got, want)) in zip(printer.attempts, attempts).enumerated() {
        check(got.complete == want.complete && got.acked == want.acked && got.bytes.count == want.length, "\(name) 시도 \(i + 1): 끝·AA·길이")
    }
    let jobs = g.jobs ?? []
    check(completed.count == jobs.count, "\(name): 끝까지 받은 작업 \(completed.count) ≠ \(jobs.count)")
    for (i, (attempt, want)) in zip(completed, jobs).enumerated() {
        do {
            let (bitmap, windowBits) = try decodeMarklifeJob(proto, attempt.jobBytes(proto))
            check(bitmap.width == want.width && bitmap.height == want.height, "\(name) 작업 \(i + 1): 크기 \(bitmap.width)×\(bitmap.height) ≠ \(want.width)×\(want.height)")
            check(hexString(bitmap.data) == want.bitmap, "\(name) 작업 \(i + 1): 점이 다르다")
            if !proto.rawRaster { check(windowBits == 10, "\(name) 작업 \(i + 1): zlib 창 \(String(describing: windowBits)) ≠ 10") }
            check(attempt.jobBytes(proto).count == want.length, "\(name) 작업 \(i + 1): 작업 길이")
            if let problem = pngMatches(encodePNG(bitmap), Bitmap(width: want.width, height: want.height, data: bytesFromHex(want.bitmap))) {
                check(false, "\(name) 작업 \(i + 1): \(problem)")
            }
        } catch {
            check(false, "\(name) 작업 \(i + 1): \(error)")
        }
    }
    print("\(name): 조각 \(g.steps.count)개, 끝까지 받은 작업 \(completed.count)개")
}

/// 골든 밖의 작은 시험들
func runUnit() {
    // 패킷 바이트 (niimbluelib NiimbotPacket(0x10, [1, 2]) = 55 55 10 02 01 02 11 aa aa)
    check(niimbotPacket(0x10, [1, 2]) == [0x55, 0x55, 0x10, 0x02, 0x01, 0x02, 0x11, 0xAA, 0xAA], "패킷 바이트")
    // 모르는 요청 → 지원 안 함, 조용히 할 요청은 답 없음
    let silent = B1Emulator(silent: [B1Command.heartbeat])
    check(silent.write(niimbotPacket(B1Command.heartbeat, [1])).isEmpty, "조용히 할 요청")
    check(silent.write(niimbotPacket(0x77, [])) == [niimbotPacket(B1Response.notSupported, [1])], "모르는 요청")
    // 모델 번호 바꾸기
    let other = B1Emulator(modelId: 0x1234)
    check(other.write(niimbotPacket(B1Command.printerInfo, [8])) == [niimbotPacket(B1Response.printerCode, [0x12, 0x34])], "모델 번호")
    // NIIMBOT 모델 번호 표 (--model-id 이름): 앱이 같은 번호로 기종을 가른다
    check(niimbotModels.map { "\($0.key)=\($0.value)" }.sorted() == ["b1=4096", "b1pro=4097", "b1se=4098", "b21=768", "d110=2304"], "NIIMBOT 모델 번호 표")
    for (_, id) in niimbotModels {
        let model = B1Emulator(modelId: id)
        check(model.write(niimbotPacket(B1Command.printerInfo, [8])) == [niimbotPacket(B1Response.printerCode, [UInt8(id >> 8), UInt8(id & 0xFF)])], "모델 번호 \(id) 답")
    }
    // 끊긴 뒤 반쪽 패킷은 버린다
    let dropped = B1Emulator()
    _ = dropped.write([0x55, 0x55, B1Command.connect])
    dropped.dropLink()
    check(dropped.write(niimbotPacket(B1Command.connect, [1])) == [niimbotPacket(B1Response.connect, [2])], "끊긴 뒤 새로 읽기")
    // PNG: 폭이 8의 배수가 아닌 그림
    let odd = Bitmap(width: 3, height: 2, data: [0b1010_0000, 0b0100_0000])
    check(pngMatches(encodePNG(odd), odd) == nil, "폭 3 PNG")
    // 크레딧 없는 Marklife도 작업 끝에 AA
    let quiet = MarklifeEmulator(proto: .yxq2, initialCredits: nil, creditsPerPacket: 0, ack: .none)
    check(quiet.onFlowSubscribed().isEmpty, "크레딧 안 보내기")
    // 짧은 L11 작업 (1바이트 × 2줄) → 끝 알림 없음(ack none), 끝까지 받음
    let l11Job: [UInt8] = [UInt8](repeating: 0, count: 15) + [0x10, 0xFF, 0xF1, 0x02, 0x1D, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0x80, 0x01, 0x1D, 0x0C, 0x10, 0xFF, 0xF1, 0x45]
    let l11 = MarklifeEmulator(proto: .l11, ack: .none)
    check(l11.write(l11Job) == [MarklifeOutput(.flow, [1, 1])], "L11 ack none")
    check(l11.attempts.first?.complete == true && l11.attempts.first?.acked == false, "L11 끝까지 받음, AA 없음")
    if let a = l11.attempts.first, let decoded = try? decodeMarklifeJob(.l11, a.jobBytes(.l11)) {
        check(decoded.bitmap == Bitmap(width: 8, height: 2, data: [0x80, 0x01]), "L11 풀기")
    } else {
        check(false, "L11 풀기")
    }
    // 바우아토(Luck Jingle, D-PRN2-02): 켜기 · 깨우기 00×12 · 위치 맞춤 시작 · 래스터 · 다음 라벨 · 위치 맞춤 끝 · 작업 끝 → OK 끝 알림(D-PRN2-03)
    let ljJob: [UInt8] = [0x10, 0xFF, 0xF1, 0x03] + [UInt8](repeating: 0, count: 12) + [0x1F, 0x11, 0x51, 0x1D, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0x80, 0x01, 0x1D, 0x0C, 0x1F, 0x11, 0x50, 0x10, 0xFF, 0xF1, 0x45]
    check(marklifeJobLength(.luckJingle, ljJob) == ljJob.count, "Luck Jingle 작업 길이")
    let lj = MarklifeEmulator(proto: .luckJingle, initialCredits: nil, creditsPerPacket: 0, ack: .ok)
    check(lj.write(Array(ljJob.prefix(10))) == [], "Luck Jingle 앞 조각 — 아직 끝 아님")
    check(lj.write(Array(ljJob.dropFirst(10))) == [MarklifeOutput(.notify, [0x4F, 0x4B])], "Luck Jingle OK 끝 알림")
    check(lj.attempts.count == 1 && lj.attempts.first?.complete == true && lj.attempts.first?.acked == true, "Luck Jingle 끝까지 받음, OK = 끝")
    if let a = lj.attempts.first, let decoded = try? decodeMarklifeJob(.luckJingle, a.jobBytes(.luckJingle)) {
        check(decoded.bitmap == Bitmap(width: 8, height: 2, data: [0x80, 0x01]), "Luck Jingle 풀기")
    } else {
        check(false, "Luck Jingle 풀기")
    }
    // 끝 알림 판정 (골든 end와 같은 규칙)
    check(marklifeIsEndNotice(.luckJingle, [0x4F, 0x4B]) && marklifeIsEndNotice(.yxq2, [0xAA]), "끝 알림: OK(Luck Jingle)·AA")
    check(!marklifeIsEndNotice(.yxq2, [0x4F, 0x4B]) && !marklifeIsEndNotice(.luckJingle, [0x6F, 0x6B]) && !marklifeIsEndNotice(.luckJingle, [0xAA, 0xAA]) && !marklifeIsEndNotice(.l11, []), "끝 알림 아님: Marklife OK·ok·AA AA·빈 값")
    // Marklife에 OK를 보내면 끝으로 세지 않는다 (acked false)
    let mlOk = MarklifeEmulator(proto: .l11, initialCredits: nil, creditsPerPacket: 0, ack: .ok)
    check(mlOk.write(l11Job) == [MarklifeOutput(.notify, [0x4F, 0x4B])] && mlOk.attempts.first?.acked == false, "L11에 OK — 끝 아님")
    print("작은 시험: 끝")
}

let args = CommandLine.arguments
let defaultDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("test/golden")
let dir = args.count > 1 ? URL(fileURLWithPath: args[1]) : defaultDir
let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".json") }.sorted()
if files.isEmpty {
    print("골든 파일이 없다: \(dir.path) — node tools/fake-printer/test/make-golden.mjs 로 만든다")
    exit(2)
}
for file in files {
    let name = String(file.dropLast(5))
    do {
        let golden = try JSONDecoder().decode(Golden.self, from: Data(contentsOf: dir.appendingPathComponent(file)))
        if golden.kind == "b1" { runB1(name, golden) } else { runMarklife(name, golden) }
    } catch {
        check(false, "\(file): 읽지 못했다 \(error)")
    }
}
runUnit()
print(failures == 0 ? "통과: 확인 \(checks)개" : "실패 \(failures)개 / 확인 \(checks)개")
exit(failures == 0 ? 0 : 1)

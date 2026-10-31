// 받은 작업 바이트 → 1비트 그림 (packages/printer/src/job.ts의 래스터 꼴을 거꾸로 푼다).
// YXQ 래스터 = 1F 10 + 한 줄 바이트 수(BE16) + 높이(BE16) + 압축 길이(BE32) + zlib(창 1KiB, 첫 바이트 28)
// L11 래스터 = 1D 76 30 00 + 한 줄 바이트 수(LE16) + 높이(LE16) + 줄 그대로
// 푼 그림은 프린터 헤드 방향 그대로다(L11은 앱이 시계 방향 90도로 돌려 보낸 그림).
import Foundation

/// 1비트 그림 — 줄마다 ceil(width/8) 바이트, 왼쪽 점이 높은 비트, 1 = 검정
public struct Bitmap: Equatable {
    public let width: Int
    public let height: Int
    public let data: [UInt8]

    public init(width: Int, height: Int, data: [UInt8]) {
        self.width = width
        self.height = height
        self.data = data
    }

    public var rowBytes: Int { (width + 7) / 8 }

    public func pixel(_ x: Int, _ y: Int) -> Bool {
        let b = data[y * rowBytes + (x >> 3)]
        return b & UInt8(0x80 >> (x & 7)) != 0
    }

    public var blackDots: Int {
        var n = 0
        for y in 0..<height { for x in 0..<width where pixel(x, y) { n += 1 } }
        return n
    }
}

public enum RasterError: Error, CustomStringConvertible {
    case badHeader(String)
    case inflateFailed(String)
    case wrongSize(expected: Int, got: Int)

    public var description: String {
        switch self {
        case .badHeader(let s): return "래스터 머리가 맞지 않다: \(s)"
        case .inflateFailed(let s): return "압축을 풀지 못했다: \(s)"
        case .wrongSize(let e, let g): return "풀어 낸 크기가 다르다 (기대 \(e), 받음 \(g))"
        }
    }
}

/// zlib 스트림(머리 2바이트 + deflate + adler32)을 푼다. 창 크기와 상관없이 풀린다(raw deflate로 푼다)
public func zlibInflate(_ stream: [UInt8]) throws -> [UInt8] {
    guard stream.count >= 6 else { throw RasterError.inflateFailed("너무 짧다") }
    let cmf = stream[0], flg = stream[1]
    guard cmf & 0x0F == 8, (UInt16(cmf) << 8 | UInt16(flg)) % 31 == 0 else { throw RasterError.inflateFailed("zlib 머리가 아니다") }
    let raw = Data(stream[2..<(stream.count - 4)]) as NSData
    let inflated: Data
    do {
        inflated = try raw.decompressed(using: .zlib) as Data
    } catch {
        throw RasterError.inflateFailed(String(describing: error))
    }
    let out = [UInt8](inflated)
    // adler32 확인
    var a: UInt32 = 1, b: UInt32 = 0
    for byte in out {
        a = (a + UInt32(byte)) % 65521
        b = (b + a) % 65521
    }
    let tail = stream.suffix(4)
    let want = tail.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard want == (b << 16 | a) else { throw RasterError.inflateFailed("adler32가 다르다") }
    return out
}

/// zlib 머리의 창 크기 (비트 수 — 첫 바이트 28이면 10)
public func zlibWindowBits(_ stream: [UInt8]) -> Int? {
    guard let cmf = stream.first, cmf & 0x0F == 8 else { return nil }
    return Int(cmf >> 4) + 8
}

/// 끝까지 받은 Marklife 작업 → 그림
public func decodeMarklifeJob(_ p: MarklifeProtocol, _ bytes: [UInt8]) throws -> (bitmap: Bitmap, windowBits: Int?) {
    func at(_ i: Int) -> Int { i < bytes.count ? Int(bytes[i]) : 0 }
    if p.rawRaster {
        let head = 19
        guard bytes.count >= head + 8, at(head) == 0x1D, at(head + 1) == 0x76, at(head + 2) == 0x30, at(head + 3) == 0x00 else {
            throw RasterError.badHeader("1D 76 30 00이 아니다")
        }
        let wb = at(head + 4) | (at(head + 5) << 8)
        let h = at(head + 6) | (at(head + 7) << 8)
        let start = head + 8
        guard bytes.count >= start + wb * h else { throw RasterError.wrongSize(expected: wb * h, got: bytes.count - start) }
        return (Bitmap(width: wb * 8, height: h, data: Array(bytes[start..<(start + wb * h)])), nil)
    }
    let head = p == .yxq2 ? 8 : 21
    guard bytes.count >= head + 10, at(head) == 0x1F, at(head + 1) == 0x10 else { throw RasterError.badHeader("1F 10이 아니다") }
    let wb = (at(head + 2) << 8) | at(head + 3)
    let h = (at(head + 4) << 8) | at(head + 5)
    let length = (at(head + 6) << 24) | (at(head + 7) << 16) | (at(head + 8) << 8) | at(head + 9)
    let start = head + 10
    guard bytes.count >= start + length else { throw RasterError.wrongSize(expected: length, got: bytes.count - start) }
    let stream = Array(bytes[start..<(start + length)])
    let rows = try zlibInflate(stream)
    guard rows.count == wb * h else { throw RasterError.wrongSize(expected: wb * h, got: rows.count) }
    return (Bitmap(width: wb * 8, height: h, data: rows), zlibWindowBits(stream))
}

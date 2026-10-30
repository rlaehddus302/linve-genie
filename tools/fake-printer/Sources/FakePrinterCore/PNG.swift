// 1비트 그림 → PNG (회색조 1비트, 검정 점 = 0). 압축 없는 deflate 블록으로 쓴다 — 외부 모듈 없이 결정적이다.
// 폭 밖의 남는 비트는 흰색(1)으로 채운다.

private let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
}

func crc32(_ bytes: [UInt8]) -> UInt32 {
    var c: UInt32 = 0xFFFF_FFFF
    for b in bytes { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
    return c ^ 0xFFFF_FFFF
}

func adler32(_ bytes: [UInt8]) -> UInt32 {
    var a: UInt32 = 1, b: UInt32 = 0
    for byte in bytes {
        a = (a + UInt32(byte)) % 65521
        b = (b + a) % 65521
    }
    return b << 16 | a
}

private func be32(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24 & 0xFF), UInt8(v >> 16 & 0xFF), UInt8(v >> 8 & 0xFF), UInt8(v & 0xFF)] }

private func chunk(_ type: String, _ data: [UInt8]) -> [UInt8] {
    let typeBytes = Array(type.utf8)
    return be32(UInt32(data.count)) + typeBytes + data + be32(crc32(typeBytes + data))
}

/// 압축 없는 zlib 스트림 (78 01 + 저장 블록들 + adler32)
func zlibStored(_ data: [UInt8]) -> [UInt8] {
    var out: [UInt8] = [0x78, 0x01]
    var at = 0
    repeat {
        let n = min(65535, data.count - at)
        let last: UInt8 = at + n >= data.count ? 1 : 0
        out.append(last)
        out += [UInt8(n & 0xFF), UInt8(n >> 8), UInt8(~n & 0xFF), UInt8((~n >> 8) & 0xFF)]
        out += data[at..<(at + n)]
        at += n
    } while at < data.count
    return out + be32(adler32(data))
}

public func encodePNG(_ bitmap: Bitmap) -> [UInt8] {
    let rowBytes = bitmap.rowBytes
    let spare = rowBytes * 8 - bitmap.width
    let padMask: UInt8 = spare > 0 ? UInt8((1 << spare) - 1) : 0
    var raw: [UInt8] = []
    raw.reserveCapacity((rowBytes + 1) * bitmap.height)
    for y in 0..<bitmap.height {
        raw.append(0) // 필터 없음
        for i in 0..<rowBytes {
            var b = ~bitmap.data[y * rowBytes + i]
            if i == rowBytes - 1 { b |= padMask }
            raw.append(b)
        }
    }
    let ihdr = be32(UInt32(bitmap.width)) + be32(UInt32(bitmap.height)) + [1, 0, 0, 0, 0]
    // 203dpi = 7992 점/미터 (pHYs)
    let phys = be32(7992) + be32(7992) + [1]
    return [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] + chunk("IHDR", ihdr) + chunk("pHYs", phys) + chunk("IDAT", zlibStored(raw)) + chunk("IEND", [])
}

// 바이트 ↔ 16진 글
public func hexString(_ bytes: [UInt8]) -> String {
    let digits = Array("0123456789abcdef")
    var s = ""
    s.reserveCapacity(bytes.count * 2)
    for b in bytes {
        s.append(digits[Int(b >> 4)])
        s.append(digits[Int(b & 0x0F)])
    }
    return s
}

public func bytesFromHex(_ text: String) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(text.utf8.count / 2)
    var hi: UInt8?
    for c in text.utf8 {
        let v: UInt8
        switch c {
        case 48...57: v = c - 48
        case 97...102: v = c - 87
        case 65...70: v = c - 55
        default: continue
        }
        if let h = hi {
            out.append(h << 4 | v)
            hi = nil
        } else {
            hi = v
        }
    }
    return out
}

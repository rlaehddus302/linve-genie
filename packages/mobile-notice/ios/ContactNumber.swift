// 저장된 연락처 이름 → 휴대폰 번호 (D-SMS-CONTACT, 사용자 지시 2026-11-11 "문자찜 받았는데 상품 탭에 안 뜬다 … 번호로 받게 고쳐").
// 단축어 자동화의 "보낸 사람"은 연락처에 저장한 손님이면 번호 대신 저장한 이름이 된다 → 서버는 이름만 온 문자찜을 넣지 않고
// "확인 필요(번호 없음)" 카드로 돌린다(R-26). 그래서 보낸 곳이 번호가 아니면 이 휴대폰 연락처에서 같은 이름을 찾아 번호로 바꾼다.
// - 연락처 접근을 허용하지 않았으면 아무 것도 하지 않는다(이름 그대로 — 지금과 같음).
// - 이름이 글자 그대로 같은 연락처의 한국 휴대폰 번호가 딱 하나일 때만 바꾼다(같은 이름 여럿·번호 여럿이면 확인 필요 카드가 안전 — AUTO).
// - 이름·번호는 로그에 남기지 않는다.
import Contacts
import Foundation

public enum ContactNumber {
    /// 연락처 접근: granted · denied · undetermined
    public static func status() -> String {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: return "granted"
        case .notDetermined: return "undetermined"
        default:
            #if os(iOS)
            // 아이폰 18+ "일부 연락처만" 허용도 그 안에서는 찾는다
            if #available(iOS 18.0, *), CNContactStore.authorizationStatus(for: .contacts) == .limited { return "granted" }
            #endif
            return "denied"
        }
    }

    /// 처음이면 묻는다 (이미 정했으면 묻지 않고 그 결과)
    public static func request() async -> String {
        if status() == "undetermined" { _ = try? await CNContactStore().requestAccess(for: .contacts) }
        return status()
    }

    /// 이름과 글자 그대로 같은 연락처의 휴대폰 번호 하나 (숫자만). 권한 없음·못 찾음·여럿이면 nil
    public static func number(forName name: String) -> String? {
        guard status() == "granted" else { return nil }
        let wanted = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if wanted.isEmpty { return nil }
        let keys: [CNKeyDescriptor] = [CNContactPhoneNumbersKey as CNKeyDescriptor, CNContactNicknameKey as CNKeyDescriptor, CNContactOrganizationNameKey as CNKeyDescriptor, CNContactFormatter.descriptorForRequiredKeys(for: .fullName)]
        guard let contacts = try? CNContactStore().unifiedContacts(matching: CNContact.predicateForContacts(matchingName: wanted), keysToFetch: keys) else { return nil }
        let squash = { (s: String) in s.filter { !$0.isWhitespace } }
        var numbers: [String] = []
        for contact in contacts {
            let names = [CNContactFormatter.string(from: contact, style: .fullName), contact.nickname, contact.organizationName].compactMap { $0 }.filter { !$0.isEmpty }
            guard names.contains(where: { squash($0) == squash(wanted) }) else { continue }
            numbers += contact.phoneNumbers.map { $0.value.stringValue }
        }
        return ContactPick.mobile(numbers)
    }
}

/// 연락처 번호들 중 휴대폰 번호 하나 고르기 (안드로이드 ContactPick과 같은 규칙)
public enum ContactPick {
    public static func mobile(_ numbers: [String]) -> String? {
        let mobiles = Set(numbers.compactMap(normalize))
        return mobiles.count == 1 ? mobiles.first : nil
    }

    public static func normalize(_ raw: String) -> String? {
        var digits = raw.filter { $0 >= "0" && $0 <= "9" }
        if raw.trimmingCharacters(in: .whitespaces).hasPrefix("+82") || (digits.hasPrefix("82") && (11...12).contains(digits.count)) {
            digits = "0" + digits.dropFirst(2)
        }
        let ok = digits.range(of: "^01[016789][0-9]{7,8}$", options: .regularExpression) != nil
        return ok ? digits : nil
    }
}

// 앱 안 웹 화면 로그인 세션 지키기 (Expo Modules API, 이름 LivejjimWebSession — 아이폰, EP1 D-EP1-17).
// 우체국은 로그인을 세션 쿠키(만료 없음)에 두는데, iOS는 앱이 꺼지면 WKWebView의 세션 쿠키를 지운다 — 다시 켜면 로그인 화면으로 돌아간다.
// - save(domain): WKWebView 쿠키 저장소에서 그 도메인(과 하위 도메인)의 세션 쿠키만 골라 기기 키체인(이 기기에서만, 처음 잠금 해제 뒤)에 둔다.
//   쿠키 값은 JS로 넘기지 않는다(개수만 돌려준다). 라이브지니 서버로도 보내지 않는다.
// - restore(domain, maxAgeSeconds): 둔 지 maxAge가 지나지 않았으면 같은 이름이 없는 쿠키만 다시 넣는다(이번 실행에서 새로 받은 세션이 이긴다).
//   지났으면 지운다. 우체국 서버가 그 세션을 이미 끝냈으면 그냥 로그인 화면이 나온다(해가 없다).
// - clear(domain): 둔 것을 지운다.
import ExpoModulesCore
import Foundation
import Security
import WebKit

public class LivejjimWebSessionModule: Module {
    private static let service = "app.livejjim.websession"

    public func definition() -> ModuleDefinition {
        Name("LivejjimWebSession")

        AsyncFunction("save") { (domain: String, promise: Promise) in
            DispatchQueue.main.async {
                WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
                    let picked = cookies.filter { $0.isSessionOnly && Self.matches($0.domain, domain) }
                    if picked.isEmpty {
                        Self.delete(domain)
                        promise.resolve(0)
                        return
                    }
                    let items: [[String: Any]] = picked.map { cookie in
                        [
                            "name": cookie.name,
                            "value": cookie.value,
                            "domain": cookie.domain,
                            "path": cookie.path,
                            "secure": cookie.isSecure,
                            "httpOnly": cookie.isHTTPOnly,
                        ]
                    }
                    let payload: [String: Any] = ["savedAt": Date().timeIntervalSince1970, "cookies": items]
                    guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
                        promise.resolve(0)
                        return
                    }
                    Self.write(domain, data)
                    promise.resolve(picked.count)
                }
            }
        }

        AsyncFunction("restore") { (domain: String, maxAgeSeconds: Double, promise: Promise) in
            guard let data = Self.read(domain),
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let savedAt = payload["savedAt"] as? Double,
                  let items = payload["cookies"] as? [[String: Any]]
            else {
                promise.resolve(0)
                return
            }
            if Date().timeIntervalSince1970 - savedAt > maxAgeSeconds {
                Self.delete(domain)
                promise.resolve(0)
                return
            }
            DispatchQueue.main.async {
                let store = WKWebsiteDataStore.default().httpCookieStore
                store.getAllCookies { existing in
                    let have = Set(existing.map { "\($0.domain)|\($0.name)" })
                    let group = DispatchGroup()
                    var count = 0
                    for item in items {
                        guard let name = item["name"] as? String, let value = item["value"] as? String,
                              let cookieDomain = item["domain"] as? String, Self.matches(cookieDomain, domain),
                              !have.contains("\(cookieDomain)|\(name)")
                        else { continue }
                        var props: [HTTPCookiePropertyKey: Any] = [
                            .name: name,
                            .value: value,
                            .domain: cookieDomain,
                            .path: (item["path"] as? String) ?? "/",
                        ]
                        if (item["secure"] as? Bool) == true { props[.secure] = "TRUE" }
                        if (item["httpOnly"] as? Bool) == true { props[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
                        guard let cookie = HTTPCookie(properties: props) else { continue }
                        group.enter()
                        count += 1
                        store.setCookie(cookie) { group.leave() }
                    }
                    group.notify(queue: .main) { promise.resolve(count) }
                }
            }
        }

        AsyncFunction("clear") { (domain: String) in
            Self.delete(domain)
        }
    }

    /// 쿠키 도메인(".epost.go.kr" · "service.epost.go.kr")이 그 도메인이거나 하위 도메인인지
    static func matches(_ cookieDomain: String, _ domain: String) -> Bool {
        let host = cookieDomain.hasPrefix(".") ? String(cookieDomain.dropFirst()) : cookieDomain
        return host == domain || host.hasSuffix("." + domain)
    }

    private static func query(_ domain: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: domain]
    }

    static func write(_ domain: String, _ data: Data) {
        SecItemDelete(query(domain) as CFDictionary)
        var item = query(domain)
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func read(_ domain: String) -> Data? {
        var q = query(domain)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static func delete(_ domain: String) {
        SecItemDelete(query(domain) as CFDictionary)
    }
}

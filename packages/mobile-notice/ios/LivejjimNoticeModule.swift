// 문자찜·입금 알림 받기 모듈 (Expo Modules API, 이름 LivejjimNotice — 아이폰).
// JS에 보이는 것은 안드로이드와 같다: start · stop · getState · openSettings · setAllowedPackages · setToken · clearToken · setFilterRules · flush · 사건 "state".
// 아이폰은 알림을 읽을 수 없어 판매자가 단축어 자동화를 만든다(access = "shortcut"). 문자를 받는 일은 NoticeIntents.swift의 동작이 한다.
import ExpoModulesCore
import UIKit

final class InvalidTokenException: GenericException<Void> {
    override var reason: String { "연결 정보가 맞지 않아요" }
    override var code: String { "E_INVALID_TOKEN" }
}

public class LivejjimNoticeModule: Module {
    private var service: NoticeService { NoticeService.shared }

    public func definition() -> ModuleDefinition {
        Name("LivejjimNotice")
        Events("state")

        OnCreate {
            self.service.onChange = { [weak self] in
                guard let self else { return }
                self.sendEvent("state", self.service.store.stateMap())
            }
        }

        OnDestroy { self.service.onChange = nil }

        AsyncFunction("start") { () -> [String: Any] in
            self.service.store.setEnabled(true, nowMs: Int64(Date().timeIntervalSince1970 * 1000))
            Task { _ = await self.service.sender.drain() }
            return self.service.store.stateMap()
        }

        AsyncFunction("stop") { () -> [String: Any] in
            self.service.store.setEnabled(false, nowMs: Int64(Date().timeIntervalSince1970 * 1000))
            return self.service.store.stateMap()
        }

        AsyncFunction("getState") { () -> [String: Any] in self.service.store.stateMap() }

        AsyncFunction("openSettings") { (target: String) -> Bool in
            // 단축어 앱을 연다. 열 수 없으면 false(화면이 안내 문장을 보여 준다)
            let url = target == "shortcuts" ? URL(string: "shortcuts://") : URL(string: UIApplication.openSettingsURLString)
            guard let url else { return false }
            return await MainActor.run {
                guard UIApplication.shared.canOpenURL(url) else { return false }
                UIApplication.shared.open(url)
                return true
            }
        }

        // 아이폰은 은행 앱 알림을 읽지 못한다 — 받아도 쓸 곳이 없으니 상태만 돌려준다
        AsyncFunction("setAllowedPackages") { (_: [String]) -> [String: Any] in self.service.store.stateMap() }

        AsyncFunction("setToken") { (token: String, endpoint: String, deviceId: String) -> [String: Any] in
            guard NoticeContract.isValidToken(token), NoticeContract.isValidDeviceId(deviceId), NoticeContract.isAllowedEndpoint(endpoint) else { throw InvalidTokenException(()) }
            try self.service.store.setToken(TokenConfig(token: token, endpoint: endpoint, deviceId: deviceId))
            Task { _ = await self.service.sender.drain() }
            self.service.onChange?()
            return self.service.store.stateMap()
        }

        AsyncFunction("clearToken") { () -> [String: Any] in
            try self.service.store.setToken(nil)
            self.service.onChange?()
            return self.service.store.stateMap()
        }

        AsyncFunction("setFilterRules") { (rulesJson: String) -> [String: Any] in
            self.service.store.setRulesJson(rulesJson)
            self.service.onChange?()
            return self.service.store.stateMap()
        }

        AsyncFunction("flush") { () async -> [String: Any] in
            let result = await self.service.sender.drain()
            var map: [String: Any] = ["sent": result.sent, "pending": result.pending]
            if let stoppedBy = result.stoppedBy { map["stoppedBy"] = stoppedBy }
            return map
        }
    }
}

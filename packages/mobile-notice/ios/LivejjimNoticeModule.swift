// 문자찜·입금 알림 받기 모듈 (Expo Modules API, 이름 LivejjimNotice — 아이폰).
// JS에 보이는 것은 안드로이드와 같다: start · stop · getState · openSettings · setToken · clearToken · flush · 사건 "state".
// 거를 낱말은 서버 응답 filters를 저장해 쓴다(SPEC ORD-13 C-03) — JS가 넣지 않는다.
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
            Task { _ = await self.service.sender.drain(fetchFilters: true); self.service.onChange?() }
            return self.service.store.stateMap()
        }

        AsyncFunction("stop") { () -> [String: Any] in
            self.service.store.setEnabled(false, nowMs: Int64(Date().timeIntervalSince1970 * 1000))
            return self.service.store.stateMap()
        }

        AsyncFunction("getState") { () -> [String: Any] in self.service.store.stateMap() }

        // 연락처 접근 묻기 (D-SMS-CONTACT) — 저장된 손님 이름을 휴대폰 번호로 바꾸는 데만 쓴다. granted · denied · undetermined
        AsyncFunction("requestContacts") { () async -> String in await ContactNumber.request() }

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

        AsyncFunction("setToken") { (token: String, endpoint: String, deviceName: String) -> [String: Any] in
            guard NoticeContract.isValidToken(token), let name = NoticeContract.cleanDeviceName(deviceName), NoticeContract.isAllowedEndpoint(endpoint) else { throw InvalidTokenException(()) }
            try self.service.store.setToken(TokenConfig(token: token, endpoint: endpoint, deviceName: name))
            Task { _ = await self.service.sender.drain(fetchFilters: true); self.service.onChange?() }
            self.service.onChange?()
            return self.service.store.stateMap()
        }

        AsyncFunction("clearToken") { () -> [String: Any] in
            try self.service.store.setToken(nil)
            self.service.onChange?()
            return self.service.store.stateMap()
        }

        AsyncFunction("flush") { () async -> [String: Any] in
            let result = await self.service.sender.drain(fetchFilters: true)
            self.service.onChange?()
            var map: [String: Any] = ["sent": result.sent, "pending": result.pending]
            if let stoppedBy = result.stoppedBy { map["stoppedBy"] = stoppedBy }
            return map
        }
    }
}

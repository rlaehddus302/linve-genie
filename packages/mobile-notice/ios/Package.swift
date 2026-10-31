// swift-tools-version:5.9
// 순수 Swift 시험용 (앱 없이 macOS에서 `swift test`). Expo 모듈(LivejjimNoticeModule.swift)만 앱 빌드(CocoaPods)에서 컴파일된다. 공용 사례는 ../test-vectors/notice-vectors.json.
import PackageDescription

let package = Package(
    name: "LivejjimNotice",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "NoticeCore", targets: ["NoticeCore"])],
    targets: [
        .target(name: "NoticeCore", path: ".", exclude: ["Tests", "LivejjimNoticeModule.swift", "LivejjimNotice.podspec", "Package.swift"], sources: ["NoticeContract.swift", "NoticeExtract.swift", "NoticeStore.swift", "NoticeSender.swift", "NoticeService.swift", "NoticeIntents.swift"]),
        .testTarget(name: "NoticeCoreTests", dependencies: ["NoticeCore"], path: "Tests"),
    ]
)

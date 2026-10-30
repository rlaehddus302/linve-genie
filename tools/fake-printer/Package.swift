// swift-tools-version:5.9
// 가짜 라벨 프린터 (BLE 주변기기) — Command Line Tools만 있어도 `swift build`로 만든다 (Xcode 불필요).
import Foundation
import PackageDescription

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
    name: "fake-printer",
    platforms: [.macOS(.v12)],
    targets: [
        // 응답 로직·래스터 풀기·PNG (블루투스·시각을 모른다 — 자체 시험이 이것만 본다)
        .target(name: "FakePrinterCore", path: "Sources/FakePrinterCore"),
        .executableTarget(
            name: "fake-printer",
            dependencies: ["FakePrinterCore"],
            path: "Sources/fake-printer",
            exclude: ["Info.plist"],
            // 블루투스 권한 문구(NSBluetoothAlwaysUsageDescription)를 실행 파일에 넣는다 — 없으면 권한 창 없이 종료될 수 있다
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "\(root)/Sources/fake-printer/Info.plist"])]
        ),
        .executableTarget(name: "fake-printer-selftest", dependencies: ["FakePrinterCore"], path: "Sources/fake-printer-selftest"),
    ]
)

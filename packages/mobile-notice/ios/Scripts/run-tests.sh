#!/bin/sh
# 아이폰 쪽 순수 Swift 시험을 XCTest 없이 돈다 (Command Line Tools만 있는 맥). 공용 사례 파일을 TS·Kotlin과 같이 읽는다.
set -eu
cd "$(dirname "$0")/.."
OUT=.build/shim
mkdir -p "$OUT"
cat > "$OUT/main.swift" <<'SW'
import Foundation
let vectors = NoticeVectorsTests()
for run in [vectors.testLocalId, vectors.testPhone, vectors.testSender, vectors.testNormalize, vectors.testCut, vectors.testFilter, vectors.testClassify, vectors.testShortcut, vectors.testEnvelope] { try run() }
vectors.testEndpoint()
let queue = NoticeQueueTests()
try queue.testQueueIsEncryptedAndDeduped()
try queue.testTokenStoredEncrypted()
try await queue.testDrainHandlesServerAnswers()
try await queue.testTokenRejectedStopsAndKeepsQueue()
try await queue.testServiceFiltersAndRespectsOffSwitch()
print(shimFailures == 0 ? "통과: 확인 \(shimChecks)개" : "실패 \(shimFailures)개 / 확인 \(shimChecks)개")
exit(shimFailures == 0 ? 0 : 1)
SW

swiftc -O -module-name NoticeShim -o "$OUT/run" \
  NoticeContract.swift NoticeExtract.swift NoticeStore.swift NoticeSender.swift NoticeService.swift NoticeIntents.swift \
  Scripts/xctest-shim.swift Tests/NoticeCoreTests.swift "$OUT/main.swift"
"$OUT/run"

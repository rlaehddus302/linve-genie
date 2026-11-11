#!/bin/sh
# 아이폰 쪽 순수 Swift 시험을 XCTest 없이 돈다 (Command Line Tools만 있는 맥). 공용 사례 파일을 TS·Kotlin과 같이 읽는다.
set -eu
cd "$(dirname "$0")/.."
OUT=.build/shim
mkdir -p "$OUT"
cat > "$OUT/main.swift" <<'SW'
import Foundation
let vectors = NoticeVectorsTests()
for run in [vectors.testMessageId, vectors.testPhone, vectors.testSender, vectors.testCut, vectors.testLowerAscii, vectors.testSkip, vectors.testSmsSkip, vectors.testFilters, vectors.testClassify, vectors.testShortcut, vectors.testRequest, vectors.testResponse] { try run() }
vectors.testDeviceNameAndEndpoint()
let queue = NoticeQueueTests()
try queue.testQueueIsEncryptedAndDeduped()
try queue.testQueueKeepsNewest1000()
try queue.testTokenStoredEncrypted()
try await queue.testDrainBatchesAndStoresFilters()
try await queue.testRetryKeepsSameIdAnd429Waits()
try await queue.testBadRequestIsolatesOne()
try await queue.testTokenRejectedStopsAndKeepsQueue()
try await queue.testDrainVectors()
try await queue.testInboxOffKeepsTokenAndRechecks()
try await queue.testServerErrorKeepsSameIds()
try await queue.testEmptyQueueFetchesFilters()
try await queue.testServiceFiltersAndRespectsOffSwitch()
try await queue.testServiceTurnsSavedContactNameIntoNumber()
queue.testContactPickNeedsExactlyOneMobile()
print(shimFailures == 0 ? "통과: 확인 \(shimChecks)개" : "실패 \(shimFailures)개 / 확인 \(shimChecks)개")
exit(shimFailures == 0 ? 0 : 1)
SW

swiftc -O -module-name NoticeShim -o "$OUT/run" \
  NoticeContract.swift NoticeExtract.swift NoticeStore.swift NoticeSender.swift NoticeService.swift NoticeIntents.swift ContactNumber.swift \
  Scripts/xctest-shim.swift Tests/NoticeCoreTests.swift "$OUT/main.swift"
"$OUT/run"

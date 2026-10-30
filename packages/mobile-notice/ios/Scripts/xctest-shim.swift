// XCTest가 없는 맥(Command Line Tools만 있는 곳)에서 같은 시험 파일을 돌리기 위한 작은 대용품 — Scripts/run-tests.sh가 쓴다.
// Xcode가 있으면 `swift test`가 진짜 XCTest로 돈다.
import Foundation

var shimFailures = 0
var shimChecks = 0

open class XCTestCase { public required init() {} }

private func fail(_ message: String, _ file: StaticString, _ line: UInt) {
    shimFailures += 1
    print("실패 \(file):\(line) \(message)")
}

func XCTAssertEqual<T: Equatable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    shimChecks += 1
    do { let x = try a(), y = try b(); if x != y { fail("\(x) != \(y) \(message())", file, line) } } catch { fail("\(error)", file, line) }
}
func XCTAssertTrue(_ a: @autoclosure () throws -> Bool, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    shimChecks += 1
    if (try? a()) != true { fail("거짓 \(message())", file, line) }
}
func XCTAssertFalse(_ a: @autoclosure () throws -> Bool, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    shimChecks += 1
    if (try? a()) != false { fail("참 \(message())", file, line) }
}
func XCTAssertNil<T>(_ a: @autoclosure () throws -> T?, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    shimChecks += 1
    if let v = try? a() { fail("nil이 아니다 \(v) \(message())", file, line) }
}
func XCTAssertNotNil<T>(_ a: @autoclosure () throws -> T?, _ message: @autoclosure () -> String = "", file: StaticString = #filePath, line: UInt = #line) {
    shimChecks += 1
    if (try? a()) == nil { fail("nil \(message())", file, line) }
}

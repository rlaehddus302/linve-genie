// 손글씨 읽기 (Expo Modules API, 이름 LivejjimInk — 아이폰, D-HANDWRITE-02).
// 품종 칸에 손가락으로 쓴 획을 흰 바탕 검은 글씨 그림으로 그려 기기 글자 읽기(Vision, 한국어는 iOS 16+)로 읽는다.
// 인터넷·서버를 쓰지 않는다 — 획도 그림도 밖으로 보내지 않는다.
// - prepare(language): 이 기기가 그 말을 읽을 수 있으면 true (받을 것이 없다).
// - recognize(strokes, width, height, language, hints): 획([x, y, t, …])을 읽어 후보 글을 그럴듯한 것부터.
//   hints(품종 이름)는 맞춤법 고칠 때 참고 낱말로 넘긴다.
import ExpoModulesCore
import Foundation
import UIKit
import Vision

public class LivejjimInkModule: Module {
    /** 그림에서 쓰는 판 높이 — 판 높이를 이만큼으로 맞춰 그린다(글자 키 ≈ 100~200점) */
    private static let canvasPadHeight: CGFloat = 260
    /** 판에 그린 선 굵기(9)와 같은 비율 */
    private static let inkWidthOnPad: CGFloat = 9

    public func definition() -> ModuleDefinition {
        Name("LivejjimInk")

        AsyncFunction("prepare") { (language: String) -> Bool in
            return Self.languages(for: language) != nil
        }

        AsyncFunction("recognize") { (strokes: [[Double]], width: Double, height: Double, language: String, hints: [String], promise: Promise) in
            DispatchQueue.global(qos: .userInitiated).async {
                guard let languages = Self.languages(for: language),
                      let image = Self.render(strokes, padHeight: height)
                else {
                    promise.resolve([String]())
                    return
                }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.recognitionLanguages = languages
                request.usesLanguageCorrection = true
                request.customWords = Array(hints.prefix(200))
                let handler = VNImageRequestHandler(cgImage: image, options: [:])
                do {
                    try handler.perform([request])
                } catch {
                    promise.reject("ERR_INK_READ", "손글씨를 읽지 못했어요")
                    return
                }
                promise.resolve(Self.candidates(request.results ?? []))
            }
        }
    }

    /** 이 기기가 읽을 수 있는 말 목록 (한국어 + 영어 — "SP"·"UFO" 같은 영문 품종) — 못 읽으면 nil */
    private static func languages(for language: String) -> [String]? {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        guard let supported = try? request.supportedRecognitionLanguages() else { return nil }
        let wanted = language == "ko" ? ["ko-KR", "en-US"] : [language]
        let picked = wanted.filter { supported.contains($0) }
        guard let first = wanted.first, picked.contains(first) else { return nil }
        return picked
    }

    /** 획을 흰 바탕에 검은 선으로 그린다 — 쓴 곳만 잘라 둘레를 넉넉히 비운다 */
    private static func render(_ strokes: [[Double]], padHeight: Double) -> CGImage? {
        var points: [[CGPoint]] = []
        for stroke in strokes {
            var line: [CGPoint] = []
            var index = 0
            while index + 2 < stroke.count {
                line.append(CGPoint(x: stroke[index], y: stroke[index + 1]))
                index += 3
            }
            if !line.isEmpty { points.append(line) }
        }
        let all = points.flatMap { $0 }
        guard let minX = all.map(\.x).min(), let maxX = all.map(\.x).max(),
              let minY = all.map(\.y).min(), let maxY = all.map(\.y).max()
        else { return nil }
        let scale = canvasPadHeight / CGFloat(max(padHeight, 1))
        let lineWidth = max(3, inkWidthOnPad * scale)
        let margin = max(40, (maxY - minY) * scale * 0.4)
        let size = CGSize(width: min(4000, (maxX - minX) * scale + margin * 2), height: min(2000, (maxY - minY) * scale + margin * 2))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let cg = context.cgContext
            cg.setStrokeColor(UIColor.black.cgColor)
            cg.setFillColor(UIColor.black.cgColor)
            cg.setLineWidth(lineWidth)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            for line in points {
                let mapped = line.map { CGPoint(x: ($0.x - minX) * scale + margin, y: ($0.y - minY) * scale + margin) }
                guard let first = mapped.first else { continue }
                if mapped.count == 1 {
                    cg.fillEllipse(in: CGRect(x: first.x - lineWidth / 2, y: first.y - lineWidth / 2, width: lineWidth, height: lineWidth))
                    continue
                }
                cg.beginPath()
                cg.move(to: first)
                for point in mapped.dropFirst() { cg.addLine(to: point) }
                cg.strokePath()
            }
        }
        return image.cgImage
    }

    /** 읽은 줄들 → 후보 글. 한 덩어리면 그 후보들, 여러 덩어리면 읽는 차례(위→아래, 왼→오른)로 이은 글 */
    private static func candidates(_ observations: [VNRecognizedTextObservation]) -> [String] {
        let ordered = observations.sorted { a, b in
            let rowA = a.boundingBox.midY, rowB = b.boundingBox.midY
            if abs(rowA - rowB) > max(a.boundingBox.height, b.boundingBox.height) / 2 { return rowA > rowB }
            return a.boundingBox.minX < b.boundingBox.minX
        }
        let tops = ordered.map { $0.topCandidates(5).map(\.string) }.filter { !$0.isEmpty }
        guard let firstGroup = tops.first else { return [] }
        if tops.count == 1 { return unique(firstGroup) }
        let best = tops.compactMap(\.first)
        var out = [best.joined(separator: " "), best.joined()]
        // 첫 덩어리만 다른 후보로 바꾼 글 (나머지는 가장 그럴듯한 것)
        for other in firstGroup.dropFirst() {
            out.append(([other] + best.dropFirst()).joined(separator: " "))
        }
        return unique(out)
    }

    private static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

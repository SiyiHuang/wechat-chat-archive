import AppKit
import CoreML
import Foundation
import ImageIO
import Vision

struct OCRLine: Encodable {
    struct Box: Encodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    let text: String
    let confidence: Float
    let bbox: Box
}

struct OCRImage: Encodable {
    let path: String
    let width: Int
    let height: Int
    let lines: [OCRLine]
}

struct OCRResult: Encodable {
    struct Compute: Encodable {
        let selection: String
        let supportedDevicesByStage: [String: [String]]
        let neuralEngineSupportedByAnyStage: Bool?
    }

    let images: [OCRImage]
    let compute: Compute
}

func deviceName(_ device: MLComputeDevice) -> String {
    switch device {
    case .cpu(_):
        return "cpu"
    case .gpu(_):
        return "gpu"
    case .neuralEngine(_):
        return "neuralEngine"
    @unknown default:
        return "unknown"
    }
}

func readImage(_ path: String) throws -> OCRImage {
    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "LocalOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot decode image: \(path)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: image)
    try handler.perform([request])

    let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OCRLine(
            text: candidate.string,
            confidence: candidate.confidence,
            bbox: .init(x: box.origin.x, y: box.origin.y, width: box.width, height: box.height)
        )
    }

    return OCRImage(path: url.path, width: image.width, height: image.height, lines: lines)
}

do {
    let paths = Array(CommandLine.arguments.dropFirst())
    guard !paths.isEmpty else {
        fputs("Usage: swift ocr.swift IMAGE [IMAGE ...]\n", stderr)
        exit(2)
    }

    let request = VNRecognizeTextRequest()
    var devicesByStage: [String: [String]] = [:]
    var neuralEngineAvailable: Bool?
    if #available(macOS 14.0, *) {
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        let supported = try request.supportedComputeStageDevices
        devicesByStage = Dictionary(uniqueKeysWithValues: supported.map { stage, devices in
            (String(describing: stage), devices.map(deviceName).sorted())
        })
        neuralEngineAvailable = supported.values
            .flatMap { $0 }
            .contains { deviceName($0) == "neuralEngine" }
    }

    let images = try paths.map(readImage)
    let result = OCRResult(
        images: images,
        compute: .init(
            selection: "automatic",
            supportedDevicesByStage: devicesByStage,
            neuralEngineSupportedByAnyStage: neuralEngineAvailable
        )
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(result)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
} catch {
    fputs("OCR failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}

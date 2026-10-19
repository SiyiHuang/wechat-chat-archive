import CoreML
import Foundation
import ImageIO
import Vision

struct Box: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Line: Encodable {
    let text: String
    let confidence: Float
    let bbox: Box
}

struct TextBlock: Encodable {
    let text: String
    let region: [Point]
}

struct Point: Encodable {
    let x: Double
    let y: Double
}

func regionPoints(_ region: NormalizedRegion) -> [Point] {
    region.normalizedPoints.map { Point(x: Double($0.x), y: Double($0.y)) }
}

struct Cell: Encodable {
    let text: String
    let rowRange: [Int]
    let columnRange: [Int]
}

struct Table: Encodable {
    let region: [Point]
    let rows: [[Cell]]
}

struct Document: Encodable {
    let transcript: String
    let confidence: Float
    let paragraphs: [TextBlock]
    let tables: [Table]
    let lists: [[String]]
}

struct ImageResult: Encodable {
    let path: String
    let width: Int
    let height: Int
    let lines: [Line]
    let documents: [Document]
}

struct Engine: Encodable {
    let api: String
    let implementation: String
    let kind: String
    let revision: String
    let supportedRevisions: [String]
    let recognitionLanguages: [String]
}

struct Compute: Encodable {
    let selection: String
}

struct Output: Encodable {
    let images: [ImageResult]
    let engine: Engine
    let compute: Compute
}

@main
struct DocumentOCR {
    static func main() async {
        guard #available(macOS 26.0, *) else {
            fputs("Document recognition requires macOS 26 or newer.\n", stderr)
            exit(2)
        }
        do {
            let paths = Array(CommandLine.arguments.dropFirst())
            guard !paths.isEmpty else {
                fputs("Usage: ocr-documents IMAGE [IMAGE ...]\n", stderr)
                exit(2)
            }
            var request = RecognizeDocumentsRequest(RecognizeDocumentsRequest.supportedRevisions.max())
            request.textRecognitionOptions.recognitionLanguages = [Locale.Language(identifier: "zh-Hans"), Locale.Language(identifier: "en-US")]
            request.textRecognitionOptions.useLanguageCorrection = true
            var images: [ImageResult] = []
            for path in paths {
                let url = URL(fileURLWithPath: path).standardizedFileURL
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                    throw NSError(domain: "DocumentOCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot decode image: \(path)"])
                }
                let observations = try await request.perform(on: image)
                var lines: [Line] = []
                var documents: [Document] = []
                for observation in observations {
                    let container = observation.document
                    for line in container.text.lines {
                        guard let candidate = line.topCandidates(1).first else { continue }
                        let box = line.boundingBox
                        lines.append(Line(text: candidate.string, confidence: candidate.confidence, bbox: Box(x: box.origin.x, y: box.origin.y, width: box.width, height: box.height)))
                    }
                    documents.append(Document(
                        transcript: container.text.transcript,
                        confidence: observation.confidence,
                        paragraphs: container.paragraphs.map { TextBlock(text: $0.transcript, region: regionPoints($0.boundingRegion)) },
                        tables: container.tables.map { table in
                            Table(region: regionPoints(table.boundingRegion), rows: table.rows.map { row in
                                row.map { Cell(text: $0.content.text.transcript, rowRange: [$0.rowRange.lowerBound, $0.rowRange.upperBound], columnRange: [$0.columnRange.lowerBound, $0.columnRange.upperBound]) }
                            })
                        },
                        lists: container.lists.map { $0.items.map { $0.markerString + " " + $0.itemString } }
                    ))
                }
                images.append(ImageResult(path: url.path, width: image.width, height: image.height, lines: lines, documents: documents))
            }
            let result = Output(images: images, engine: Engine(api: "RecognizeDocumentsRequest", implementation: "swift", kind: "document", revision: String(describing: request.revision), supportedRevisions: RecognizeDocumentsRequest.supportedRevisions.map { String(describing: $0) }, recognitionLanguages: ["zh-Hans", "en-US"]), compute: Compute(selection: "automatic"))
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            FileHandle.standardOutput.write(try encoder.encode(result))
            FileHandle.standardOutput.write(Data([10]))
        } catch {
            fputs("Document OCR failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}

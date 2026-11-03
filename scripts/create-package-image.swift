import AppKit
import CoreImage
import Foundation
import Vision

guard CommandLine.arguments.count >= 4 else {
  fputs("usage: create-package-image.swift output.png input1.png input2.png [...]\n", stderr)
  exit(2)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let inputURLs = CommandLine.arguments.dropFirst(2).map { URL(fileURLWithPath: $0) }
let context = CIContext()

func extractProduct(from inputURL: URL) throws -> CIImage {
  guard let image = CIImage(contentsOf: inputURL) else {
    throw NSError(domain: "PackageImage", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot load image: \(inputURL.path)"])
  }

  let request = VNGenerateForegroundInstanceMaskRequest()
  let handler = VNImageRequestHandler(ciImage: image, options: [:])
  try handler.perform([request])
  guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
    throw NSError(domain: "PackageImage", code: 4, userInfo: [NSLocalizedDescriptionKey: "no foreground found: \(inputURL.path)"])
  }

  let maskedPixelBuffer = try observation.generateMaskedImage(
    ofInstances: observation.allInstances,
    from: handler,
    croppedToInstancesExtent: true
  )
  return CIImage(cvPixelBuffer: maskedPixelBuffer)
}

let products = try inputURLs.map(extractProduct)
let targetArea = products.map { $0.extent.width * $0.extent.height }.min() ?? 0
let normalizedProducts = products.enumerated().map { index, product -> CIImage in
  let area = product.extent.width * product.extent.height
  let weightedTargetArea = index == 0 && products.count > 1 ? targetArea * 0.7 : targetArea
  guard area > 0, weightedTargetArea > 0, area > weightedTargetArea else { return product }
  let scale = sqrt(weightedTargetArea / area)
  return product.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
}
let contentWidth = normalizedProducts.map { $0.extent.width }.max() ?? 0
let padding = max(12, min(48, contentWidth * 0.02))
let gap = max(24, min(96, contentWidth * 0.05))
let rawWidth = contentWidth + padding * 2
let rawHeight = normalizedProducts.reduce(0) { $0 + $1.extent.height } + gap * CGFloat(max(normalizedProducts.count - 1, 0)) + padding * 2
let rawRect = CGRect(x: 0, y: 0, width: rawWidth, height: rawHeight)
var output = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0)).cropped(to: rawRect)
var y = padding
for product in normalizedProducts.reversed() {
  let x = (rawWidth - product.extent.width) / 2
  let positioned = product.transformed(by: CGAffineTransform(translationX: x, y: y))
  output = positioned.composited(over: output)
  y += product.extent.height + gap
}

let scale = min(1, 900 / rawWidth, 1200 / rawHeight)
if scale < 1 {
  output = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
}
let outputRect = CGRect(x: 0, y: 0, width: floor(rawWidth * scale), height: floor(rawHeight * scale))

guard let cgImage = context.createCGImage(output, from: outputRect) else {
  fputs("cannot render package image\n", stderr)
  exit(5)
}
let representation = NSBitmapImageRep(cgImage: cgImage)
guard let data = representation.representation(using: .png, properties: [:]) else {
  fputs("cannot encode package image\n", stderr)
  exit(6)
}
try data.write(to: outputURL, options: .atomic)

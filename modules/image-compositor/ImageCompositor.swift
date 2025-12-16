import Foundation
import UIKit
import React

@objc(ImageCompositor)
class ImageCompositor: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func compositeImages(
    _ beforeUri: String,
    afterUri: String,
    layout: String,
    width: NSNumber,
    height: NSNumber,
    topHeight: NSNumber?,
    bottomHeight: NSNumber?,
    leftWidth: NSNumber?,
    rightWidth: NSNumber?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        // Load images
        guard let beforeImage = self.loadImage(from: beforeUri) else {
          reject("E_BEFORE_IMAGE", "Failed to load before image", nil)
          return
        }

        guard let afterImage = self.loadImage(from: afterUri) else {
          reject("E_AFTER_IMAGE", "Failed to load after image", nil)
          return
        }

        var canvasWidth = CGFloat(truncating: width)
        var canvasHeight = CGFloat(truncating: height)

        // Limit canvas size to prevent memory issues
        let maxDimension: CGFloat = 4096.0
        var scaleFactor: CGFloat = 1.0
        if canvasWidth > maxDimension || canvasHeight > maxDimension {
          print("[ImageCompositor] ⚠️ Canvas too large (\(canvasWidth) x \(canvasHeight)), downscaling...")
          scaleFactor = min(maxDimension / canvasWidth, maxDimension / canvasHeight)
          canvasWidth *= scaleFactor
          canvasHeight *= scaleFactor
          print("[ImageCompositor] ✅ Canvas scaled to: \(canvasWidth) x \(canvasHeight)")
        }

        let canvasSize = CGSize(width: canvasWidth, height: canvasHeight)

        // Use UIGraphicsImageRenderer instead of UIGraphicsBeginImageContextWithOptions
        // This is Apple's recommended approach and handles memory more efficiently
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1.0 // Use scale 1.0 to avoid multiplying dimensions
        let renderer = UIGraphicsImageRenderer(size: canvasSize, format: format)

        let composedImage = renderer.image { context in
          // Fill background with white
          UIColor.white.setFill()
          context.fill(CGRect(origin: .zero, size: canvasSize))

          if layout == "STACK" {
            // Stacked layout (vertical)
            let topH = CGFloat(truncating: topHeight ?? 0) * scaleFactor
            let bottomH = CGFloat(truncating: bottomHeight ?? 0) * scaleFactor

            // Draw before image on top
            beforeImage.draw(in: CGRect(x: 0, y: 0, width: canvasWidth, height: topH))

            // Draw after image on bottom
            afterImage.draw(in: CGRect(x: 0, y: topH, width: canvasWidth, height: bottomH))

          } else {
            // Side-by-side layout (horizontal)
            let leftW = CGFloat(truncating: leftWidth ?? 0) * scaleFactor
            let rightW = CGFloat(truncating: rightWidth ?? 0) * scaleFactor

            // Draw before image on left
            beforeImage.draw(in: CGRect(x: 0, y: 0, width: leftW, height: canvasHeight))

            // Draw after image on right
            afterImage.draw(in: CGRect(x: leftW, y: 0, width: rightW, height: canvasHeight))
          }
        }

        // Save to temp file with 85% quality to match Android
        guard let imageData = composedImage.jpegData(compressionQuality: 0.85) else {
          reject("E_JPEG", "Failed to create JPEG data", nil)
          return
        }

        let tempDir = NSTemporaryDirectory()
        let filename = "combined_\(UUID().uuidString).jpg"
        let filepath = (tempDir as NSString).appendingPathComponent(filename)
        let fileURL = URL(fileURLWithPath: filepath)

        try imageData.write(to: fileURL)

        resolve(fileURL.absoluteString)

      } catch {
        reject("E_SAVE", "Failed to save composed image: \(error.localizedDescription)", error)
      }
    }
  }

  // Maximum dimension for images to prevent memory issues
  // iOS can struggle with images larger than ~4000-5000px when creating contexts
  private let maxImageDimension: CGFloat = 4096.0

  @objc
  func addLabelToImage(
    _ imageUri: String,
    labelText: String,
    labelConfig: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        // Load image
        guard var image = self.loadImage(from: imageUri) else {
          reject("LOAD_ERROR", "Failed to load image", nil)
          return
        }

        // Downscale if image is too large to prevent memory issues
        let originalSize = image.size
        if originalSize.width > self.maxImageDimension || originalSize.height > self.maxImageDimension {
          print("[ImageCompositor] ⚠️ Image too large (\(originalSize.width) x \(originalSize.height)), downscaling...")
          let scaleFactor = min(self.maxImageDimension / originalSize.width, self.maxImageDimension / originalSize.height)
          let newSize = CGSize(width: originalSize.width * scaleFactor, height: originalSize.height * scaleFactor)

          // Use UIGraphicsImageRenderer for downscaling (memory efficient)
          let renderer = UIGraphicsImageRenderer(size: newSize)
          image = renderer.image { context in
            image.draw(in: CGRect(origin: .zero, size: newSize))
          }
          print("[ImageCompositor] ✅ Downscaled to: \(image.size.width) x \(image.size.height)")
        }

        // Parse label configuration
        let position = labelConfig["position"] as? String ?? "top-left"
        let backgroundColorHex = labelConfig["backgroundColor"] as? String ?? "#FFD700"
        let textColorHex = labelConfig["textColor"] as? String ?? "#000000"
        let fontSize = labelConfig["fontSize"] as? Int ?? 48
        let marginH = labelConfig["marginHorizontal"] as? Int ?? 20
        let marginV = labelConfig["marginVertical"] as? Int ?? 20
        let padding = labelConfig["padding"] as? Int ?? 16
        // When absoluteMargins is true, margins are already in absolute pixels (not scaled)
        let absoluteMargins = labelConfig["absoluteMargins"] as? Bool ?? false

        let backgroundColor = self.hexToUIColor(hex: backgroundColorHex)
        let textColor = self.hexToUIColor(hex: textColorHex)

        // Calculate scaled sizes based on image dimensions (assuming ~1000px as baseline)
        let scale = image.size.width / 1000.0
        let scaledFontSize = max(CGFloat(fontSize) * scale, 24.0)
        // If absoluteMargins is true, use the margins as-is (they're already calculated for the actual image size)
        let scaledMarginH = absoluteMargins ? CGFloat(marginH) : max(CGFloat(marginH) * scale, 10.0)
        let scaledMarginV = absoluteMargins ? CGFloat(marginV) : max(CGFloat(marginV) * scale, 10.0)
        let scaledPadding = max(CGFloat(padding) * scale, 8.0)

        // Create text attributes
        let font = UIFont.boldSystemFont(ofSize: scaledFontSize)
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.alignment = .left

        let textAttributes: [NSAttributedString.Key: Any] = [
          .font: font,
          .foregroundColor: textColor,
          .paragraphStyle: paragraphStyle
        ]

        // Measure text
        let textSize = (labelText as NSString).size(withAttributes: textAttributes)

        // Calculate label dimensions
        let labelWidth = textSize.width + (scaledPadding * 2)
        let labelHeight = textSize.height + (scaledPadding * 2)

        // Calculate label position based on 9-position grid
        // Positions: left-top, left-middle, left-bottom, center-top, center-middle, center-bottom, right-top, right-middle, right-bottom
        // Also support legacy format: top-left, top-right, bottom-left, bottom-right
        let labelRect: CGRect

        // For combined photos, we may need to offset center/middle positions
        // offsetX/offsetY shift the label from its natural position (used for After labels in combined photos)
        let offsetX = labelConfig["offsetX"] as? Int ?? 0
        let offsetY = labelConfig["offsetY"] as? Int ?? 0

        // Determine horizontal position (x)
        // offsetX is applied to ALL positions to support After label placement in combined photos
        // For SIDE layout: After label needs offsetX = halfWidth to shift to right half
        let labelX: CGFloat
        if position.contains("left") {
          labelX = scaledMarginH + CGFloat(offsetX)
        } else if position.contains("right") {
          labelX = image.size.width - scaledMarginH - labelWidth + CGFloat(offsetX)
        } else {
          // center
          labelX = (image.size.width - labelWidth) / 2 + CGFloat(offsetX)
        }

        // Determine vertical position (y)
        // offsetY is applied to ALL positions to support After label placement in combined photos
        // For STACK layout: After label needs offsetY = halfHeight to shift to bottom half
        let labelY: CGFloat
        if position.contains("top") {
          labelY = scaledMarginV + CGFloat(offsetY)
        } else if position.contains("bottom") {
          labelY = image.size.height - scaledMarginV - labelHeight + CGFloat(offsetY)
        } else {
          // middle
          labelY = (image.size.height - labelHeight) / 2 + CGFloat(offsetY)
        }

        labelRect = CGRect(
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight
        )

        print("[ImageCompositor] 📍 Label Position Calculation:")
        print("  Image size: \(image.size.width) x \(image.size.height)")
        print("  Position: \(position)")
        print("  Text: \(labelText)")
        print("  absoluteMargins: \(absoluteMargins)")
        print("  Input marginH: \(marginH), marginV: \(marginV)")
        print("  offsetX: \(offsetX), offsetY: \(offsetY)")
        print("  Scaled fontSize: \(scaledFontSize)")
        print("  Scaled marginH: \(scaledMarginH), marginV: \(scaledMarginV)")
        print("  Label size: \(labelWidth) x \(labelHeight)")
        print("  Label rect: x=\(labelRect.origin.x), y=\(labelRect.origin.y), w=\(labelRect.width), h=\(labelRect.height)")

        // Use UIGraphicsImageRenderer instead of UIGraphicsBeginImageContextWithOptions
        // This is Apple's recommended approach and handles memory more efficiently
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1.0 // Use scale 1.0 to avoid multiplying dimensions
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)

        let labeledImage = renderer.image { context in
          // Draw original image
          image.draw(at: .zero)

          // Draw label background with rounded corners
          let cornerRadius = 8.0 * scale
          let path = UIBezierPath(roundedRect: labelRect, cornerRadius: cornerRadius)
          backgroundColor.setFill()
          path.fill()

          // Draw text centered in the label
          let textRect = CGRect(
            x: labelRect.origin.x + scaledPadding,
            y: labelRect.origin.y + scaledPadding,
            width: textSize.width,
            height: textSize.height
          )
          (labelText as NSString).draw(in: textRect, withAttributes: textAttributes)
        }

        // Save to temp file with 85% quality to match Android
        guard let imageData = labeledImage.jpegData(compressionQuality: 0.85) else {
          reject("E_JPEG", "Failed to create JPEG data", nil)
          return
        }

        let tempDir = NSTemporaryDirectory()
        let filename = "labeled_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        let filepath = (tempDir as NSString).appendingPathComponent(filename)
        let fileURL = URL(fileURLWithPath: filepath)

        try imageData.write(to: fileURL)

        resolve(fileURL.absoluteString)

      } catch {
        reject("LABEL_ERROR", "Failed to add label to image: \(error.localizedDescription)", error)
      }
    }
  }

  private func hexToUIColor(hex: String) -> UIColor {
    var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

    var rgb: UInt64 = 0
    Scanner(string: hexSanitized).scanHexInt64(&rgb)

    let red = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
    let green = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
    let blue = CGFloat(rgb & 0x0000FF) / 255.0

    return UIColor(red: red, green: green, blue: blue, alpha: 1.0)
  }

  private func loadImage(from uriString: String) -> UIImage? {
    print("[ImageCompositor] 📂 loadImage called with: \(uriString)")
    var urlString = uriString

    // Handle file:// URLs
    if urlString.hasPrefix("file://") {
      urlString = String(urlString.dropFirst(7))
      print("[ImageCompositor] 📂 After stripping file://: \(urlString)")
    }

    // URL-decode the path in case it contains encoded characters
    if let decodedPath = urlString.removingPercentEncoding {
      urlString = decodedPath
      print("[ImageCompositor] 📂 After URL decoding: \(urlString)")
    }

    var loadedImage: UIImage? = nil

    // Try to load from file path
    if let image = UIImage(contentsOfFile: urlString) {
      print("[ImageCompositor] ✅ Loaded image from file path: \(urlString)")
      loadedImage = image
    } else {
      print("[ImageCompositor] ⚠️ Failed to load from file path: \(urlString)")
      // Check if file exists
      let fileManager = FileManager.default
      if fileManager.fileExists(atPath: urlString) {
        print("[ImageCompositor] 📂 File EXISTS at path but couldn't load as UIImage")
        // Try loading via Data as a fallback
        if let data = fileManager.contents(atPath: urlString), let image = UIImage(data: data) {
          print("[ImageCompositor] ✅ Loaded image via FileManager.contents")
          loadedImage = image
        }
      } else {
        print("[ImageCompositor] ❌ File DOES NOT EXIST at path: \(urlString)")
      }
    }

    // Try to load from URL if file path didn't work
    if loadedImage == nil {
      if let url = URL(string: uriString), let data = try? Data(contentsOf: url) {
        print("[ImageCompositor] ✅ Loaded image from URL: \(uriString)")
        loadedImage = UIImage(data: data)
      } else {
        print("[ImageCompositor] ⚠️ Failed to load from URL: \(uriString)")
      }
    }

    // Final attempt: Try URL with file scheme directly
    if loadedImage == nil {
      if let fileUrl = URL(string: uriString.hasPrefix("file://") ? uriString : "file://\(urlString)") {
        if let data = try? Data(contentsOf: fileUrl), let image = UIImage(data: data) {
          print("[ImageCompositor] ✅ Loaded image from file URL: \(fileUrl)")
          loadedImage = image
        }
      }
    }

    if loadedImage == nil {
      print("[ImageCompositor] ❌ All loading methods failed for: \(uriString)")
      return nil
    }

    // Normalize image scale to 1.0 to ensure consistent rendering
    // This prevents issues with images that have different embedded scale metadata
    if let image = loadedImage, image.scale != 1.0 {
      // Create a new image with scale 1.0
      if let cgImage = image.cgImage {
        return UIImage(cgImage: cgImage, scale: 1.0, orientation: image.imageOrientation)
      }
    }

    return loadedImage
  }
}

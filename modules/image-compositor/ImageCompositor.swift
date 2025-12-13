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

        let canvasWidth = CGFloat(truncating: width)
        let canvasHeight = CGFloat(truncating: height)
        let canvasSize = CGSize(width: canvasWidth, height: canvasHeight)

        // Create image context
        UIGraphicsBeginImageContextWithOptions(canvasSize, false, 0)
        guard let context = UIGraphicsGetCurrentContext() else {
          reject("E_CONTEXT", "Failed to create graphics context", nil)
          return
        }

        // Fill background with white
        context.setFillColor(UIColor.white.cgColor)
        context.fill(CGRect(origin: .zero, size: canvasSize))

        if layout == "STACK" {
          // Stacked layout (vertical)
          let topH = CGFloat(truncating: topHeight ?? 0)
          let bottomH = CGFloat(truncating: bottomHeight ?? 0)

          // Draw before image on top
          beforeImage.draw(in: CGRect(x: 0, y: 0, width: canvasWidth, height: topH))

          // Draw after image on bottom
          afterImage.draw(in: CGRect(x: 0, y: topH, width: canvasWidth, height: bottomH))

        } else {
          // Side-by-side layout (horizontal)
          let leftW = CGFloat(truncating: leftWidth ?? 0)
          let rightW = CGFloat(truncating: rightWidth ?? 0)

          // Draw before image on left
          beforeImage.draw(in: CGRect(x: 0, y: 0, width: leftW, height: canvasHeight))

          // Draw after image on right
          afterImage.draw(in: CGRect(x: leftW, y: 0, width: rightW, height: canvasHeight))
        }

        // Get the composed image
        guard let composedImage = UIGraphicsGetImageFromCurrentImageContext() else {
          UIGraphicsEndImageContext()
          reject("E_COMPOSE", "Failed to compose image", nil)
          return
        }

        UIGraphicsEndImageContext()

        // Save to temp file
        guard let imageData = composedImage.jpegData(compressionQuality: 0.95) else {
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
        guard let image = self.loadImage(from: imageUri) else {
          reject("LOAD_ERROR", "Failed to load image", nil)
          return
        }

        // Parse label configuration
        let position = labelConfig["position"] as? String ?? "top-left"
        let backgroundColorHex = labelConfig["backgroundColor"] as? String ?? "#FFD700"
        let textColorHex = labelConfig["textColor"] as? String ?? "#000000"
        let fontSize = labelConfig["fontSize"] as? Int ?? 48
        let marginH = labelConfig["marginHorizontal"] as? Int ?? 20
        let marginV = labelConfig["marginVertical"] as? Int ?? 20
        let padding = labelConfig["padding"] as? Int ?? 16

        let backgroundColor = self.hexToUIColor(hex: backgroundColorHex)
        let textColor = self.hexToUIColor(hex: textColorHex)

        // Calculate scaled sizes based on image dimensions (assuming ~1000px as baseline)
        let scale = image.size.width / 1000.0
        let scaledFontSize = max(CGFloat(fontSize) * scale, 24.0)
        let scaledMarginH = max(CGFloat(marginH) * scale, 10.0)
        let scaledMarginV = max(CGFloat(marginV) * scale, 10.0)
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

        // Calculate label position
        let labelRect: CGRect
        switch position {
        case "top-right":
          labelRect = CGRect(
            x: image.size.width - scaledMarginH - labelWidth,
            y: scaledMarginV,
            width: labelWidth,
            height: labelHeight
          )
        case "bottom-left":
          labelRect = CGRect(
            x: scaledMarginH,
            y: image.size.height - scaledMarginV - labelHeight,
            width: labelWidth,
            height: labelHeight
          )
        case "bottom-right":
          labelRect = CGRect(
            x: image.size.width - scaledMarginH - labelWidth,
            y: image.size.height - scaledMarginV - labelHeight,
            width: labelWidth,
            height: labelHeight
          )
        default: // top-left
          labelRect = CGRect(
            x: scaledMarginH,
            y: scaledMarginV,
            width: labelWidth,
            height: labelHeight
          )
        }

        print("[ImageCompositor] 📍 Label Position Calculation:")
        print("  Image size: \(image.size.width) x \(image.size.height)")
        print("  Position: \(position)")
        print("  Text: \(labelText)")
        print("  Scaled fontSize: \(scaledFontSize)")
        print("  Scaled marginH: \(scaledMarginH), marginV: \(scaledMarginV)")
        print("  Label size: \(labelWidth) x \(labelHeight)")
        print("  Label rect: x=\(labelRect.origin.x), y=\(labelRect.origin.y), w=\(labelRect.width), h=\(labelRect.height)")

        // Create image context
        UIGraphicsBeginImageContextWithOptions(image.size, false, 0)

        // Draw original image
        image.draw(at: .zero)

        guard let context = UIGraphicsGetCurrentContext() else {
          UIGraphicsEndImageContext()
          reject("E_CONTEXT", "Failed to create graphics context", nil)
          return
        }

        // Draw label background with rounded corners
        let cornerRadius = 8.0 * scale
        let path = UIBezierPath(roundedRect: labelRect, cornerRadius: cornerRadius)
        context.setFillColor(backgroundColor.cgColor)
        context.addPath(path.cgPath)
        context.fillPath()

        // Draw text centered in the label
        let textRect = CGRect(
          x: labelRect.origin.x + scaledPadding,
          y: labelRect.origin.y + scaledPadding,
          width: textSize.width,
          height: textSize.height
        )
        (labelText as NSString).draw(in: textRect, withAttributes: textAttributes)

        // Get the labeled image
        guard let labeledImage = UIGraphicsGetImageFromCurrentImageContext() else {
          UIGraphicsEndImageContext()
          reject("E_COMPOSE", "Failed to create labeled image", nil)
          return
        }

        UIGraphicsEndImageContext()

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
    var urlString = uriString

    // Handle file:// URLs
    if urlString.hasPrefix("file://") {
      urlString = String(urlString.dropFirst(7))
    }

    // Try to load from file path
    if let image = UIImage(contentsOfFile: urlString) {
      return image
    }

    // Try to load from URL
    if let url = URL(string: uriString), let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }

    return nil
  }
}

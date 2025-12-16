package com.proofpix.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min

class ImageCompositorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Maximum dimension for images to prevent memory issues
    // Android can struggle with images larger than ~4000-5000px when creating bitmaps
    private val maxImageDimension = 4096

    override fun getName(): String {
        return "ImageCompositor"
    }

    @ReactMethod
    fun compositeImages(
        beforeUri: String,
        afterUri: String,
        layout: String,
        width: Int,
        height: Int,
        topH: Int?,
        bottomH: Int?,
        leftW: Int?,
        rightW: Int?,
        promise: Promise
    ) {
        // Run on background thread to avoid blocking UI
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Load bitmaps
                val beforeBitmap = loadBitmap(beforeUri)
                val afterBitmap = loadBitmap(afterUri)

                if (beforeBitmap == null || afterBitmap == null) {
                    promise.reject("LOAD_ERROR", "Failed to load one or both images")
                    return@launch
                }

                // Limit canvas size to prevent memory issues
                var canvasWidth = width
                var canvasHeight = height
                var scaleFactor = 1.0f

                if (canvasWidth > maxImageDimension || canvasHeight > maxImageDimension) {
                    android.util.Log.d("ImageCompositor", "⚠️ Canvas too large ($canvasWidth x $canvasHeight), downscaling...")
                    scaleFactor = min(maxImageDimension.toFloat() / canvasWidth, maxImageDimension.toFloat() / canvasHeight)
                    canvasWidth = (canvasWidth * scaleFactor).toInt()
                    canvasHeight = (canvasHeight * scaleFactor).toInt()
                    android.util.Log.d("ImageCompositor", "✅ Canvas scaled to: $canvasWidth x $canvasHeight")
                }

                // Create combined bitmap
                val combinedBitmap = Bitmap.createBitmap(canvasWidth, canvasHeight, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(combinedBitmap)

                // Fill background with white
                canvas.drawColor(Color.WHITE)

                // Draw images based on layout
                when (layout.uppercase()) {
                    "STACK" -> {
                        // Vertical stack layout
                        val topHeight = ((topH ?: (height / 2)) * scaleFactor).toInt()
                        val bottomHeight = ((bottomH ?: (height / 2)) * scaleFactor).toInt()

                        // Draw before photo on top
                        val beforeScaled = Bitmap.createScaledBitmap(beforeBitmap, canvasWidth, topHeight, true)
                        canvas.drawBitmap(beforeScaled, 0f, 0f, null)
                        beforeScaled.recycle()

                        // Draw after photo on bottom
                        val afterScaled = Bitmap.createScaledBitmap(afterBitmap, canvasWidth, bottomHeight, true)
                        canvas.drawBitmap(afterScaled, 0f, topHeight.toFloat(), null)
                        afterScaled.recycle()
                    }
                    "SIDE" -> {
                        // Side-by-side layout
                        val leftWidth = ((leftW ?: (width / 2)) * scaleFactor).toInt()
                        val rightWidth = ((rightW ?: (width / 2)) * scaleFactor).toInt()

                        // Draw before photo on left
                        val beforeScaled = Bitmap.createScaledBitmap(beforeBitmap, leftWidth, canvasHeight, true)
                        canvas.drawBitmap(beforeScaled, 0f, 0f, null)
                        beforeScaled.recycle()

                        // Draw after photo on right
                        val afterScaled = Bitmap.createScaledBitmap(afterBitmap, rightWidth, canvasHeight, true)
                        canvas.drawBitmap(afterScaled, leftWidth.toFloat(), 0f, null)
                        afterScaled.recycle()
                    }
                    else -> {
                        promise.reject("INVALID_LAYOUT", "Layout must be STACK or SIDE")
                        return@launch
                    }
                }

                // Clean up source bitmaps
                beforeBitmap.recycle()
                afterBitmap.recycle()

                // Save to cache directory
                val cacheDir = reactApplicationContext.cacheDir
                val outputFile = File(cacheDir, "composite_${System.currentTimeMillis()}.jpg")

                withContext(Dispatchers.IO) {
                    FileOutputStream(outputFile).use { out ->
                        // Use 85 quality to match iOS compression
                        combinedBitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    }
                }

                combinedBitmap.recycle()

                // Return file URI
                promise.resolve("file://${outputFile.absolutePath}")

            } catch (e: Exception) {
                promise.reject("COMPOSITE_ERROR", "Failed to composite images: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun addLabelToImage(
        imageUri: String,
        labelText: String,
        labelConfig: ReadableMap,
        promise: Promise
    ) {
        // LOG IMMEDIATELY before any processing to verify we receive the config
        android.util.Log.e("ImageCompositor", "🟢🟢🟢 NATIVE addLabelToImage ENTRY 🟢🟢🟢")
        android.util.Log.e("ImageCompositor", "  labelText: $labelText")
        android.util.Log.e("ImageCompositor", "  hasAbsoluteMargins: ${labelConfig.hasKey("absoluteMargins")}")
        if (labelConfig.hasKey("absoluteMargins")) {
            android.util.Log.e("ImageCompositor", "  absoluteMargins VALUE: ${labelConfig.getBoolean("absoluteMargins")}")
        }
        android.util.Log.e("ImageCompositor", "  hasMarginHorizontal: ${labelConfig.hasKey("marginHorizontal")}")
        if (labelConfig.hasKey("marginHorizontal")) {
            android.util.Log.e("ImageCompositor", "  marginHorizontal VALUE: ${labelConfig.getDouble("marginHorizontal").toInt()}")
        }
        android.util.Log.e("ImageCompositor", "  hasMarginVertical: ${labelConfig.hasKey("marginVertical")}")
        if (labelConfig.hasKey("marginVertical")) {
            // Use getDouble() because JS numbers are always passed as Double through RN bridge
            android.util.Log.e("ImageCompositor", "  marginVertical VALUE: ${labelConfig.getDouble("marginVertical").toInt()}")
        }
        android.util.Log.e("ImageCompositor", "  hasOffsetX: ${labelConfig.hasKey("offsetX")}")
        if (labelConfig.hasKey("offsetX")) {
            android.util.Log.e("ImageCompositor", "  offsetX VALUE: ${labelConfig.getDouble("offsetX").toInt()}")
        }
        android.util.Log.e("ImageCompositor", "  hasOffsetY: ${labelConfig.hasKey("offsetY")}")
        if (labelConfig.hasKey("offsetY")) {
            android.util.Log.e("ImageCompositor", "  offsetY VALUE: ${labelConfig.getDouble("offsetY").toInt()}")
        }
        android.util.Log.e("ImageCompositor", "🟢🟢🟢 END ENTRY LOG 🟢🟢🟢")

        // Run on background thread
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Load original bitmap at full resolution
                var bitmap = loadBitmap(imageUri)
                if (bitmap == null) {
                    promise.reject("LOAD_ERROR", "Failed to load image")
                    return@launch
                }

                // Downscale if image is too large to prevent memory issues
                val originalWidth = bitmap.width
                val originalHeight = bitmap.height
                if (originalWidth > maxImageDimension || originalHeight > maxImageDimension) {
                    android.util.Log.d("ImageCompositor", "⚠️ Image too large ($originalWidth x $originalHeight), downscaling...")
                    val scaleFactor = min(maxImageDimension.toFloat() / originalWidth, maxImageDimension.toFloat() / originalHeight)
                    val newWidth = (originalWidth * scaleFactor).toInt()
                    val newHeight = (originalHeight * scaleFactor).toInt()
                    val scaledBitmap = Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
                    bitmap.recycle()
                    bitmap = scaledBitmap
                    android.util.Log.d("ImageCompositor", "✅ Downscaled to: ${bitmap.width} x ${bitmap.height}")
                }

                // Create a mutable copy to draw on
                val labeledBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
                bitmap.recycle()

                val canvas = Canvas(labeledBitmap)

                // Parse label configuration
                // IMPORTANT: JavaScript numbers are always passed as Double through React Native bridge
                // Using getDouble() and casting to Int is the correct approach (getInt() can truncate incorrectly)
                val position = if (labelConfig.hasKey("position")) labelConfig.getString("position") else "top-left"
                val backgroundColor = if (labelConfig.hasKey("backgroundColor"))
                    Color.parseColor(labelConfig.getString("backgroundColor")) else Color.parseColor("#FFD700")
                val textColor = if (labelConfig.hasKey("textColor"))
                    Color.parseColor(labelConfig.getString("textColor")) else Color.BLACK
                val fontSize = if (labelConfig.hasKey("fontSize")) labelConfig.getDouble("fontSize").toInt() else 48
                val marginH = if (labelConfig.hasKey("marginHorizontal")) labelConfig.getDouble("marginHorizontal").toInt() else 20
                val marginV = if (labelConfig.hasKey("marginVertical")) labelConfig.getDouble("marginVertical").toInt() else 20
                val padding = if (labelConfig.hasKey("padding")) labelConfig.getDouble("padding").toInt() else 16
                // When absoluteMargins is true, margins are already in absolute pixels (not scaled)
                val absoluteMargins = if (labelConfig.hasKey("absoluteMargins")) labelConfig.getBoolean("absoluteMargins") else false
                // Offsets for shifting label position (used for After labels in combined photos)
                val offsetX = if (labelConfig.hasKey("offsetX")) labelConfig.getDouble("offsetX").toInt() else 0
                val offsetY = if (labelConfig.hasKey("offsetY")) labelConfig.getDouble("offsetY").toInt() else 0

                // Calculate scaled sizes based on image dimensions
                // Scale font size and margins based on image width (assuming ~1000px as baseline)
                val scale = labeledBitmap.width / 1000f
                val scaledFontSize = (fontSize * scale).coerceAtLeast(24f)
                // If absoluteMargins is true, use the margins as-is (they're already calculated for the actual image size)
                val scaledMarginH = if (absoluteMargins) marginH else (marginH * scale).toInt().coerceAtLeast(10)
                val scaledMarginV = if (absoluteMargins) marginV else (marginV * scale).toInt().coerceAtLeast(10)
                val scaledPadding = (padding * scale).toInt().coerceAtLeast(8)

                // Setup text paint
                val textPaint = Paint().apply {
                    color = textColor
                    textSize = scaledFontSize
                    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
                    isAntiAlias = true
                }

                // Measure text
                val textBounds = Rect()
                textPaint.getTextBounds(labelText, 0, labelText.length, textBounds)

                // Calculate label background dimensions
                val labelWidth = textBounds.width() + (scaledPadding * 2)
                val labelHeight = textBounds.height() + (scaledPadding * 2)

                // Calculate label position based on 9-position grid
                // Positions: left-top, left-middle, left-bottom, center-top, center-middle, center-bottom, right-top, right-middle, right-bottom
                // Also support legacy format: top-left, top-right, bottom-left, bottom-right
                val pos = position ?: "left-top"

                // Determine horizontal position (x)
                // offsetX is applied to ALL positions to support After label placement in combined photos
                // For SIDE layout: After label needs offsetX = halfWidth to shift to right half
                val labelX: Float = when {
                    pos.contains("left") -> scaledMarginH.toFloat() + offsetX
                    pos.contains("right") -> labeledBitmap.width - scaledMarginH - labelWidth.toFloat() + offsetX
                    else -> {
                        // center
                        (labeledBitmap.width - labelWidth) / 2f + offsetX
                    }
                }

                // Determine vertical position (y)
                // offsetY is applied to ALL positions to support After label placement in combined photos
                // For STACK layout: After label needs offsetY = halfHeight to shift to bottom half
                val labelY: Float = when {
                    pos.contains("top") -> scaledMarginV.toFloat() + offsetY
                    pos.contains("bottom") -> labeledBitmap.height - scaledMarginV - labelHeight.toFloat() + offsetY
                    else -> {
                        // middle
                        (labeledBitmap.height - labelHeight) / 2f + offsetY
                    }
                }

                val labelRect = RectF(
                    labelX,
                    labelY,
                    labelX + labelWidth,
                    labelY + labelHeight
                )

                // CRITICAL: Log position calculation to verify native code is receiving correct values
                android.util.Log.e("ImageCompositor", "🔴🔴🔴 NATIVE LABEL POSITION 🔴🔴🔴")
                android.util.Log.e("ImageCompositor", "  Text: $labelText")
                android.util.Log.e("ImageCompositor", "  Image: ${labeledBitmap.width} x ${labeledBitmap.height}")
                android.util.Log.e("ImageCompositor", "  Position: $position")
                android.util.Log.e("ImageCompositor", "  absoluteMargins: $absoluteMargins")
                android.util.Log.e("ImageCompositor", "  Input marginH: $marginH, marginV: $marginV")
                android.util.Log.e("ImageCompositor", "  scaledMarginH: $scaledMarginH, scaledMarginV: $scaledMarginV")
                android.util.Log.e("ImageCompositor", "  offsetX: $offsetX, offsetY: $offsetY")
                android.util.Log.e("ImageCompositor", "  FINAL labelX: $labelX (halfWidth=${labeledBitmap.width/2})")
                android.util.Log.e("ImageCompositor", "  FINAL labelY: $labelY (halfHeight=${labeledBitmap.height/2})")
                android.util.Log.e("ImageCompositor", "  labelRect: left=${labelRect.left}, top=${labelRect.top}")
                android.util.Log.e("ImageCompositor", "🔴🔴🔴 END NATIVE LABEL 🔴🔴🔴")

                // Draw label background with rounded corners
                val backgroundPaint = Paint().apply {
                    color = backgroundColor
                    isAntiAlias = true
                }
                val cornerRadius = 8f * scale
                canvas.drawRoundRect(labelRect, cornerRadius, cornerRadius, backgroundPaint)

                // Draw text centered in the label
                val textX = labelRect.left + scaledPadding - textBounds.left
                val textY = labelRect.top + scaledPadding - textBounds.top
                canvas.drawText(labelText, textX, textY, textPaint)

                // Save to file
                val cacheDir = reactApplicationContext.cacheDir
                val outputFile = File(cacheDir, "labeled_${System.currentTimeMillis()}.jpg")

                withContext(Dispatchers.IO) {
                    FileOutputStream(outputFile).use { out ->
                        // Use 85 quality to match iOS
                        labeledBitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    }
                }

                labeledBitmap.recycle()

                // Return file URI
                promise.resolve("file://${outputFile.absolutePath}")

            } catch (e: Exception) {
                promise.reject("LABEL_ERROR", "Failed to add label to image: ${e.message}", e)
            }
        }
    }

    private fun loadBitmap(uriString: String): Bitmap? {
        android.util.Log.d("ImageCompositor", "📂 loadBitmap called with: $uriString")
        return try {
            val uri = Uri.parse(uriString)
            var bitmap: Bitmap?
            val exifOrientation: Int

            // Configure BitmapFactory options for best quality
            val options = BitmapFactory.Options().apply {
                inPreferredConfig = Bitmap.Config.ARGB_8888  // Full quality color
                inScaled = false  // Don't scale the bitmap
                inDither = false  // Don't dither
                inPreferQualityOverSpeed = true  // Prefer quality
            }

            when {
                uriString.startsWith("file://") -> {
                    val path = uriString.substring(7)
                    android.util.Log.d("ImageCompositor", "📂 Loading from file path: $path")
                    val file = java.io.File(path)
                    android.util.Log.d("ImageCompositor", "📂 File exists: ${file.exists()}, size: ${file.length()}")
                    bitmap = BitmapFactory.decodeFile(path, options)
                    android.util.Log.d("ImageCompositor", "📂 Bitmap loaded: ${bitmap != null}, size: ${bitmap?.width}x${bitmap?.height}")

                    // Read EXIF orientation
                    val exif = ExifInterface(path)
                    exifOrientation = exif.getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL
                    )
                }
                uriString.startsWith("content://") -> {
                    val inputStream = reactApplicationContext.contentResolver.openInputStream(uri)
                    bitmap = BitmapFactory.decodeStream(inputStream, null, options)
                    inputStream?.close()

                    // Read EXIF orientation from content URI
                    val exifInputStream = reactApplicationContext.contentResolver.openInputStream(uri)
                    val exif = exifInputStream?.let { ExifInterface(it) }
                    exifOrientation = exif?.getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL
                    ) ?: ExifInterface.ORIENTATION_NORMAL
                    exifInputStream?.close()
                }
                else -> {
                    bitmap = BitmapFactory.decodeFile(uriString, options)

                    // Read EXIF orientation
                    val exif = ExifInterface(uriString)
                    exifOrientation = exif.getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_NORMAL
                    )
                }
            }

            // Apply EXIF rotation if needed
            if (bitmap != null && exifOrientation != ExifInterface.ORIENTATION_NORMAL) {
                return rotateBitmap(bitmap, exifOrientation)
            }

            bitmap
        } catch (e: Exception) {
            android.util.Log.e("ImageCompositor", "❌ Error loading bitmap: ${e.message}")
            null
        }
    }

    private fun rotateBitmap(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()

        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.postScale(-1f, 1f)
            }
            else -> return bitmap
        }

        val rotatedBitmap = Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            matrix,
            true
        )

        // Recycle original bitmap if it's different from rotated
        if (rotatedBitmap != bitmap) {
            bitmap.recycle()
        }

        return rotatedBitmap
    }
}

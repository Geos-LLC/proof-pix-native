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

class ImageCompositorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

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

                // Create combined bitmap
                val combinedBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(combinedBitmap)

                // Draw images based on layout
                when (layout.uppercase()) {
                    "STACK" -> {
                        // Vertical stack layout
                        val topHeight = topH ?: (height / 2)
                        val bottomHeight = bottomH ?: (height / 2)

                        // Draw before photo on top
                        val beforeScaled = Bitmap.createScaledBitmap(beforeBitmap, width, topHeight, true)
                        canvas.drawBitmap(beforeScaled, 0f, 0f, null)
                        beforeScaled.recycle()

                        // Draw after photo on bottom
                        val afterScaled = Bitmap.createScaledBitmap(afterBitmap, width, bottomHeight, true)
                        canvas.drawBitmap(afterScaled, 0f, topHeight.toFloat(), null)
                        afterScaled.recycle()
                    }
                    "SIDE" -> {
                        // Side-by-side layout
                        val leftWidth = leftW ?: (width / 2)
                        val rightWidth = rightW ?: (width / 2)

                        // Draw before photo on left
                        val beforeScaled = Bitmap.createScaledBitmap(beforeBitmap, leftWidth, height, true)
                        canvas.drawBitmap(beforeScaled, 0f, 0f, null)
                        beforeScaled.recycle()

                        // Draw after photo on right
                        val afterScaled = Bitmap.createScaledBitmap(afterBitmap, rightWidth, height, true)
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
                        // Use 85 quality to match iOS compression and stay under Vercel 4.5MB limit
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
        // Run on background thread
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Load original bitmap at full resolution
                val bitmap = loadBitmap(imageUri)
                if (bitmap == null) {
                    promise.reject("LOAD_ERROR", "Failed to load image")
                    return@launch
                }

                // Create a mutable copy to draw on
                val labeledBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
                bitmap.recycle()

                val canvas = Canvas(labeledBitmap)

                // Parse label configuration
                val position = if (labelConfig.hasKey("position")) labelConfig.getString("position") else "top-left"
                val backgroundColor = if (labelConfig.hasKey("backgroundColor"))
                    Color.parseColor(labelConfig.getString("backgroundColor")) else Color.parseColor("#FFD700")
                val textColor = if (labelConfig.hasKey("textColor"))
                    Color.parseColor(labelConfig.getString("textColor")) else Color.BLACK
                val fontSize = if (labelConfig.hasKey("fontSize")) labelConfig.getInt("fontSize") else 48
                val marginH = if (labelConfig.hasKey("marginHorizontal")) labelConfig.getInt("marginHorizontal") else 20
                val marginV = if (labelConfig.hasKey("marginVertical")) labelConfig.getInt("marginVertical") else 20
                val padding = if (labelConfig.hasKey("padding")) labelConfig.getInt("padding") else 16

                // Calculate scaled sizes based on image dimensions
                // Scale font size and margins based on image width (assuming ~1000px as baseline)
                val scale = labeledBitmap.width / 1000f
                val scaledFontSize = (fontSize * scale).coerceAtLeast(24f)
                val scaledMarginH = (marginH * scale).toInt().coerceAtLeast(10)
                val scaledMarginV = (marginV * scale).toInt().coerceAtLeast(10)
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

                // Calculate label position
                val labelRect = when (position) {
                    "top-left" -> RectF(
                        scaledMarginH.toFloat(),
                        scaledMarginV.toFloat(),
                        scaledMarginH + labelWidth.toFloat(),
                        scaledMarginV + labelHeight.toFloat()
                    )
                    "top-right" -> RectF(
                        labeledBitmap.width - scaledMarginH - labelWidth.toFloat(),
                        scaledMarginV.toFloat(),
                        labeledBitmap.width - scaledMarginH.toFloat(),
                        scaledMarginV + labelHeight.toFloat()
                    )
                    "bottom-left" -> RectF(
                        scaledMarginH.toFloat(),
                        labeledBitmap.height - scaledMarginV - labelHeight.toFloat(),
                        scaledMarginH + labelWidth.toFloat(),
                        labeledBitmap.height - scaledMarginV.toFloat()
                    )
                    "bottom-right" -> RectF(
                        labeledBitmap.width - scaledMarginH - labelWidth.toFloat(),
                        labeledBitmap.height - scaledMarginV - labelHeight.toFloat(),
                        labeledBitmap.width - scaledMarginH.toFloat(),
                        labeledBitmap.height - scaledMarginV.toFloat()
                    )
                    else -> RectF(
                        scaledMarginH.toFloat(),
                        scaledMarginV.toFloat(),
                        scaledMarginH + labelWidth.toFloat(),
                        scaledMarginV + labelHeight.toFloat()
                    )
                }

                android.util.Log.d("ImageCompositor", "📍 Label Position Calculation:")
                android.util.Log.d("ImageCompositor", "  Image size: ${labeledBitmap.width} x ${labeledBitmap.height}")
                android.util.Log.d("ImageCompositor", "  Position: $position")
                android.util.Log.d("ImageCompositor", "  Text: $labelText")
                android.util.Log.d("ImageCompositor", "  Scaled fontSize: $scaledFontSize")
                android.util.Log.d("ImageCompositor", "  Scaled marginH: $scaledMarginH, marginV: $scaledMarginV")
                android.util.Log.d("ImageCompositor", "  Label size: $labelWidth x $labelHeight")
                android.util.Log.d("ImageCompositor", "  Label rect: left=${labelRect.left}, top=${labelRect.top}, right=${labelRect.right}, bottom=${labelRect.bottom}")

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
                        // Use 85 quality to reduce file size and stay under Vercel 4.5MB limit
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
            val bitmap: Bitmap?
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

package com.proofpix.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
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
                        combinedBitmap.compress(Bitmap.CompressFormat.JPEG, 98, out)
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

    private fun loadBitmap(uriString: String): Bitmap? {
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
                    bitmap = BitmapFactory.decodeFile(path, options)

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

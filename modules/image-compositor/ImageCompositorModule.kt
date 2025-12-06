package com.proofpix.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.net.Uri
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
                        combinedBitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
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
            val path = when {
                uriString.startsWith("file://") -> uriString.substring(7)
                uriString.startsWith("content://") -> {
                    // For content URIs, we need to use content resolver
                    val inputStream = reactApplicationContext.contentResolver.openInputStream(uri)
                    return BitmapFactory.decodeStream(inputStream)
                }
                else -> uriString
            }

            BitmapFactory.decodeFile(path)
        } catch (e: Exception) {
            null
        }
    }
}

package com.proofpix.app

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.OutputStream

class MediaStoreSaverModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "MediaStoreSaver"
    }

    @ReactMethod
    fun saveImageToGallery(sourceUri: String, fileName: String, promise: Promise) {
        try {
            val context: Context = reactApplicationContext
            val sourceFile = File(sourceUri.replace("file://", ""))

            if (!sourceFile.exists()) {
                promise.reject("FILE_NOT_FOUND", "Source file does not exist: $sourceUri")
                return
            }

            // Use MediaStore to save the image
            val contentValues = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")

                // On Android 10+ (API 29+), use relative path
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/ProofPix")
                    put(MediaStore.Images.Media.IS_PENDING, 1) // Mark as pending during write
                }
            }

            val contentResolver = context.contentResolver
            val imageUri: Uri? = contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                contentValues
            )

            if (imageUri == null) {
                promise.reject("INSERT_FAILED", "Failed to create MediaStore entry")
                return
            }

            // Copy file data to the MediaStore URI
            var outputStream: OutputStream? = null
            var inputStream: FileInputStream? = null

            try {
                outputStream = contentResolver.openOutputStream(imageUri)
                inputStream = FileInputStream(sourceFile)

                if (outputStream == null) {
                    promise.reject("STREAM_ERROR", "Failed to open output stream")
                    return
                }

                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    outputStream.write(buffer, 0, bytesRead)
                }

                outputStream.flush()

                // On Android 10+, mark as completed
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    contentValues.clear()
                    contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
                    contentResolver.update(imageUri, contentValues, null, null)
                }

                promise.resolve(imageUri.toString())

            } finally {
                inputStream?.close()
                outputStream?.close()
            }

        } catch (e: Exception) {
            promise.reject("SAVE_ERROR", "Failed to save image: ${e.message}", e)
        }
    }
}

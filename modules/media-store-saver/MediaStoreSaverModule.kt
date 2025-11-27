package com.proofpix.app

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
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

    @ReactMethod
    fun deleteImagesFromGallery(fileNames: ReadableArray, promise: Promise) {
        try {
            val context: Context = reactApplicationContext
            val contentResolver = context.contentResolver
            var deletedCount = 0
            val failedFiles = mutableListOf<String>()

            for (i in 0 until fileNames.size()) {
                val fileName = fileNames.getString(i)
                if (fileName == null) continue

                // Query MediaStore for images with this display name in ProofPix folder
                val selection = "${MediaStore.Images.Media.DISPLAY_NAME} = ? AND ${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?"
                val selectionArgs = arrayOf(fileName, "%Pictures/ProofPix%")

                val projection = arrayOf(MediaStore.Images.Media._ID)

                var cursor: Cursor? = null
                try {
                    cursor = contentResolver.query(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        projection,
                        selection,
                        selectionArgs,
                        null
                    )

                    if (cursor != null && cursor.moveToFirst()) {
                        val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                        val id = cursor.getLong(idColumn)
                        val imageUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

                        // Delete the image
                        val deleted = contentResolver.delete(imageUri, null, null)
                        if (deleted > 0) {
                            deletedCount++
                        } else {
                            failedFiles.add(fileName)
                        }
                    } else {
                        failedFiles.add("$fileName (not found)")
                    }
                } finally {
                    cursor?.close()
                }
            }

            if (failedFiles.isEmpty()) {
                promise.resolve("Successfully deleted $deletedCount images")
            } else {
                promise.resolve("Deleted $deletedCount images. Failed: ${failedFiles.joinToString(", ")}")
            }

        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", "Failed to delete images: ${e.message}", e)
        }
    }
}

import googleAuthService from './googleAuthService';

const FOLDER_NAME = 'ProofPix-Uploads';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

class GoogleDriveService {
  /**
   * Finds or creates a "ProofPix-Uploads" category in the user's Google Drive.
   * @returns {Promise<string|null>} The ID of the category, or null if an error occurs.
   */
  async findOrCreateProofPixFolder() {
    try {
      const folderId = await this.findFolder();
      if (folderId) {
        return folderId;
      } else {
        const newFolderId = await this.createFolder();
        return newFolderId;
      }
    } catch (error) {
      console.error('Error in findOrCreateProofPixFolder:', error);
      throw new Error('Could not find or create the ProofPix folder in Google Drive.');
    }
  }

  /**
   * Searches for a folder with the name "ProofPix-Uploads".
   * @private
   * @returns {Promise<string|null>} The folder ID if found, otherwise null.
   */
  async findFolder() {
    const query = `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`;
    const url = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id)`;

    const response = await googleAuthService.makeAuthenticatedRequest(url);

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      console.error('Drive API search error:', { status, errorText });
      
      if (status === 403) {
        throw new Error('Drive API access denied. Please ensure you granted Drive permissions during sign-in.');
      } else if (status === 401) {
        throw new Error('Authentication failed. Please sign in again.');
      } else {
        throw new Error(`Failed to search for folder in Google Drive (${status}): ${errorText}`);
      }
    }

    const data = await response.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    return null;
  }

  /**
   * Creates a new folder named "ProofPix-Uploads".
   * @private
   * @returns {Promise<string>} The ID of the newly created folder.
   */
  async createFolder() {
    const metadata = {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const response = await googleAuthService.makeAuthenticatedRequest(DRIVE_API_URL, {
      method: 'POST',
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create folder:', errorText);
      throw new Error('Failed to create folder in Google Drive.');
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Find or create an album folder within the ProofPix-Uploads folder
   * @param {string} parentFolderId - Parent folder ID (ProofPix-Uploads)
   * @param {string} albumName - Album folder name
   * @returns {Promise<string>} The ID of the album folder
   */
  async findOrCreateAlbumFolder(parentFolderId, albumName) {
    try {
      // Search for existing folder
      const query = `mimeType='application/vnd.google-apps.folder' and name='${albumName}' and '${parentFolderId}' in parents and trashed=false`;
      const url = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id)`;
      
      const searchResponse = await googleAuthService.makeAuthenticatedRequest(url);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.files && searchData.files.length > 0) {
          return searchData.files[0].id;
        }
      }

      // Create new folder if not found
      const metadata = {
        name: albumName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      };

      const createResponse = await googleAuthService.makeAuthenticatedRequest(DRIVE_API_URL, {
        method: 'POST',
        body: JSON.stringify(metadata),
      });

      if (!createResponse.ok) {
        throw new Error('Failed to create album folder in Google Drive.');
      }

      const createData = await createResponse.json();
      return createData.id;
    } catch (error) {
      console.error('Error in findOrCreateAlbumFolder:', error);
      throw error;
    }
  }

  /**
   * Find or create a subfolder (e.g., before/after/combined) within an album folder
   * @param {string} albumFolderId - Album folder ID
   * @param {string} subfolderName - Subfolder name (before, after, combined, or formats/format)
   * @returns {Promise<string>} The ID of the subfolder
   */
  async findOrCreateSubfolder(albumFolderId, subfolderName) {
    try {
      // Search for existing folder
      const query = `mimeType='application/vnd.google-apps.folder' and name='${subfolderName}' and '${albumFolderId}' in parents and trashed=false`;
      const url = `${DRIVE_API_URL}?q=${encodeURIComponent(query)}&fields=files(id)`;
      
      const searchResponse = await googleAuthService.makeAuthenticatedRequest(url);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.files && searchData.files.length > 0) {
          return searchData.files[0].id;
        }
      }

      // Create new folder if not found
      const metadata = {
        name: subfolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [albumFolderId],
      };

      const createResponse = await googleAuthService.makeAuthenticatedRequest(DRIVE_API_URL, {
        method: 'POST',
        body: JSON.stringify(metadata),
      });

      if (!createResponse.ok) {
        throw new Error('Failed to create subfolder in Google Drive.');
      }

      const createData = await createResponse.json();
      return createData.id;
    } catch (error) {
      console.error('Error in findOrCreateSubfolder:', error);
      throw error;
    }
  }

  /**
   * Upload a file from URI directly to Google Drive (bypasses Vercel 4.5MB limit)
   * This method reads the file directly without base64 encoding, allowing large files
   * @param {string} fileUri - File URI (file://...)
   * @param {string} filename - File name
   * @param {string} parentFolderId - Parent folder ID
   * @param {string} mimeType - MIME type (default: image/jpeg)
   * @returns {Promise<Object>} Upload result with fileId
   */
  async uploadFileFromUri(fileUri, filename, parentFolderId, mimeType = 'image/jpeg') {
    try {
      console.log('[GoogleDrive] 📤 Starting direct upload from URI:', { filename, fileUri: fileUri?.substring(0, 50) });

      const { accessToken } = await googleAuthService.getTokens();

      // Read file as base64 using FileSystem
      const FileSystem = require('expo-file-system/legacy').default;
      const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });

      console.log('[GoogleDrive] 📦 File read, size:', (base64Data.length * 0.75 / 1024 / 1024).toFixed(2), 'MB');

      // Decode base64 to binary
      const binaryData = atob(base64Data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }

      // Create multipart body
      const boundary = '----ProofPixUploadBoundary' + Date.now();
      const metadata = {
        name: filename,
        parents: [parentFolderId],
      };

      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
      const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const endBoundary = `\r\n--${boundary}--\r\n`;

      // Convert parts to ArrayBuffer
      const encoder = new TextEncoder();
      const metadataBytes = encoder.encode(metadataPart);
      const filePartBytes = encoder.encode(filePart);
      const endBytes = encoder.encode(endBoundary);

      const totalLength = metadataBytes.length + filePartBytes.length + bytes.length + endBytes.length;
      const body = new Uint8Array(totalLength);

      let offset = 0;
      body.set(metadataBytes, offset);
      offset += metadataBytes.length;
      body.set(filePartBytes, offset);
      offset += filePartBytes.length;
      body.set(bytes, offset);
      offset += bytes.length;
      body.set(endBytes, offset);

      console.log('[GoogleDrive] 🚀 Uploading to Drive API...');
      const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GoogleDrive] ❌ Upload error:', errorText);
        throw new Error(`Failed to upload file to Google Drive: ${response.status}`);
      }

      const result = await response.json();
      console.log('[GoogleDrive] ✅ Upload successful, fileId:', result.id);

      return {
        success: true,
        fileId: result.id,
        fileName: filename,
      };
    } catch (error) {
      console.error('[GoogleDrive] ❌ Error uploading file from URI:', error);
      throw error;
    }
  }

  /**
   * Upload a file directly to Google Drive using multipart upload (legacy - base64)
   * @param {string} fileData - Base64 encoded file data
   * @param {string} filename - File name
   * @param {string} parentFolderId - Parent folder ID
   * @param {string} mimeType - MIME type (default: image/jpeg)
   * @returns {Promise<Object>} Upload result with fileId
   */
  async uploadFile(fileData, filename, parentFolderId, mimeType = 'image/jpeg') {
    try {
      const { accessToken } = await googleAuthService.getTokens();
      
      // Decode base64 to binary
      const binaryData = atob(fileData);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }

      // Create multipart body
      const boundary = '----ProofPixUploadBoundary' + Date.now();
      const metadata = {
        name: filename,
        parents: [parentFolderId],
      };

      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
      const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const endBoundary = `\r\n--${boundary}--\r\n`;

      // Convert parts to ArrayBuffer
      const encoder = new TextEncoder();
      const metadataBytes = encoder.encode(metadataPart);
      const filePartBytes = encoder.encode(filePart);
      const endBytes = encoder.encode(endBoundary);

      const totalLength = metadataBytes.length + filePartBytes.length + bytes.length + endBytes.length;
      const body = new Uint8Array(totalLength);
      
      let offset = 0;
      body.set(metadataBytes, offset);
      offset += metadataBytes.length;
      body.set(filePartBytes, offset);
      offset += filePartBytes.length;
      body.set(bytes, offset);
      offset += bytes.length;
      body.set(endBytes, offset);

      const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Drive API upload error:', errorText);
        throw new Error(`Failed to upload file to Google Drive: ${response.status}`);
      }

      const result = await response.json();
      return {
        success: true,
        fileId: result.id,
        fileName: filename,
      };
    } catch (error) {
      console.error('Error uploading file to Drive:', error);
      throw error;
    }
  }
}

export default new GoogleDriveService();



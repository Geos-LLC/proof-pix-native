import dropboxAuthService from './dropboxAuthService';
import * as FileSystem from 'expo-file-system/legacy';

const FOLDER_NAME = 'ProofPix-Uploads';
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_API_URL = 'https://content.dropboxapi.com/2';

// Cache folder paths to avoid repeated API calls
let cachedProofPixFolderPath = null;
const albumFolderCache = new Map();

// Retry helper for rate limiting
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorMessage = error.message || '';
      const isRateLimit = errorMessage.includes('too_many_requests') || 
                         errorMessage.includes('too_many_write_operations') ||
                         errorMessage.includes('rate_limit');
      
      if (isRateLimit && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        const retryAfter = errorMessage.match(/retry_after[":\s]+(\d+)/i)?.[1];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay;
        
        console.log(`[DROPBOX] Rate limited, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
}

class DropboxService {
  /**
   * Finds or creates a "ProofPix-Uploads" folder in the user's Dropbox.
   * Uses caching to avoid repeated API calls.
   * @returns {Promise<string|null>} The path of the folder, or null if an error occurs.
   */
  async findOrCreateProofPixFolder() {
    // Return cached path if available
    if (cachedProofPixFolderPath) {
      return cachedProofPixFolderPath;
    }

    try {
      const folderPath = await retryWithBackoff(async () => {
        const found = await this.findFolder();
        if (found) {
          console.log('[DROPBOX] Found existing ProofPix folder:', found);
          return found;
        } else {
          console.log('[DROPBOX] ProofPix folder not found, creating a new one...');
          const created = await this.createFolder();
          console.log('[DROPBOX] Created new ProofPix folder:', created);
          return created;
        }
      });
      
      // Cache the result
      cachedProofPixFolderPath = folderPath;
      return folderPath;
    } catch (error) {
      console.error('[DROPBOX] Error in findOrCreateProofPixFolder:', error);
      throw new Error('Could not find or create the ProofPix folder in Dropbox.');
    }
  }

  /**
   * Clear the folder cache (useful for testing or when folders are deleted)
   */
  clearFolderCache() {
    cachedProofPixFolderPath = null;
    albumFolderCache.clear();
  }

  /**
   * Searches for a folder with the name "ProofPix-Uploads".
   * @private
   * @returns {Promise<string|null>} The folder path if found, otherwise null.
   */
  async findFolder() {
    try {
      const response = await dropboxAuthService.makeAuthenticatedRequest(
        `${DROPBOX_API_URL}/files/list_folder`,
        {
          method: 'POST',
          body: JSON.stringify({
            path: '',
            recursive: false,
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed. Please sign in again.');
        }
        const errorText = await response.text();
        throw new Error(`Failed to list Dropbox folders (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const folder = data.entries?.find(
        (entry) => entry.name === FOLDER_NAME && entry['.tag'] === 'folder'
      );

      return folder ? folder.path_lower : null;
    } catch (error) {
      console.error('Error finding folder:', error);
      throw error;
    }
  }

  /**
   * Creates a new folder named "ProofPix-Uploads".
   * @private
   * @returns {Promise<string>} The path of the newly created folder.
   */
  async createFolder() {
    try {
      const response = await dropboxAuthService.makeAuthenticatedRequest(
        `${DROPBOX_API_URL}/files/create_folder_v2`,
        {
          method: 'POST',
          body: JSON.stringify({
            path: `/${FOLDER_NAME}`,
            autorename: false,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to create folder:', errorText);
        throw new Error('Failed to create folder in Dropbox.');
      }

      const data = await response.json();
      return data.metadata.path_lower;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  }

  /**
   * Upload a file to Dropbox
   * @param {string} filePath - Path in Dropbox (e.g., "/ProofPix-Uploads/filename.jpg")
   * @param {string} fileUri - File URI (local file path)
   * @param {string} mode - 'add' (default) or 'overwrite'
   * @returns {Promise<object>} Upload result with file metadata
   */
  async uploadFile(filePath, fileUri, mode = 'add') {
    try {
      // Read file as base64
      let fileContent;
      if (fileUri.startsWith('data:')) {
        // Extract base64 from data URL
        const base64Match = fileUri.match(/^data:[^;]+;base64,(.+)$/);
        if (base64Match) {
          fileContent = base64Match[1];
        } else {
          throw new Error('Invalid data URL format');
        }
      } else {
        // Read file from URI as base64
        fileContent = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      // Dropbox upload uses content.dropboxapi.com (not api.dropboxapi.com)
      // Convert base64 to binary Uint8Array (React Native fetch accepts Uint8Array directly)
      let binaryData;
      try {
        const binaryString = atob(fileContent);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // Use Uint8Array directly (React Native fetch accepts this)
        binaryData = bytes;
      } catch (error) {
        throw new Error(`Failed to convert base64 to binary: ${error.message}`);
      }

      // Get access token for authorization (makeAuthenticatedRequest handles token refresh)
      await dropboxAuthService.loadStoredTokens();
      if (!dropboxAuthService.isAuthenticated()) {
        throw new Error('Not authenticated with Dropbox');
      }
      
      // Get valid token (will be refreshed if needed by makeAuthenticatedRequest)
      let token = dropboxAuthService.getAccessToken();
      
      // Ensure token is valid - refresh if needed
      // Check token expiry by trying to refresh
      if (!token) {
        throw new Error('No access token available. Please sign in to Dropbox.');
      }

      // Dropbox upload endpoint is on content.dropboxapi.com with binary data
      // Use retry logic for rate limiting
      const response = await retryWithBackoff(async () => {
        // Re-check token before each retry (in case it expired)
        await dropboxAuthService.loadStoredTokens();
        token = dropboxAuthService.getAccessToken();
        if (!token) {
          throw new Error('Access token not available');
        }

        return await fetch(`${DROPBOX_CONTENT_API_URL}/files/upload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': JSON.stringify({
              path: filePath,
              mode: mode === 'overwrite' ? { '.tag': 'overwrite' } : { '.tag': 'add' },
              autorename: true,
              mute: false,
            }),
          },
          body: binaryData,
        });
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        throw new Error(errorData.error_summary || errorData.error?.reason?.['.tag'] || `Failed to upload file to Dropbox: ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Find or create an album folder within the ProofPix-Uploads folder
   * Uses caching to avoid repeated API calls.
   * @param {string} parentFolderPath - Parent folder path (e.g., "/proofpix-uploads")
   * @param {string} albumName - Album folder name
   * @returns {Promise<string>} The path of the album folder
   */
  async findOrCreateAlbumFolder(parentFolderPath, albumName) {
    const cacheKey = `${parentFolderPath}/${albumName}`;
    
    // Return cached path if available
    if (albumFolderCache.has(cacheKey)) {
      return albumFolderCache.get(cacheKey);
    }

    try {
      const albumPath = await retryWithBackoff(async () => {
        const albumPath = `${parentFolderPath}/${albumName}`;

        // Try to find existing folder
        try {
          const response = await dropboxAuthService.makeAuthenticatedRequest(
            `${DROPBOX_API_URL}/files/get_metadata`,
            {
              method: 'POST',
              body: JSON.stringify({
                path: albumPath,
              }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data['.tag'] === 'folder') {
              return data.path_lower;
            }
          }
        } catch (error) {
          // Folder doesn't exist, create it
        }

        // Create folder with retry logic
        const response = await dropboxAuthService.makeAuthenticatedRequest(
          `${DROPBOX_API_URL}/files/create_folder_v2`,
          {
            method: 'POST',
            body: JSON.stringify({
              path: albumPath,
              autorename: false,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create album folder: ${errorText}`);
        }

        const data = await response.json();
        return data.metadata.path_lower;
      });

      // Cache the result
      albumFolderCache.set(cacheKey, albumPath);
      return albumPath;
    } catch (error) {
      console.error('[DROPBOX] Error in findOrCreateAlbumFolder:', error);
      throw error;
    }
  }
}

// Export singleton instance
const dropboxService = new DropboxService();
export default dropboxService;


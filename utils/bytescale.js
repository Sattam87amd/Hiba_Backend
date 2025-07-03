// utils/bytescale.js - FIXED VERSION
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();

/**
 * Sanitize filename to remove special characters and spaces
 */
const sanitizeFileName = (fileName) => {
  // Remove or replace problematic characters
  return fileName
    .replace(/[^a-zA-Z0-9.-]/g, "_") // Replace special chars with underscore
    .replace(/_+/g, "_") // Replace multiple underscores with single
    .replace(/^_|_$/g, ""); // Remove leading/trailing underscores
};

/**
 * Upload file buffer to Bytescale using the correct FormDataUpload endpoint
 */
const uploadToBytescaleMain = async (
  fileBuffer,
  fileName,
  mimeType,
  baseFolder = "uploads" // Always default to "uploads"
) => {
  try {
    // 🔥 Always use "uploads" as the root folder
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const datedFolder = `uploads/${year}/${month}/${day}`; // Force "uploads" as root

    // Sanitize and generate unique filename
    const timestamp = Date.now();
    const sanitizedFileName = sanitizeFileName(fileName);
    const uniqueFileName = `${timestamp}-${sanitizedFileName}`;
    const filePath = `${datedFolder}/${uniqueFileName}`;

    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: uniqueFileName,
      contentType: mimeType,
    });
    formData.append("path", filePath);

    const apiUrl = `https://api.bytescale.com/v2/accounts/${process.env.BYTESCALE_ACCOUNT_ID}/uploads/form_data`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.BYTESCALE_SECRET_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Upload failed with error:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    // Find the file object for the uploaded file
    let fileObj;
    if (Array.isArray(result.files)) {
      fileObj = result.files.find(f => f.formDataFieldName === "file");
    }

    if (!fileObj || !fileObj.filePath) {
      console.error("Bytescale API did not return filePath:", result);
      throw new Error("Bytescale API did not return filePath. Response: " + JSON.stringify(result));
    }

    const finalFilePath = fileObj.filePath;
    const fileUrl = fileObj.fileUrl || `https://upcdn.io/${process.env.BYTESCALE_ACCOUNT_ID}/raw/${finalFilePath.replace(/^\//, "")}`;

    return {
      success: true,
      fileUrl,
      filePath: finalFilePath,
      originalSize: fileBuffer.length,
      mimeType,
      metadata: {
        fileName: uniqueFileName,
        originalFileName: fileName,
        folder: datedFolder,
        timestamp,
        bytescaleResponse: result,
      },
    };
  } catch (error) {
    console.error("Complete upload error:", error);
    throw new Error(`Upload failed: ${error.message}`);
  }
};

/**
 * Alternative upload method using the Files endpoint (as suggested by Bytescale)
 */
export const uploadToBytescaleAlternative = async (
  fileBuffer,
  fileName,
  mimeType,
  folder = "uploads" // Always default to "uploads"
) => {
  try {
    console.log("Trying alternative Files endpoint upload method...");

    const formData = new FormData();
    const sanitizedFileName = sanitizeFileName(fileName);
    const uniqueFileName = `${Date.now()}-${sanitizedFileName}`;
    // Always use "uploads" as the root folder
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const datedFolder = `uploads/${year}/${month}/${day}`;
    const filePath = `/${datedFolder}/${uniqueFileName}`;

    // Add file to FormData
    formData.append("file", fileBuffer, {
      filename: uniqueFileName,
      contentType: mimeType,
    });

    // Add path for organization
    formData.append("path", filePath);

    // 🔥 Alternative endpoint as suggested by Bytescale support
    const apiUrl = `https://api.bytescale.com/v2/accounts/${
      process.env.BYTESCALE_ACCOUNT_ID || process.env.ACCOUNT_ID
    }/files`;
    console.log("Making request to Files endpoint:", apiUrl);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${
          process.env.BYTESCALE_SECRET_KEY || process.env.SECRET_KEY
        }`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Alternative upload failed:", errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("Alternative upload successful:", result);

    // Construct file URL
    let fileUrl;
    if (result.fileUrl) {
      fileUrl = result.fileUrl;
    } else if (result.filePath) {
      fileUrl = `https://upcdn.io/${
        process.env.BYTESCALE_ACCOUNT_ID || process.env.ACCOUNT_ID
      }/raw${result.filePath}`;
    } else {
      fileUrl = `https://upcdn.io/${
        process.env.BYTESCALE_ACCOUNT_ID || process.env.ACCOUNT_ID
      }/raw${filePath}`;
    }

    return {
      success: true,
      fileUrl: fileUrl,
      filePath: result.filePath || filePath,
      accountId: process.env.BYTESCALE_ACCOUNT_ID || process.env.ACCOUNT_ID,
      originalSize: fileBuffer.length,
      mimeType: mimeType,
      metadata: {
        fileName: uniqueFileName,
        originalFileName: fileName,
        folder: datedFolder,
        uploadMethod: "files_endpoint",
        bytescaleResponse: result,
      },
    };
  } catch (error) {
    console.error("Alternative upload error:", error);
    throw error;
  }
};

/**
 * Main upload function with fallback
 */
export const uploadToBytescaleWithFallback = async (
  fileBuffer,
  fileName,
  mimeType,
  folder = "uploads"
) => {
  try {
    // Try the FormDataUpload endpoint first
    return await uploadToBytescaleMain(fileBuffer, fileName, mimeType, folder);
  } catch (error) {
    console.log("FormDataUpload method failed, trying Files endpoint...");
    try {
      return await uploadToBytescaleAlternative(
        fileBuffer,
        fileName,
        mimeType,
        folder
      );
    } catch (altError) {
      console.error("Both upload methods failed");
      throw new Error(
        `All upload methods failed. FormData: ${error.message}, Files: ${altError.message}`
      );
    }
  }
};

/**
 * Generate optimized image URL using Bytescale's image processing
 */
export const getOptimizedImageUrl = (fileUrl, options = {}) => {
  if (!fileUrl || !fileUrl.includes("upcdn.io")) return fileUrl;

  const {
    width = null,
    height = null,
    quality = 85,
    format = "auto",
    fit = "cover",
  } = options;

  try {
    // For Bytescale, use the image processing endpoint
    if (fileUrl.includes("/raw/")) {
      const params = new URLSearchParams();

      if (width) params.append("w", width);
      if (height) params.append("h", height);
      if (width || height) params.append("fit", fit);
      params.append("q", quality);
      if (format !== "auto") params.append("f", format);

      // Change from /raw/ to /image/ and add parameters
      const transformedUrl =
        fileUrl.replace("/raw/", "/image/") + "?" + params.toString();
      return transformedUrl;
    }

    return fileUrl;
  } catch (error) {
    console.error("Error generating optimized URL:", error);
    return fileUrl;
  }
};

/**
 * Extract Bytescale file path from full URL
 */
export const extractBytescaleFilePath = (url) => {
  // Example: https://upcdn.io/G22nhmn/raw/uploads/2025/06/20/4jhk9sbFwU-1750419797970-h.jpg
  // Should return: /uploads/2025/06/20/4jhk9sbFwU-1750419797970-h.jpg
  const match = url.match(/\/raw(\/.*)$/);
  return match ? match[1] : null;
};

/**
 * Delete file from Bytescale
 */
export const deleteFromBytescale = async (filePath) => {
  try {
    // Ensure leading slash
    if (!filePath.startsWith('/')) {
      filePath = '/' + filePath;
    }

    const response = await fetch(
      `https://api.bytescale.com/v2/accounts/${process.env.BYTESCALE_ACCOUNT_ID}/files?filePath=${encodeURIComponent(filePath)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${process.env.BYTESCALE_SECRET_KEY}`,
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Delete failed:", errorText);
      return { success: false, message: "File deletion failed" };
    }

    return { success: true, message: "File deleted successfully" };
  } catch (error) {
    console.error("Delete error:", error);
    return { success: false, message: "File deletion failed" };
  }
};

/**
 * Validate file before upload
 */
export const validateFile = (file) => {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/gif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (!file) {
    return { isValid: false, error: "No file provided" };
  }

  if (file.size > maxSize) {
    return { isValid: false, error: "File size exceeds 10MB limit" };
  }

  if (!allowedTypes.includes(file.mimetype)) {
    return { isValid: false, error: "Unsupported file type" };
  }

  return { isValid: true };
};

/**
 * Decode URL and handle special characters properly
 */
export const decodeImageUrl = (imageUrl) => {
  if (!imageUrl) return null;

  try {
    // Decode the URL to handle special characters
    const decodedUrl = decodeURIComponent(imageUrl);

    // If it's a Bytescale URL, make sure it's properly formatted
    if (decodedUrl.includes("upcdn.io")) {
      // Replace any remaining problematic characters
      return decodedUrl.replace(/\s+/g, "%20");
    }

    return decodedUrl;
  } catch (error) {
    console.error("Error decoding image URL:", error);
    return imageUrl; // Return original if decoding fails
  }
};

/**
 * Normalize image URL to ensure it's accessible
 * Handles both local uploads and Bytescale URLs
 */
export const normalizeImageUrl = (
  imageUrl,
  baseUrl = "http://localhost:5070"
) => {
  if (!imageUrl) return null;

  // First decode the URL
  const decodedUrl = decodeImageUrl(imageUrl);

  // If it's already a full URL (Bytescale or other CDN), return as is
  if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
    return decodedUrl;
  }

  // If it's a relative path, make it absolute
  if (decodedUrl.startsWith("/")) {
    return `${baseUrl}${decodedUrl}`;
  }

  // If it's just a filename, assume it's in uploads directory
  // Handle date-based subdirectories like "2025/06/17/filename.jpg"
  if (decodedUrl.includes("/")) {
    // It's already a path with subdirectories
    return `${baseUrl}/uploads/${decodedUrl}`;
  }

  // If it's just a filename, assume it's in uploads directory
  return `${baseUrl}/uploads/${decodedUrl}`;
};

/**
 * Get optimized image URL with fallback to original
 */
export const getOptimizedImageUrlWithFallback = (imageUrl, options = {}) => {
  if (!imageUrl) return null;

  try {
    // If it's a Bytescale URL, optimize it
    if (imageUrl.includes("upcdn.io")) {
      return getOptimizedImageUrl(imageUrl, options);
    }

    // For local files, return as is (they'll be served by Express static)
    return imageUrl;
  } catch (error) {
    console.error("Error optimizing image URL:", error);
    return imageUrl;
  }
};

/**
 * Frontend-friendly function to handle image URLs
 * This can be used in the frontend to fix URL encoding issues
 */
export const fixImageUrlForFrontend = (imageUrl) => {
  if (!imageUrl) return null;

  try {
    // If it's a Bytescale URL, handle encoding issues
    if (imageUrl.includes("upcdn.io")) {
      // Decode the URL first
      let decodedUrl = decodeURIComponent(imageUrl);

      // Replace any remaining problematic characters
      decodedUrl = decodedUrl.replace(/\s+/g, "%20");

      return decodedUrl;
    }

    return imageUrl;
  } catch (error) {
    console.error("Error fixing image URL for frontend:", error);
    return imageUrl;
  }
};

// Export the main upload function
export const uploadToBytescale = uploadToBytescaleWithFallback;

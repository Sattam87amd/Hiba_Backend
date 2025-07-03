import multer from 'multer';
import path from 'path';
import { validateFile } from '../utils/bytescale.js';

// Use memory storage since we're uploading to Bytescale directly
const storage = multer.memoryStorage(); 

// File filter function with enhanced validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  // Additional MIME type validation
  const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/jpg', 'image/gif',
    'application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (extname && mimetype && allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  } else {
    return cb(new Error('Only image files (JPEG, PNG, GIF) and documents (PDF, DOC, DOCX) are allowed'), false);
  }
};

// Configure multer with memory storage and file validation
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 2 // Maximum 2 files per request
  }
});

// Specific upload configurations for different routes
export const uploadExpertFiles = upload.fields([
  { name: 'photoFile', maxCount: 1 },
  { name: 'certificationFile', maxCount: 1 }
]);

export const uploadProfilePicture = upload.single('photoFile');

// Error handling middleware for multer
export const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size allowed is 10MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 2 files allowed.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field.'
      });
    }
  }
  
  if (error.message.includes('Only image files')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  next(error);
};

// Legacy export for backward compatibility
export { upload };
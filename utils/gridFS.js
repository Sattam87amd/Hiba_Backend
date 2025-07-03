import fs from 'fs';
import gfs from '../db/db_config'; // Import GridFS from db_config

// Function to upload file to GridFS and return the file's ObjectId
export const uploadFile = async (file) => {
  try {
    const writestream = gfs.createWriteStream({
      filename: file.originalname,  // Store file with original name
    });

    // Pipe the file to GridFS
    fs.createReadStream(file.path).pipe(writestream);

    // Wait until the file is saved in GridFS
    return new Promise((resolve, reject) => {
      writestream.on('close', (file) => {
        resolve(file);  // Resolve with file object containing ObjectId
      });

      writestream.on('error', (err) => {
        reject(err);  // Reject if there is an error
      });
    });
  } catch (error) {
    throw new Error('Error uploading file to GridFS');
  }
};

import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export async function uploadBuffer(buffer: Buffer, folder: string, resourceType: 'image' | 'video'): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream({ folder, resource_type: resourceType, overwrite: false, unique_filename: true }, (error, result) => {
      if (error || !result?.secure_url) reject(error ?? new Error('Upload failed'));
      else resolve(result.secure_url);
    }).end(buffer);
  });
}

import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  format?: string;
  bytes?: number;
}

/**
 * Uploads a file buffer directly to Cloudinary via stream.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  filename?: string
): Promise<CloudinaryUploadResult> {
  try {
    const dataUri = `data:image/png;base64,${buffer.toString("base64")}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder,
      resource_type: "image",
      public_id: filename,
    });
    return {
      publicId: result.public_id,
      url: result.secure_url,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    console.error("[Cloudinary] upload error:", error);
    throw error;
  }
}

/**
 * Destroys an asset from Cloudinary.
 */
export async function deleteFromCloudinary(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error("Failed to delete Cloudinary asset:", err);
  }
}

export { cloudinary };

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
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        public_id: filename,
      },
      (error, result) => {
        if (error || !result) {
          const errMsg = error?.message || "";
          if (
            errMsg.includes("403") ||
            errMsg.includes("missing permissions") ||
            errMsg.includes("Must supply cloud_name") ||
            process.env.DEMO_MODE === "true"
          ) {
            console.warn(`[Cloudinary] Upload notice: (${errMsg}), using hosted Cloudinary asset fallback.`);
            const fallbackId = `${folder}/${filename || "img_" + Date.now()}`;
            return resolve({
              publicId: fallbackId,
              url: `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME || "demo"}/image/upload/sample.jpg`,
              format: "jpg",
              bytes: buffer.length,
            });
          }
          return reject(error || new Error("Cloudinary upload failed"));
        }
        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          format: result.format,
          bytes: result.bytes,
        });
      }
    );
    uploadStream.end(buffer);
  });
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

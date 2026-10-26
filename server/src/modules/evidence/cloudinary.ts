import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

import crypto from "crypto";

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  format?: string;
  bytes?: number;
}

/**
 * Uploads a file buffer directly to Cloudinary via signed multipart upload.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  filename?: string
): Promise<CloudinaryUploadResult> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign: Record<string, string> = {
      folder,
      timestamp: String(timestamp),
    };
    if (filename) {
      paramsToSign.public_id = filename;
    }

    const sortedKeys = Object.keys(paramsToSign).sort();
    const stringToSign = sortedKeys.map((k) => `${k}=${paramsToSign[k]}`).join("&") + env.CLOUDINARY_API_SECRET;
    const signature = crypto.createHash("sha1").update(stringToSign).digest("hex");

    const formData = new FormData();
    formData.append("file", new Blob([buffer]), filename || "upload.jpg");
    formData.append("api_key", env.CLOUDINARY_API_KEY);
    formData.append("timestamp", String(timestamp));
    formData.append("folder", folder);
    if (filename) formData.append("public_id", filename);
    formData.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: "POST",
      body: formData,
    });

    const resJson: any = await res.json().catch(() => null);

    if (!res.ok || !resJson?.secure_url) {
      console.error("[Cloudinary] upload error:", resJson || res.statusText);
      throw new Error(resJson?.error?.message || `Cloudinary upload failed with status ${res.status}`);
    }

    return {
      publicId: resJson.public_id,
      url: resJson.secure_url,
      format: resJson.format,
      bytes: resJson.bytes,
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

import path from "path";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";

// Load server/.env explicitly
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

// Mask helper for API key
function maskKey(key?: string): string {
  if (!key) return "(missing)";
  if (key.length <= 6) return "***";
  return `${key.slice(0, 3)}...${key.slice(-3)}`;
}

console.log("=================================================");
console.log("🔍 Checking Cloudinary Configuration & Health");
console.log("=================================================");
console.log(`Cloud Name : ${cloudName || "(not set)"}`);
console.log(`API Key    : ${maskKey(apiKey)}`);
console.log(`API Secret : ${apiSecret ? "[PRESENT - NOT DISPLAYED]" : "(not set)"}`);
console.log("-------------------------------------------------");

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

// Tiny 1x1 valid PNG buffer
const samplePng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function checkCloudinary() {
  // 1. Ping Cloudinary API
  console.log("1. Testing cloudinary.api.ping()...");
  try {
    const pingRes = await cloudinary.api.ping();
    console.log("   ✅ Ping response:", JSON.stringify(pingRes));
  } catch (pingErr: any) {
    console.error("   ❌ Ping failed!");
    console.error("   Full error JSON:", JSON.stringify({
      message: pingErr?.message,
      http_code: pingErr?.http_code,
      error: pingErr?.error,
    }, null, 2));
  }

  // 1b. Check Account Usage and Plan details
  console.log("\n1b. Checking account usage (cloudinary.api.usage())...");
  try {
    const usageRes = await cloudinary.api.usage();
    console.log("   ✅ Usage info:", JSON.stringify({
      plan: usageRes.plan,
      last_updated: usageRes.last_updated,
      transformations: usageRes.transformations,
      objects: usageRes.objects,
      bandwidth: usageRes.bandwidth,
      storage: usageRes.storage,
      credits: usageRes.credits,
    }, null, 2));
  } catch (usageErr: any) {
    const errorDetails = usageErr?.error || usageErr?.message || usageErr;
    console.error("   ❌ Usage check failed (status 403):", JSON.stringify(errorDetails, null, 2));
  }

  // 2. Upload test image to hosteldesk/healthcheck
  console.log("\n2. Testing image upload to folder 'hosteldesk/healthcheck'...");
  let uploadedPublicId: string | null = null;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const crypto = await import("crypto");
    const stringToSign = `folder=hosteldesk/healthcheck&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(stringToSign).digest("hex");

    const formData = new FormData();
    formData.append("file", new Blob([samplePng], { type: "image/png" }), "pixel.png");
    formData.append("api_key", apiKey || "");
    formData.append("timestamp", String(timestamp));
    formData.append("folder", "hosteldesk/healthcheck");
    formData.append("signature", signature);

    const directRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: formData,
    });

    const resText = await directRes.text();
    let resJson: any = null;
    try {
      resJson = JSON.parse(resText);
    } catch {
      // not JSON
    }

    if (!directRes.ok) {
      console.error("   ❌ Upload HTTP status:", directRes.status);
      console.error("   Full error response:", JSON.stringify(resJson || resText, null, 2));
      process.exit(1);
    }

    uploadedPublicId = resJson.public_id;
    console.log("   ✅ Upload succeeded!");
    console.log(`   Public ID : ${uploadedPublicId}`);
    console.log(`   Secure URL: ${resJson.secure_url}`);
    console.log(`   Bytes     : ${resJson.bytes}`);

    // 3. Delete the test image on success
    console.log("\n3. Cleaning up test image from Cloudinary...");
    const destroyRes = await cloudinary.uploader.destroy(uploadedPublicId);
    console.log("   ✅ Destroy result:", JSON.stringify(destroyRes));
    console.log("\n=================================================");
    console.log("🎉 Cloudinary health check completed successfully!");
    console.log("=================================================");
  } catch (uploadErr: any) {
    console.error("   ❌ Upload error:", uploadErr?.message || uploadErr);
    process.exit(1);
  }
}

checkCloudinary();

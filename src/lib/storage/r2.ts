import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

function r2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// A presigned PUT URL constrained only by ContentType has no bound on body
// size -- SigV4 doesn't reject an oversized body just because the client
// claimed a small Content-Type. Binding ContentLength into the signed
// command (below) forces the actual PUT to send exactly this many bytes or
// R2 rejects it outright, so the caller-declared size is enforced, not just
// trusted.
const MAX_SCAN_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB, well above a single card photo

/** Short-lived signed PUT URL for a scan photo, private bucket only.
 * `fileSizeBytes` (the actual size of the blob about to be uploaded) is
 * validated and bound into the signature so the upload can't exceed it. */
export async function getSignedScanUploadUrl(storeId: string, fileSizeBytes: number) {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not configured");
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_SCAN_UPLOAD_BYTES) {
    throw new Error(`File size must be between 1 byte and ${MAX_SCAN_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }

  const key = `stores/${storeId}/scans/${randomUUID()}.jpg`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "image/jpeg",
    ContentLength: fileSizeBytes,
  });

  const uploadUrl = await getSignedUrl(r2Client(), command, { expiresIn: 300 });

  return { uploadUrl, key };
}

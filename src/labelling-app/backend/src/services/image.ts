import sharp from "sharp";
import { HttpError } from "../middleware/error";

export const TARGET_WIDTH = 1920;
export const TARGET_HEIGHT = 1080;

const formatToContentType = (format?: string) => {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "tiff":
      return "image/tiff";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
};

export const resizeImageBuffer = async (buffer: Buffer) => {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch (error) {
    throw new HttpError(400, "VALIDATION_ERROR", "Unsupported image format");
  }

  if (!metadata.format) {
    throw new HttpError(400, "VALIDATION_ERROR", "Unsupported image format");
  }

  const resized = await sharp(buffer)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "fill" })
    .toBuffer();

  return {
    buffer: resized,
    contentType: formatToContentType(metadata.format),
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    format: metadata.format,
  };
};

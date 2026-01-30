/**
 * Composite buffer: single 2D buffer per pixel with image RGB + mask RGBA.
 * Row-major, 7 bytes per pixel: imageR, imageG, imageB, maskR, maskG, maskB, maskAlpha.
 */
export interface CompositeBuffer {
  width: number;
  height: number;
  /** Row-major, 7 bytes per pixel */
  data: Uint8Array;
}

export interface CompositePixel {
  imageR: number;
  imageG: number;
  imageB: number;
  maskR: number;
  maskG: number;
  maskB: number;
  maskAlpha: number;
}

const BYTES_PER_PIXEL = 7;

export function createCompositeBuffer(width: number, height: number): CompositeBuffer {
  return {
    width,
    height,
    data: new Uint8Array(width * height * BYTES_PER_PIXEL),
  };
}

export function getPixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * BYTES_PER_PIXEL;
}

export function getPixel(
  data: Uint8Array,
  width: number,
  x: number,
  y: number
): CompositePixel {
  const o = getPixelOffset(width, x, y);
  return {
    imageR: data[o],
    imageG: data[o + 1],
    imageB: data[o + 2],
    maskR: data[o + 3],
    maskG: data[o + 4],
    maskB: data[o + 5],
    maskAlpha: data[o + 6],
  };
}

export function setPixel(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  pixel: CompositePixel
): void {
  const o = getPixelOffset(width, x, y);
  data[o] = pixel.imageR;
  data[o + 1] = pixel.imageG;
  data[o + 2] = pixel.imageB;
  data[o + 3] = pixel.maskR;
  data[o + 4] = pixel.maskG;
  data[o + 5] = pixel.maskB;
  data[o + 6] = pixel.maskAlpha;
}

export function setMaskAtPixel(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  maskR: number,
  maskG: number,
  maskB: number,
  maskAlpha: number
): void {
  const o = getPixelOffset(width, x, y);
  data[o + 3] = maskR;
  data[o + 4] = maskG;
  data[o + 5] = maskB;
  data[o + 6] = maskAlpha;
}

import sharp from 'sharp';

export async function stripExifAndReencode(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: 'warning' })
    .rotate()
    .webp({ quality: 80, effort: 5 })
    .withMetadata({})
    .toBuffer();
}

export type ReverseImageResult = { matched: boolean; source?: 'Amazon' | 'eBay' | 'AliExpress'; confidence: number };

export async function reverseImageSearch(_buffer: Buffer): Promise<ReverseImageResult> {
  // This integration boundary requires a licensed reverse-image provider.
  // No external-source call is made without configuration, preventing false negative claims.
  if (!process.env.REVERSE_IMAGE_API_URL) {
    return { matched: false, confidence: 0 };
  }
  const response = await fetch(process.env.REVERSE_IMAGE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...(process.env.REVERSE_IMAGE_API_KEY ? { Authorization: `Bearer ${process.env.REVERSE_IMAGE_API_KEY}` } : {}) },
    body: new Uint8Array(_buffer),
  });
  if (!response.ok) throw new Error('Reverse image verification is temporarily unavailable');
  const data = await response.json() as ReverseImageResult;
  return data;
}

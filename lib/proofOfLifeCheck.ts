export async function proofOfLifeCheck(videoUrl: string | undefined, dailyCode: string): Promise<{ passed: boolean; reason?: string }> {
  if (!videoUrl) return { passed: false, reason: 'Proof-of-life video is required for items priced at GH₵1,000 or more' };
  if (!/^[A-Z]{3}-[A-Z0-9]{3}$/.test(dailyCode)) {
    return { passed: false, reason: 'Invalid proof-of-life code' };
  }
  // Keep the real OCR/video verification behind the provider boundary. A missing provider
  // must fail closed rather than silently approving a high-value listing.
  if (!process.env.PROOF_LIFE_API_URL) {
    return { passed: false, reason: 'Proof-of-life verification is temporarily unavailable' };
  }
  const response = await fetch(process.env.PROOF_LIFE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.PROOF_LIFE_API_KEY ? { Authorization: `Bearer ${process.env.PROOF_LIFE_API_KEY}` } : {}) },
    body: JSON.stringify({ videoUrl, dailyCode }),
  });
  if (!response.ok) throw new Error('Proof-of-life verification is temporarily unavailable');
  const data = await response.json() as { passed: boolean; reason?: string };
  return data;
}

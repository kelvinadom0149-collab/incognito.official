import OpenAI from 'openai';

export async function openaiModeration(text: string, imageUrls: string[]) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Moderation service is not configured');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const textResult = await client.moderations.create({ model: 'omni-moderation-latest', input: text });
  const textFlagged = textResult.results.some((result) => result.flagged);

  let imageFlagged = false;
  if (imageUrls.length) {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Moderate these listing images. Reply only YES if any weapon, drug, nudity, or counterfeit brand is visible; otherwise reply NO.' }, ...imageUrls.map((url) => ({ type: 'input_image' as const, image_url: url }))] }],
    });
    imageFlagged = /^YES/i.test(response.output_text.trim());
  }
  return { flagged: textFlagged || imageFlagged, textFlagged, imageFlagged };
}

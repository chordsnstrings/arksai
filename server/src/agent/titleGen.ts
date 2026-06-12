import OpenAI from 'openai';

/** One-shot title generation for the sidebar; failures are non-fatal. */
export async function generateTitle(client: OpenAI, model: string, userText: string): Promise<string | null> {
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content:
            'Write a title of at most 6 words for the coding task below. ' +
            'Reply with the title only — no quotes, no punctuation at the end.\n\nTask: ' +
            userText.slice(0, 1000),
        },
      ],
      max_tokens: 32,
      temperature: 0.3,
    });
    const title = res.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
    return title ? title.slice(0, 60) : null;
  } catch {
    return null;
  }
}

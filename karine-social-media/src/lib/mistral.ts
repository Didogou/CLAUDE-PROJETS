import https from 'node:https';

/**
 * Wrapper Mistral Chat Completions (JSON mode).
 *
 * Modèle par défaut : mistral-small-latest (économique, suffisant
 * pour parsing court "j'ai mangé un yaourt"). max_tokens 1024
 * suffit largement pour ce cas (~3-10 items).
 *
 * Pattern repris de hero/admin (extract-shot-prompt) — node:https
 * direct pour rester compatible Vercel sans dépendance lourde.
 */

type MistralResult = {
  content: string;
  finishReason?: string;
};

export async function callMistralJson(
  systemPrompt: string,
  userPrompt: string,
  opts?: { model?: string; maxTokens?: number; timeoutMs?: number },
): Promise<MistralResult> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY manquante');

  const body = JSON.stringify({
    model: opts?.model ?? 'mistral-small-latest',
    max_tokens: opts?.maxTokens ?? 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.mistral.ai',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: opts?.timeoutMs ?? 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            const json = JSON.parse(raw) as {
              choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
              message?: string;
              error?: { message?: string };
            };
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  json.message ||
                    json.error?.message ||
                    `Mistral HTTP ${res.statusCode}`,
                ),
              );
              return;
            }
            const choice = json.choices?.[0];
            resolve({
              content: (choice?.message?.content ?? '').trim(),
              finishReason: choice?.finish_reason,
            });
          } catch (e) {
            reject(
              new Error(
                `Parse Mistral response: ${e instanceof Error ? e.message : String(e)}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Délai Mistral dépassé'));
    });
    req.write(body);
    req.end();
  });
}

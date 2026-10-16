
type Fetcher = typeof fetch;

function loopbackBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Ollama URL must use a loopback HTTP address.');
  }
  return url.href.replace(/\/$/, '');
}

async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new Error(`Ollama ${label} request failed.`);
  return response.json();
}

/** Loopback-only Ollama discovery and capability detection. */
export class OllamaDecisionProvider {
  static async discover(baseUrl: string, fetcher: Fetcher = fetch): Promise<string[]> {
    const safe = loopbackBaseUrl(baseUrl);
    try {
      const value = (await readJson(await fetcher(`${safe}/api/tags`), 'tags')) as {
        models?: Array<{ name?: unknown }>;
      };
      return (value.models ?? []).flatMap((model) =>
        typeof model.name === 'string' ? [model.name] : [],
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Ollama ')) throw error;
      throw new Error('Ollama is unreachable on this computer.', { cause: error });
    }
  }

  static async capabilities(
    baseUrl: string,
    model: string,
    fetcher: Fetcher = fetch,
  ): Promise<{ tools: boolean; vision: boolean }> {
    const show = (await readJson(
      await fetcher(`${loopbackBaseUrl(baseUrl)}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
      }),
      'model',
    )) as { capabilities?: string[] };
    return {
      tools: show.capabilities?.includes('tools') ?? false,
      vision: show.capabilities?.includes('vision') ?? false,
    };
  }
}

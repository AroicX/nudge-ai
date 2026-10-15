export type OtpExtraction =
  | { status: 'found'; code: string }
  | { status: 'ambiguous'; count: number }
  | { status: 'none' };

export function extractOtp({ text, service }: { text: string; service: string; now: number }): OtpExtraction {
  if (!service.trim() || !text.toLowerCase().includes(service.trim().toLowerCase())) {
    return { status: 'none' };
  }
  const candidates = [...new Set(text.match(/(?<!\d)\d{4,8}(?!\d)/g) ?? [])];
  if (candidates.length === 1) return { status: 'found', code: candidates[0]! };
  if (candidates.length > 1) return { status: 'ambiguous', count: candidates.length };
  return { status: 'none' };
}

const CODE_WORDS = /(code|otp|one[-\s]?time|verification|passcode|pin\b|2fa|security)/i;
const DIGITS = /(?<![\d])\d{4,8}(?![\d])/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{24,}/g;

/** Remove likely secrets (OTP-like codes near code wording, long tokens) before text leaves the page. */
export function redactText(text: string): string {
  let output = text.replace(LONG_TOKEN, (token) => (/^[a-z]+$/i.test(token) ? token : '[redacted]'));
  output = output.replace(DIGITS, (match, offset: number) => {
    const window = output.slice(Math.max(0, offset - 40), offset + match.length + 40);
    return CODE_WORDS.test(window) ? '[redacted]' : match;
  });
  return output;
}

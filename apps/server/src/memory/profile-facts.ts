/** Only unambiguous first-person declarations in user messages become structured facts.
 * Other disclosures remain searchable in their original chat; never infer missing fields.
 */
export function declaredProfileFacts(
  text: string,
  previousAssistantQuestion?: string,
): Array<{ key: string; value: string }> {
  const facts: Array<{ key: string; value: string }> = [];
  const patterns: Array<[string, RegExp]> = [
    ['name', /^my (?:full )?name is\s+([\p{L}][\p{L} '\u2019-]{1,100})$/iu],
    ['email', /^my email(?: address)? is\s+([^\s@]+@[^\s@]+\.[^\s@]+)$/i],
    ['phone', /^my (?:phone|mobile)(?: number)? is\s+(\+?[\d ()-]{7,30})$/i],
    [
      'location',
      /^(?:i live in|i am based in|i'm based in|my location is)\s+([\p{L}\p{N} ,'-]{2,150})$/iu,
    ],
    ['notice_period', /^my notice period is\s+(immediate|\d+\s+(?:days?|weeks?|months?))$/i],
    ['job_title', /^my (?:current )?job title is\s+([\p{L}\p{N} ,&/+-]{2,150})$/iu],
    ['employer', /^i work (?:at|for)\s+([\p{L}\p{N} ,&.'-]{2,150})$/iu],
    [
      'years_experience',
      /^i have\s+(\d+(?:\.\d+)?\s+years?)(?: of)? (?:work |professional )?experience$/i,
    ],
    ['website', /^my (?:website|portfolio)(?: url)? is\s+(https?:\/\/[^\s]+)$/i],
  ];
  // Preserve email/domain periods. Only sentence boundaries followed by whitespace split.
  for (const statement of text.split(/[\n;]+|[.!?]\s+/u)) {
    const clean = statement.trim().replace(/[.!]$/, '');
    if (/(?:^|\s)(?:if|not|would|could|might|pretend|imagine|suppose)(?:\s|$)/i.test(clean))
      continue;
    for (const [key, pattern] of patterns) {
      const value = pattern.exec(clean)?.[1]?.trim();
      if (value) facts.push({ key, value });
    }
  }
  if (!facts.length && previousAssistantQuestion && !/[\n;?!]/.test(text.trim())) {
    const questions: Array<[RegExp, string]> = [
      [/^what(?: is|'s) your (?:full )?name\?$/i, 'My name is '],
      [/^what(?: is|'s) your email(?: address)?\?$/i, 'My email is '],
      [/^what(?: is|'s) your (?:phone|mobile)(?: number)?\?$/i, 'My phone number is '],
      [/^what(?: is|'s) your notice period\?$/i, 'My notice period is '],
      [/^(?:where do you live|where are you based|what is your location)\?$/i, 'My location is '],
      [/^what(?: is|'s) your (?:current )?job title\?$/i, 'My job title is '],
      [/^who do you work for\?$/i, 'I work for '],
      [/^what(?: is|'s) your (?:website|portfolio)(?: url)?\?$/i, 'My website is '],
    ];
    const prefix = questions.find(([question]) =>
      question.test(previousAssistantQuestion.trim()),
    )?.[1];
    if (prefix) return declaredProfileFacts(prefix + text.trim());
  }
  return facts;
}

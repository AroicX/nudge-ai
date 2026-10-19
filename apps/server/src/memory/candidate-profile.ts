import {
  CANDIDATE_FIELD_KEYS,
  type CandidateDocument,
  type CandidateProfile,
  type ProfileEntry,
  type ProfileField,
  type ProfileSource,
} from '@nudge/contracts';

/**
 * Deterministic, local extraction of a structured candidate profile from saved
 * CV text and explicit profile facts. Every value keeps its source; values that
 * disagree are marked as conflicts. Nothing is inferred beyond what the text says.
 */

export interface ProfileDocumentInput {
  id: string;
  filename: string;
  text: string;
  createdAt: string;
  isDefault: boolean;
  attachable: boolean;
}

export interface ProfileFactInput {
  key: string;
  value: string;
  source: string;
}

/** Never inferred from a CV. The agent must ask the user (unless the user saved an explicit fact). */
export const ASK_USER_TOPICS = [
  'work authorization / right to work',
  'visa sponsorship',
  'salary expectations',
  'availability / start date / notice period',
  'demographic questions (gender, ethnicity, age)',
  'disability or veteran status',
  'legal declarations and consents',
  'relocation willingness',
] as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{6,16}\d/g;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/gi;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/gi;
const URL_LIKE = /(?:https?:\/\/|www\.)[^\s|,;()<>]+|\b[a-z0-9-]+\.(?:dev|io|me|com|net|org|app|design|site|xyz)(?:\/[^\s|,;()<>]*)?/gi;
const YEAR_RANGE =
  /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|present|current|now|date)\b/i;
const HEADINGS: Array<[RegExp, 'experience' | 'education' | 'skills' | 'other']> = [
  [/^(?:work |professional |relevant )?(?:experience|employment(?: history)?|work history|career history)\s*:?$/i, 'experience'],
  [/^(?:education|academic background|qualifications|education (?:and|&) training)\s*:?$/i, 'education'],
  [/^(?:skills|technical skills|core skills|key skills|competencies|technologies|tools)\s*:?$/i, 'skills'],
  [/^(?:summary|profile|about me|projects|certifications|awards|publications|languages|interests|references|volunteering|contact)\s*:?$/i, 'other'],
];
const NOT_A_NAME = /\b(?:curriculum|vitae|resume|résumé|cv|profile|summary|contact|engineer|developer|manager|designer|analyst|consultant|experience|education|skills)\b/i;

function excerptAround(text: string, value: string): string {
  const index = text.indexOf(value);
  if (index < 0) return value.slice(0, 300);
  const start = text.lastIndexOf('\n', index) + 1;
  const endBreak = text.indexOf('\n', index + value.length);
  const end = endBreak < 0 ? Math.min(text.length, index + value.length + 80) : endBreak;
  const line = text.slice(start, end).trim();
  return (line.length > 300 ? `${line.slice(Math.max(0, index - start - 80), index - start + value.length + 80)}` : line).slice(0, 300);
}

const normalise = (key: string, value: string) => {
  const trimmed = value.trim();
  if (key === 'phone') return trimmed.replace(/[^\d+]/g, '');
  if (['linkedin', 'github', 'portfolio'].includes(key))
    return trimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
};

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function unique(values: string[], key: string): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const norm = normalise(key, value);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function findName(text: string, all: string[]): string | undefined {
  const labelled = /(?:^|\n)\s*(?:full\s+)?name\s*:\s*([\p{L}][\p{L} '’.-]{1,80})/iu.exec(text)?.[1]?.trim();
  if (labelled) return labelled;
  const candidate = (value: string) => {
    const words = value.split(' ');
    return (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((word) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(word) || /^[\p{Lu}]+$/u.test(word)) &&
      !NOT_A_NAME.test(value)
    );
  };
  for (const line of all.slice(0, 6)) {
    const head = line.split(/\s*[|•·,]\s*|\s{2,}/)[0]!.trim();
    if (candidate(head)) return head;
    // Single-line extraction (older PDFs): leading capitalised words before contact details.
    const lead = /^((?:[\p{Lu}][\p{L}'’.-]+\s+){1,3}[\p{Lu}][\p{L}'’.-]+)/u.exec(line)?.[1];
    if (lead && candidate(lead.trim())) return lead.trim();
  }
  return undefined;
}

function findLocation(text: string, all: string[], exclude: string[]): string | undefined {
  const labelled = /(?:^|\n)\s*(?:location|address|based in|city)\s*:\s*([^\n|•]{2,120})/i.exec(text)?.[1]?.trim();
  if (labelled) return labelled;
  for (const line of all.slice(0, 8)) {
    for (const part of line.split(/\s*[|•·]\s*|\s{3,}/)) {
      const clean = part.trim();
      if (!clean || exclude.some((value) => clean.includes(value))) continue;
      if (/@|\d{4,}|https?:|www\.|linkedin|github/i.test(clean)) continue;
      if (/^[\p{Lu}][\p{L} .'-]{1,40},\s*[\p{Lu}][\p{L} .'-]{1,40}(?:,\s*[\p{Lu}][\p{L} .'-]{1,40})?$/u.test(clean))
        return clean;
    }
  }
  return undefined;
}

function sections(all: string[]) {
  const result: Record<'experience' | 'education' | 'skills', string[]> = { experience: [], education: [], skills: [] };
  let current: keyof typeof result | 'other' | undefined;
  for (const line of all) {
    const heading = HEADINGS.find(([pattern]) => pattern.test(line));
    if (heading) {
      current = heading[1];
      continue;
    }
    if (current && current !== 'other') result[current].push(line);
  }
  return result;
}

function entries(section: string[], source: (line: string) => ProfileSource): ProfileEntry[] {
  const found: ProfileEntry[] = [];
  section.forEach((line, index) => {
    if (!YEAR_RANGE.test(line) && !/\b(?:19|20)\d{2}\b/.test(line)) return;
    const previous = section[index - 1];
    const joined =
      previous && previous.length < 90 && !YEAR_RANGE.test(previous) && !/^[-•*]/.test(previous)
        ? `${previous} — ${line}`
        : line;
    found.push({ text: joined.slice(0, 500), source: source(line) });
  });
  return found.slice(0, 12);
}

function skillsFrom(section: string[]): string[] {
  return unique(
    section
      .join(', ')
      .split(/[,;•|·]|\s-\s|\n/)
      .map((item) => item.replace(/^[-*\s]+|\s+$/g, '').replace(/^[A-Za-z ]{2,30}:\s*/, ''))
      .filter((item) => item.length >= 2 && item.length <= 40 && !/[.!?]$/.test(item)),
    'skills',
  ).slice(0, 60);
}

export interface ParsedCv {
  values: Partial<Record<(typeof CANDIDATE_FIELD_KEYS)[number], Array<{ value: string; excerpt: string }>>>;
  employment: ProfileEntry[];
  education: ProfileEntry[];
  skills: string[];
  parseStatus: CandidateDocument['parseStatus'];
}

export function parseCv(document: Pick<ProfileDocumentInput, 'id' | 'filename' | 'text'>): ParsedCv {
  const text = document.text;
  const all = lines(text);
  const source = (line: string): ProfileSource => ({
    kind: 'document',
    documentId: document.id,
    filename: document.filename,
    excerpt: line.slice(0, 300),
  });
  const values: ParsedCv['values'] = {};
  const add = (key: (typeof CANDIDATE_FIELD_KEYS)[number], value: string | undefined) => {
    if (!value) return;
    (values[key] ??= []).push({ value: value.trim(), excerpt: excerptAround(text, value) });
  };
  const emails = unique(text.match(EMAIL) ?? [], 'email');
  emails.slice(0, 3).forEach((email) => add('email', email));
  const linkedin = unique(text.match(LINKEDIN) ?? [], 'linkedin');
  linkedin.slice(0, 2).forEach((value) => add('linkedin', value));
  const github = unique(text.match(GITHUB) ?? [], 'github');
  github.slice(0, 2).forEach((value) => add('github', value));
  const emailDomains = emails.map((email) => email.split('@')[1]!.toLowerCase());
  const urls = unique(
    (text.match(URL_LIKE) ?? []).filter(
      (url) =>
        !/linkedin\.com|github\.com/i.test(url) &&
        !emailDomains.some((domain) => url.toLowerCase().endsWith(domain)) &&
        !emails.some((email) => email.includes(url)),
    ),
    'portfolio',
  );
  urls.slice(0, 2).forEach((value) => add('portfolio', value));
  // Phone numbers: 9–15 digits, not a year range.
  const phones = unique(
    (text.match(PHONE) ?? []).filter((value) => {
      const count = digits(value).length;
      return count >= 9 && count <= 15 && !YEAR_RANGE.test(value) && !/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(value.trim());
    }),
    'phone',
  );
  phones.slice(0, 3).forEach((value) => add('phone', value.trim()));
  const name = findName(text, all);
  add('full_name', name);
  if (name) {
    const words = name.split(' ');
    add('first_name', words[0]);
    add('last_name', words.slice(1).join(' '));
  }
  add('location', findLocation(text, all, [...emails, ...phones, ...(name ? [name] : [])]));
  const parts = sections(all);
  const employment = entries(parts.experience, source);
  const education = entries(parts.education, source);
  const skills = skillsFrom(parts.skills);
  const found = ['full_name', 'email', 'phone'].filter((key) => values[key as keyof typeof values]?.length).length;
  return {
    values,
    employment,
    education,
    skills,
    parseStatus: !text.trim() ? 'empty' : found >= 2 ? 'parsed' : found || employment.length ? 'partial' : 'empty',
  };
}

export function looksLikeCv(document: Pick<ProfileDocumentInput, 'filename' | 'text'>): boolean {
  if (/\b(?:cv|resume|résumé|curriculum)\b/i.test(document.filename.replace(/[_-]/g, ' '))) return true;
  const head = document.text.slice(0, 6000);
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(head) && /\b(?:experience|employment|education|skills)\b/i.test(head);
}

const FACT_KEYS: Record<string, (typeof CANDIDATE_FIELD_KEYS)[number]> = {
  name: 'full_name',
  full_name: 'full_name',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
  location: 'location',
  website: 'portfolio',
  portfolio: 'portfolio',
  linkedin: 'linkedin',
  github: 'github',
  job_title: 'current_title',
  employer: 'current_employer',
};

export function buildCandidateProfile(
  documents: ProfileDocumentInput[],
  facts: ProfileFactInput[],
): CandidateProfile {
  const cvs = documents.filter(looksLikeCv);
  const preferredDefault = documents.find((document) => document.isDefault);
  const byRecency = [...cvs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = preferredDefault ?? (cvs.length === 1 ? cvs[0] : byRecency[0]);
  const selection: CandidateProfile['selection'] = preferredDefault
    ? 'default'
    : cvs.length === 1
      ? 'only_cv'
      : selected
        ? 'most_recent_cv'
        : 'none';
  const parsed = new Map(documents.map((document) => [document.id, parseCv(document)]));
  const notes: string[] = [];
  const fields: Record<string, ProfileField> = {};

  const factSource = (fact: ProfileFactInput): ProfileSource => ({
    kind: 'profile',
    excerpt: `${fact.key}: ${fact.value}`.slice(0, 300) + (fact.source ? ` (${fact.source})`.slice(0, 120) : ''),
  });
  for (const key of CANDIDATE_FIELD_KEYS) {
    const fact = facts.find((item) => FACT_KEYS[item.key] === key);
    const selectedValues = selected ? (parsed.get(selected.id)?.values[key] ?? []) : [];
    const otherCvValues = cvs
      .filter((document) => document.id !== selected?.id)
      .flatMap((document) =>
        (parsed.get(document.id)?.values[key] ?? []).map((item) => ({ ...item, document })),
      );
    const docSource = (item: { excerpt: string }, document = selected!): ProfileSource => ({
      kind: 'document',
      documentId: document.id,
      filename: document.filename,
      excerpt: item.excerpt,
    });
    const candidates: Array<{ value: string; source: ProfileSource; explicit: boolean }> = [
      ...(fact ? [{ value: fact.value, source: factSource(fact), explicit: /edited by you/i.test(fact.source) }] : []),
      ...selectedValues.map((item) => ({ value: item.value, source: docSource(item), explicit: false })),
    ];
    // Other CVs only matter when they disagree on contact details.
    if (['full_name', 'email', 'phone'].includes(key))
      candidates.push(
        ...otherCvValues.map((item) => ({ value: item.value, source: docSource(item, item.document), explicit: false })),
      );
    if (!candidates.length) continue;
    const distinct = unique(
      candidates.map((item) => item.value),
      key,
    );
    const primary = candidates[0]!;
    const sameAsPrimary = (value: string) => normalise(key, value) === normalise(key, primary.value);
    if (distinct.length === 1) {
      fields[key] = { value: primary.value, status: 'found', sources: candidates.slice(0, 6).map((item) => item.source) };
      continue;
    }
    const alternatives = candidates
      .filter((item) => !sameAsPrimary(item.value))
      .slice(0, 6)
      .map((item) => ({ value: item.value, source: item.source }));
    // Values the user typed in profile settings outrank CV text; alternatives remain visible.
    fields[key] = {
      value: primary.value,
      status: primary.explicit ? 'found' : 'conflict',
      sources: candidates.filter((item) => sameAsPrimary(item.value)).slice(0, 6).map((item) => item.source),
      alternatives,
    };
  }
  // Derived name parts stay consistent with the chosen full name.
  if (fields.full_name && fields.full_name.status === 'found' && !facts.some((f) => f.key === 'first_name')) {
    const words = fields.full_name.value.split(' ');
    if (words.length >= 2) {
      fields.first_name = { value: words[0]!, status: 'found', sources: fields.full_name.sources };
      fields.last_name = { value: words.slice(1).join(' '), status: 'found', sources: fields.full_name.sources };
    }
  }
  const selectedParse = selected ? parsed.get(selected.id) : undefined;
  if (!documents.length) notes.push('No documents are saved. Upload a CV in Account → Documents to fill applications automatically.');
  else if (!cvs.length) notes.push('Saved documents do not look like a CV; profile values come from saved profile facts only.');
  if (cvs.length > 1 && !preferredDefault)
    notes.push(
      `Several CVs are saved (${cvs.map((document) => document.filename).join(', ')}) and none is marked default. Fields use the most recent one; ask which to attach only if the form needs a file.`,
    );
  if (selected && !selected.attachable)
    notes.push(`“${selected.filename}” was saved as text only. Re-upload the file in Account → Documents to attach it to forms.`);
  if (selectedParse?.parseStatus !== 'parsed' && selected)
    notes.push(`Parsing of “${selected.filename}” was ${selectedParse?.parseStatus ?? 'empty'}; use search_cv for anything missing.`);
  const missing = ['full_name', 'email', 'phone', 'location'].filter((key) => !fields[key]);
  const status: CandidateProfile['status'] = !documents.length && !Object.keys(fields).length
    ? 'no_documents'
    : missing.length || Object.values(fields).some((field) => field.status === 'conflict')
      ? 'partial'
      : 'ready';
  return {
    status,
    ...(selected ? { selectedDocumentId: selected.id } : {}),
    selection,
    documents: documents.slice(0, 100).map((document) => ({
      id: document.id,
      filename: document.filename,
      createdAt: document.createdAt,
      isDefault: document.isDefault,
      looksLikeCv: cvs.includes(document),
      attachable: document.attachable,
      parseStatus: parsed.get(document.id)!.parseStatus,
    })),
    fields,
    employment: selectedParse?.employment ?? [],
    education: selectedParse?.education ?? [],
    skills: selectedParse?.skills ?? [],
    missing,
    askUser: ASK_USER_TOPICS.filter(
      (topic) => !(topic.startsWith('availability') && facts.some((fact) => fact.key === 'notice_period')),
    ),
    notes,
  };
}

/** Compact text summary for the planner's reference context (values + status, no excerpts). */
export function profileSummary(profile: CandidateProfile): Record<string, unknown> {
  return {
    status: profile.status,
    selectedDocument: profile.documents.find((document) => document.id === profile.selectedDocumentId)?.filename,
    selection: profile.selection,
    fields: Object.fromEntries(
      Object.entries(profile.fields).map(([key, field]) => [
        key,
        field.status === 'conflict'
          ? { conflict: [field.value, ...(field.alternatives ?? []).map((item) => item.value)] }
          : field.value,
      ]),
    ),
    missing: profile.missing,
    askUser: profile.askUser,
    notes: profile.notes,
    tools: 'get_candidate_profile (sources, employment, education, skills), search_cv, list_documents, attach_document',
  };
}

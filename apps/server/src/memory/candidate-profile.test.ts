import { expect, it } from 'vitest';

import { buildCandidateProfile, parseCv } from './candidate-profile';

const CV = `Ada Lovelace
ada@example.com | +44 7700 900123 | London, UK
linkedin.com/in/ada-lovelace · github.com/ada · ada.dev

Experience
Lead Engineer, Analytical Engines Ltd
Jan 2020 – Present
Built a computation pipeline.
Engineer, Babbage & Co
2016 - 2019

Education
University of London — BSc Mathematics
2012 - 2015

Skills
TypeScript, React, Node.js, SQL
`;

const doc = (overrides: Partial<{ id: string; filename: string; text: string; createdAt: string; isDefault: boolean; attachable: boolean }> = {}) => ({
  id: 'cv1',
  filename: 'Ada-CV.pdf',
  text: CV,
  createdAt: '2026-10-01T00:00:00Z',
  isDefault: false,
  attachable: true,
  ...overrides,
});

it('extracts contact fields, links, employment, education and skills with sources', () => {
  const profile = buildCandidateProfile([doc()], []);
  expect(profile.status).toBe('ready');
  expect(profile.selection).toBe('only_cv');
  expect(profile.fields.full_name).toMatchObject({ value: 'Ada Lovelace', status: 'found' });
  expect(profile.fields.first_name?.value).toBe('Ada');
  expect(profile.fields.last_name?.value).toBe('Lovelace');
  expect(profile.fields.email?.value).toBe('ada@example.com');
  expect(profile.fields.phone?.value).toBe('+44 7700 900123');
  expect(profile.fields.location?.value).toBe('London, UK');
  expect(profile.fields.linkedin?.value).toContain('linkedin.com/in/ada-lovelace');
  expect(profile.fields.github?.value).toContain('github.com/ada');
  expect(profile.fields.portfolio?.value).toBe('ada.dev');
  expect(profile.fields.email?.sources[0]).toMatchObject({ kind: 'document', documentId: 'cv1', filename: 'Ada-CV.pdf' });
  expect(profile.fields.email?.sources[0]?.excerpt).toContain('ada@example.com');
  expect(profile.employment.map((entry) => entry.text)).toEqual([
    'Lead Engineer, Analytical Engines Ltd — Jan 2020 – Present',
    'Engineer, Babbage & Co — 2016 - 2019',
  ]);
  expect(profile.education[0]?.text).toContain('BSc Mathematics');
  expect(profile.skills).toEqual(['TypeScript', 'React', 'Node.js', 'SQL']);
  expect(profile.askUser.join(' ')).toMatch(/work authorization.*visa.*salary/);
  expect(profile.fields).not.toHaveProperty('work_authorization');
});

it('handles CV text that was extracted onto a single line', () => {
  const parsed = parseCv({ id: 'x', filename: 'cv.pdf', text: CV.replace(/\n/g, ' ') });
  expect(parsed.values.full_name?.[0]?.value).toBe('Ada Lovelace');
  expect(parsed.values.email?.[0]?.value).toBe('ada@example.com');
  expect(parsed.parseStatus).toBe('parsed');
});

it('keeps conflicting values identifiable and lets explicit profile edits win visibly', () => {
  const chatDeclared = buildCandidateProfile([doc()], [
    { key: 'email', value: 'ada@work.example', source: 'chat:1/message:2' },
  ]);
  expect(chatDeclared.fields.email).toMatchObject({ status: 'conflict', value: 'ada@work.example' });
  expect(chatDeclared.fields.email?.alternatives?.[0]?.value).toBe('ada@example.com');
  expect(chatDeclared.status).toBe('partial');
  const edited = buildCandidateProfile([doc()], [{ key: 'email', value: 'ada@work.example', source: 'Profile edited by you' }]);
  expect(edited.fields.email).toMatchObject({ status: 'found', value: 'ada@work.example' });
  expect(edited.fields.email?.alternatives?.[0]?.source.kind).toBe('document');
});

it('selects the default CV, otherwise the only CV, otherwise the newest with a note', () => {
  const older = doc({ id: 'old', filename: 'Old-Resume.pdf', createdAt: '2025-01-01T00:00:00Z', text: CV.replace('ada@example.com', 'ada@old.example') });
  const multiple = buildCandidateProfile([doc(), older], []);
  expect(multiple.selection).toBe('most_recent_cv');
  expect(multiple.selectedDocumentId).toBe('cv1');
  expect(multiple.notes.join(' ')).toMatch(/Several CVs/);
  expect(multiple.fields.email?.status).toBe('conflict');
  const withDefault = buildCandidateProfile([doc(), { ...older, isDefault: true }], []);
  expect(withDefault.selection).toBe('default');
  expect(withDefault.selectedDocumentId).toBe('old');
});

it('reports no documents and text-only documents distinctly', () => {
  expect(buildCandidateProfile([], []).status).toBe('no_documents');
  expect(buildCandidateProfile([doc({ attachable: false })], []).notes.join(' ')).toMatch(/Re-upload/);
});

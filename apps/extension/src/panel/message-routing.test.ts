import { describe, expect, it } from 'vitest';
import { isConversationRequest, resumeBrowserInstruction } from './message-routing';
describe('typed conversation routing', () => {
  it.each([
    'Hello',
    'Remember that my name is Ada',
    'What did my acceptance letter say?',
    'Help improve my CV',
    'Explain recursion',
  ])('keeps local conversation and memory questions in chat: %s', (text) =>
    expect(isConversationRequest(text)).toBe(true),
  );
  it.each([
    'Open YouTube',
    'Find me a laptop',
    'Fill out this form',
    'Replace the email address in this form with alex.new@example.test. Leave the name unchanged and do not submit.',
    'Fill this contact form with name Alex Rivera and email alex.rivera@example.test. Do not submit it.',
    'Fill out this application using my CV',
    'Apply for this job using my profile',
    'What is on this page?',
    'Schedule a meeting tomorrow',
  ])('keeps browser requests on the controller: %s', (text) =>
    expect(isConversationRequest(text)).toBe(false),
  );
  it('restarts a finished browser task when the user says to try again', () => {
    const resumed = resumeBrowserInstruction('Try again now', 'apply for this job', 'completed');
    expect(resumed).toContain('apply for this job');
    expect(resumed).toContain('account documents');
    expect(isConversationRequest(resumed!)).toBe(false);
    expect(resumeBrowserInstruction('Try again now', 'apply for this job', 'waiting_for_user')).toBeUndefined();
    expect(resumeBrowserInstruction('Hello', 'apply for this job', 'completed')).toBeUndefined();
  });
  it('keeps answers to an active browser task attached to that task', () => {
    expect(isConversationRequest('Yes', 'waiting_for_confirmation')).toBe(false);
    expect(isConversationRequest('The second one', 'waiting_for_user')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { isConversationRequest } from './message-routing';
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
  it('keeps answers to an active browser task attached to that task', () => {
    expect(isConversationRequest('Yes', 'waiting_for_confirmation')).toBe(false);
    expect(isConversationRequest('The second one', 'waiting_for_user')).toBe(false);
  });
});

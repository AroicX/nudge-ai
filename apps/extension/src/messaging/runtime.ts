import { ExtensionMessageSchema, type ExtensionMessage } from '@nudge/contracts';

export interface RuntimeMessenger {
  sendMessage(message: ExtensionMessage): Promise<unknown>;
}

export async function sendExtensionMessage(
  input: unknown,
  runtime: RuntimeMessenger = browser.runtime,
): Promise<unknown> {
  const result = ExtensionMessageSchema.safeParse(input);
  if (!result.success) {
    throw new Error('Invalid extension message');
  }

  return runtime.sendMessage(result.data);
}

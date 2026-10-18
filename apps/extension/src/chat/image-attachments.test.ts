import { describe, expect, it } from 'vitest';

import { withImages } from '../chatgpt/text-route';
import { imageProblem, imageSupport, prepareImage, type ImageCodec } from './image-attachments';

const codec: ImageCodec = {
  async encode(_file, maxEdge, mime) {
    const scale = Math.min(1, maxEdge / 4000);
    return { dataUrl: `data:${mime};base64,AAAA`, width: Math.round(4000 * scale), height: Math.round(3000 * scale) };
  },
};

describe('image attachments', () => {
  it('validates type, size and count with clear messages', () => {
    expect(imageProblem({ name: 'a.pdf', type: 'application/pdf', size: 10 }, 0)).toMatch(/PNG, JPEG, WebP or GIF/);
    expect(imageProblem({ name: 'big.png', type: 'image/png', size: 11 * 1024 * 1024 }, 0)).toMatch(/11\.0 MB.*10 MB or smaller/);
    expect(imageProblem({ name: 'x.png', type: 'image/png', size: 10 }, 4)).toMatch(/up to 4 images/);
    expect(imageProblem({ name: 'x.webp', type: 'image/webp', size: 10 }, 1)).toBeUndefined();
  });

  it('downscales to 2048px for the model and keeps only a thumbnail for history', async () => {
    const file = new File(['x'], 'screen.jpg', { type: 'image/jpeg' });
    const { input, turn } = await prepareImage(file, codec);
    expect(input).toMatchObject({ name: 'screen.jpg', mime: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA' });
    expect(turn).toMatchObject({ width: 2048, height: 1536, thumbnail: expect.stringMatching(/^data:image\/jpeg/) });
  });

  it('never switches providers: a non-vision local model is refused, others proceed', () => {
    expect(imageSupport({ provider: 'ollama' }, false)).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot read images/) });
    expect(imageSupport({ provider: 'ollama' }, true)).toEqual({ ok: true });
    expect(imageSupport({ provider: 'openai' }, false)).toEqual({ ok: true });
    expect(imageSupport({ provider: 'chatgpt' }, false)).toEqual({ ok: true });
  });

  it('adds image parts to the last user message for the ChatGPT plan', () => {
    const messages = withImages(
      [
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'What is this?' },
      ],
      [{ name: 'a.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }],
    );
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'What is this?' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      ],
    });
  });
});

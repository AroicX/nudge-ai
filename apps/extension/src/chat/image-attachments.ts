import { IMAGE_MIME_TYPES, MAX_CHAT_IMAGES, type ChatImageInput, type TurnImage } from '@nudge/contracts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 2048;
const THUMBNAIL_EDGE = 160;

export interface PendingImage {
  id: string;
  name: string;
  status: 'preparing' | 'ready' | 'error';
  /** Full (downscaled) image sent with the request. */
  input?: ChatImageInput;
  /** Persisted preview. */
  turn?: TurnImage;
  error?: string;
}

export interface ImageCodec {
  /** Decode, downscale to `maxEdge` and re-encode. Returns a data URL and its size. */
  encode(file: Blob, maxEdge: number, mime: string): Promise<{ dataUrl: string; width: number; height: number }>;
}

export function imageProblem(file: { name: string; type: string; size: number }, existing: number): string | undefined {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type))
    return `“${file.name}” is not a supported image. Use PNG, JPEG, WebP or GIF.`;
  if (file.size > MAX_IMAGE_BYTES)
    return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. Images must be 10 MB or smaller.`;
  if (existing >= MAX_CHAT_IMAGES) return `You can attach up to ${MAX_CHAT_IMAGES} images per message.`;
  return undefined;
}

/** Downscale for the model (max 2048px) and make a small thumbnail for chat history. */
export async function prepareImage(file: File, codec: ImageCodec): Promise<{ input: ChatImageInput; turn: TurnImage }> {
  // GIF animation is not useful to the model; send a still frame as PNG.
  const outputMime = file.type === 'image/png' || file.type === 'image/gif' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const full = await codec.encode(file, MAX_IMAGE_EDGE, outputMime);
  if (full.dataUrl.length > 6_000_000) throw new Error(`“${file.name}” is still too large after resizing.`);
  const thumb = await codec.encode(file, THUMBNAIL_EDGE, 'image/jpeg');
  const mime = outputMime as ChatImageInput['mime'];
  return {
    input: { name: file.name.slice(0, 250), mime, dataUrl: full.dataUrl },
    turn: { name: file.name.slice(0, 250), mime, width: full.width, height: full.height, thumbnail: thumb.dataUrl.slice(0, 80_000) },
  };
}

/** Browser codec: createImageBitmap + canvas. */
export const canvasCodec: ImageCodec = {
  async encode(file, maxEdge, mime) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot process images.');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return { dataUrl: canvas.toDataURL(mime, 0.85), width, height };
  },
};

/** Which chat routes can read images. Never switches provider or billing. */
export function imageSupport(selection: { provider: 'openai' | 'ollama' | 'chatgpt' }, ollamaVision: boolean): { ok: true } | { ok: false; reason: string } {
  if (selection.provider === 'ollama' && !ollamaVision)
    return {
      ok: false,
      reason: 'The selected local model cannot read images. Choose an Ollama model with vision in Provider settings, or remove the images.',
    };
  return { ok: true };
}

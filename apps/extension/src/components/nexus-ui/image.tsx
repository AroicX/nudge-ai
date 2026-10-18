// Adapted from https://nexus-ui.dev/docs/components/image.
import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useContext, useMemo, type ImgHTMLAttributes, type ReactNode } from 'react';

const ImageContext = createContext<{ src?: string; alt: string }>({ alt: '' });

export function Image({
  src,
  base64,
  uint8Array,
  mediaType = 'image/png',
  alt = '',
  children,
  className,
}: {
  src?: string;
  base64?: string;
  uint8Array?: Uint8Array;
  mediaType?: string;
  alt?: string;
  children?: ReactNode;
  className?: string;
}) {
  const resolved = useMemo(() => sourceFrom(src, base64, uint8Array, mediaType), [src, base64, uint8Array, mediaType]);
  return (
    <Dialog.Root>
      <ImageContext.Provider value={resolved ? { src: resolved, alt } : { alt }}>
        <span className={className ? `nudge-image ${className}` : 'nudge-image'}>{children ?? <ImagePreview />}</span>
      </ImageContext.Provider>
    </Dialog.Root>
  );
}

export function ImagePreview({
  src,
  alt,
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const image = useContext(ImageContext);
  const resolved = src ?? image.src;
  if (!resolved) return <span className="nudge-image__loader" role="status" aria-label="Image loading" />;
  return (
    <Dialog.Trigger asChild>
      <button type="button" className="nudge-image__trigger" aria-label={alt || image.alt || 'View image'}>
        <img src={resolved} alt={alt ?? image.alt} className={className} {...props} />
      </button>
    </Dialog.Trigger>
  );
}

export function ImageLightbox({ children }: { children: ReactNode }) {
  return <Dialog.Portal>{children}</Dialog.Portal>;
}

export function ImageLightboxOverlay({ className }: { className?: string }) {
  return <Dialog.Overlay className={className ? `confirm-overlay ${className}` : 'confirm-overlay'} />;
}

export function ImageLightboxPreview({
  src,
  alt,
  children,
  className,
}: {
  src?: string;
  alt?: string;
  children?: ReactNode;
  className?: string;
}) {
  const image = useContext(ImageContext);
  const resolved = src ?? image.src;
  return (
    <Dialog.Content className={className ? `nudge-image__lightbox ${className}` : 'nudge-image__lightbox'}>
      <Dialog.Title className="sr-only">{alt || image.alt || 'Image preview'}</Dialog.Title>
      <Dialog.Description className="sr-only">Larger preview of this image.</Dialog.Description>
      {resolved ? <img src={resolved} alt={alt ?? image.alt} /> : <span className="nudge-image__loader" />}
      {children}
    </Dialog.Content>
  );
}

export function ImageLightboxClose({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <Dialog.Close className={className ? `secondary ${className}` : 'secondary'} aria-label="Close image">
      {children ?? 'Close'}
    </Dialog.Close>
  );
}

export function ImageLoader({ className }: { className?: string }) {
  return <span className={className ? `nudge-image__loader ${className}` : 'nudge-image__loader'} />;
}

function sourceFrom(src?: string, base64?: string, bytes?: Uint8Array, mediaType = 'image/png') {
  if (src) return src;
  if (base64?.startsWith('data:')) return base64;
  if (base64) return `data:${mediaType};base64,${base64}`;
  if (bytes) return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
  return undefined;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

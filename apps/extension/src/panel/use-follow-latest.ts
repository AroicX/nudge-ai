import { useEffect, useRef, useState, type RefObject } from 'react';

const frame = (callback: () => void) =>
  typeof requestAnimationFrame === 'undefined'
    ? window.setTimeout(callback, 0)
    : requestAnimationFrame(callback);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'undefined' ? window.clearTimeout(id) : cancelAnimationFrame(id);
const scrollBottom = () => {
  if (document.documentElement.scrollHeight > window.innerHeight)
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
};

/** Follow new content until the reader deliberately scrolls away from the bottom. */
export function useFollowLatest(content: RefObject<HTMLElement | null>, enabled: boolean) {
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const jump = () => {
    following.current = true;
    setShowJump(false);
    frame(scrollBottom);
  };
  useEffect(() => {
    if (!enabled) return;
    let scheduledFrame = 0;
    let previousY = window.scrollY;
    const follow = () => {
      cancelFrame(scheduledFrame);
      scheduledFrame = frame(() => {
        if (following.current) scrollBottom();
      });
    };
    const scrolled = () => {
      const nearBottom =
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 96;
      // Content growth and browser scroll anchoring can emit scroll events before
      // ResizeObserver runs. Only upward movement means the reader left the end.
      if (nearBottom) following.current = true;
      else if (window.scrollY < previousY - 2) following.current = false;
      previousY = window.scrollY;
      setShowJump(!following.current);
    };
    window.addEventListener('scroll', scrolled, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(follow);
    observer?.observe(document.body);
    if (content.current) observer?.observe(content.current);
    follow();
    return () => {
      cancelFrame(scheduledFrame);
      observer?.disconnect();
      window.removeEventListener('scroll', scrolled);
    };
  }, [content, enabled]);
  return { showJump, jump };
}

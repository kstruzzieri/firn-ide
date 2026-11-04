// src/hooks/useLiveAnnouncement.ts
import { useEffect, useRef, useState } from 'react';

// WebKit's repeated-text-after-clear test uses this gap to distinguish a
// deliberate repeat from a render in progress; a next-task refill stays silent.
// https://github.com/WebKit/WebKit/commit/6d28d6994a1f3178058782606b1145197aadaa08
const REPEAT_DELAY_MS = 400;

/**
 * The text a live region should hold for `request`. Pass a new object per
 * announcement, even for identical text. Each one clears the region, then
 * publishes on a later task so the finished redraw and any focus move reach the
 * accessibility tree first. Text matching the last one published waits through
 * the repeat gap so it is spoken again. Empty text only clears. The next request
 * or an unmount cancels whatever is still pending.
 */
export function useLiveAnnouncement(request: { text: string }): string {
  const [publishedRequest, setPublishedRequest] = useState<{ text: string } | null>(null);
  // Survives a clear, so a repeat after an empty request still waits the gap.
  const lastPublished = useRef('');
  useEffect(() => {
    if (request.text === '') return;
    const delay = request.text === lastPublished.current ? REPEAT_DELAY_MS : 0;
    const timer = window.setTimeout(() => {
      lastPublished.current = request.text;
      setPublishedRequest(request);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [request]);
  return publishedRequest === request ? request.text : '';
}

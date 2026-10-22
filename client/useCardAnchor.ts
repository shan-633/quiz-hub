import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Locate an incoming card link once; background refresh must not move the reader. */
export function useCardAnchor(ready: boolean) {
  const { hash } = useLocation();
  const positioned = useRef('');
  useEffect(() => {
    if (!hash) {
      positioned.current = '';
      return;
    }
    if (!ready || positioned.current === hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (!target) return;
    positioned.current = hash;
    target.dataset.cardAnchor = 'true';
    target.scrollIntoView?.({ block: 'center' });
    target.focus({ preventScroll: true });
    return () => {
      delete target.dataset.cardAnchor;
    };
  }, [hash, ready]);
}

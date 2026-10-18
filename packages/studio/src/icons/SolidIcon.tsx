import type { CSSProperties } from 'react';
import { SOLIDCRAFT_ICONS, type SolidIconId } from './solidcraft-icons.js';

/** One SolidCraft icon. The markup is the pack's own static SVG (bundled in
 *  solidcraft-icons.ts, never user input), so injecting it is safe. Ink follows
 *  currentColor; the accent follows the studio accent unless a parent sets
 *  --icon-accent. */
export function SolidIcon({ id, size = 18, className }: { id: SolidIconId; size?: number; className?: string }) {
  const style = { '--icon-accent': 'var(--reshape-accent, #2F6FED)', '--icon-bg': 'var(--reshape-bg, #fff)' } as CSSProperties;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      dangerouslySetInnerHTML={{ __html: SOLIDCRAFT_ICONS[id] }}
    />
  );
}

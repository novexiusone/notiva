import { describe, expect, it } from 'vitest';
import { ICON_CATEGORIES, ICON_SET, ICONS_BY_NAME, lucideIcon } from '@/features/pages/pageIcons';

const all = ICON_CATEGORIES.flatMap((category) => ICON_SET[category]);

describe('curated icon set', () => {
  it('has a reasonable size', () => {
    expect(all.length).toBeGreaterThanOrEqual(250);
    expect(all.length).toBeLessThanOrEqual(400);
  });

  it('only names icons that exist in lucide-react', () => {
    const missing = all.filter((name) => ICONS_BY_NAME[name] === undefined);
    expect(missing).toEqual([]);
  });

  it('lists no icon twice', () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it('still renders icons outside the curated set', () => {
    expect(lucideIcon('Anvil')).toBeDefined();
  });
});

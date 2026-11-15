import { icons, type LucideIcon } from 'lucide-react';

/** Icons stored before the whole set was offered, by their old names. */
const LEGACY: Record<string, string> = {
  book: 'BookOpen',
  checklist: 'ListChecks',
  document: 'FileText',
  idea: 'Lightbulb',
  heart: 'Heart',
  folder: 'Folder',
  star: 'Star',
  target: 'Target',
};

export const ICONS_BY_NAME = icons as Record<string, LucideIcon | undefined>;
const byName = ICONS_BY_NAME;

/** The Lucide name of a stored icon. */
export const iconName = (stored: string): string => LEGACY[stored] ?? stored;

/** The Lucide icon a stored icon names, if it names one. Emoji do not. */
export const lucideIcon = (stored: string): LucideIcon | undefined => byName[iconName(stored)];

/** Every Lucide icon once, by name; Lucide lists some icons under several names. */
export const ICON_NAMES: string[] = (() => {
  const seen = new Set<LucideIcon>();
  return Object.keys(icons)
    .sort()
    .filter((name) => {
      const icon = byName[name];
      if (!icon || seen.has(icon)) return false;
      seen.add(icon);
      return true;
    });
})();

/** `BookOpen` → `Book Open`. */
export const iconLabel = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

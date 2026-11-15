import {
  BookOpen,
  FileText,
  Folder,
  Heart,
  Lightbulb,
  ListChecks,
  Star,
  Table,
  Target,
  type LucideProps,
} from 'lucide-react';
import type { Page } from '@/lib/commands';

export const PAGE_ICONS = {
  book: BookOpen,
  checklist: ListChecks,
  document: FileText,
  folder: Folder,
  heart: Heart,
  idea: Lightbulb,
  star: Star,
  target: Target,
};

export function PageIcon({ page, ...props }: LucideProps & { page: Pick<Page, 'icon' | 'kind'> }) {
  const Icon =
    PAGE_ICONS[page.icon as keyof typeof PAGE_ICONS] ??
    (page.kind === 'database' ? Table : FileText);
  return <Icon aria-hidden {...props} />;
}

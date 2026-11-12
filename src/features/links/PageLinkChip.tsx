import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePages } from '@/features/pages/api';

/** How a link to another page looks in the text. */
export function PageLinkChip({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pages = usePages();
  const target = pages.data?.find((page) => page.id === pageId);

  // Until the pages have loaded it is not known whether the target exists.
  if (!target && pages.isSuccess) {
    return (
      <span className="text-muted-foreground line-through decoration-1" data-page-link="deleted">
        {t('links.deletedPage')}
      </span>
    );
  }

  return (
    <a
      role="link"
      data-page-link={pageId}
      className="decoration-muted-foreground/50 hover:bg-accent inline-flex cursor-pointer items-baseline gap-1 rounded-sm px-0.5 underline underline-offset-4"
      onClick={() => void navigate({ to: '/page/$pageId', params: { pageId } })}
    >
      <FileText
        size={14}
        aria-hidden
        className="text-muted-foreground translate-y-0.5 self-center"
      />
      {target ? target.title || t('pages.untitled') : ''}
    </a>
  );
}

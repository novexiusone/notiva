import { Check, FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useExport } from '@/features/export/useExport';

/** Slides in from the right: pick a format, then export the page with its subpages. */
export function ExportPanel({
  open,
  onOpenChange,
  pageId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  title: string;
}) {
  const { t } = useTranslation();
  const exportMarkdown = useExport();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await exportMarkdown(pageId);
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('export.close')}>
        <div className="flex flex-col gap-1 pr-8">
          <SheetTitle>{t('export.panelTitle')}</SheetTitle>
          <SheetDescription>
            {t('export.panelDescription', { title: title || t('pages.untitled') })}
          </SheetDescription>
        </div>
        <ul aria-label={t('export.formats')} className="flex flex-col gap-1">
          <li>
            <div className="bg-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm">
              <FileText size={16} aria-hidden />
              <span className="flex-1">{t('export.markdown')}</span>
              <Check size={16} aria-hidden />
            </div>
          </li>
        </ul>
        <Button className="mt-auto" disabled={busy} onClick={() => void run()}>
          {t('export.run')}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

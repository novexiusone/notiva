import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Adds a row. Its name for assistive technology is longer than what it shows. */
export function NewRowButton({ onNewRow }: { onNewRow: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="xs"
      className="mx-1"
      aria-label={t('databases.toolbar.newRowLabel')}
      onClick={onNewRow}
    >
      {t('databases.toolbar.newRow')}
    </Button>
  );
}

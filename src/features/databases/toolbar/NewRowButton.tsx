import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Adds a row. Its name for assistive technology is longer than what it shows. */
export function NewRowButton({
  onNewRow,
  readOnly = false,
}: {
  onNewRow: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      className="mx-1 px-3"
      aria-label={t('databases.toolbar.newRowLabel')}
      disabled={readOnly}
      onClick={onNewRow}
    >
      {t('databases.toolbar.newRow')}
    </Button>
  );
}

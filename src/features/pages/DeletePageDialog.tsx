import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type DeletePageDialogProps = {
  /**
   * The page to delete, or `null` while the dialog is closed. `rows` are the
   * rows of databases that go with it, `subpages` every other page below it.
   */
  page: { title: string; subpages: number; rows: number } | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeletePageDialog({ page, onConfirm, onCancel }: DeletePageDialogProps) {
  const { t } = useTranslation();

  const description = ({ subpages, rows }: { subpages: number; rows: number }) => {
    if (subpages > 0 && rows > 0) {
      return t('pages.deleteDescriptionWithSubpagesAndRows', {
        subpages: t('pages.subpageCount', { count: subpages }),
        rows: t('databases.rowCount', { count: rows }),
      });
    }
    if (rows > 0) return t('pages.deleteDescriptionWithRows', { count: rows });
    if (subpages > 0) return t('pages.deleteDescriptionWithSubpages', { count: subpages });
    return t('pages.deleteDescription');
  };

  return (
    <AlertDialog open={page !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        {page ? (
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pages.deleteTitle', { title: page.title || t('pages.untitled') })}
            </AlertDialogTitle>
            <AlertDialogDescription>{description(page)}</AlertDialogDescription>
          </AlertDialogHeader>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('pages.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t('pages.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

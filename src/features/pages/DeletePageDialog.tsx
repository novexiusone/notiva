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
  /** The page to delete, or `null` while the dialog is closed. */
  page: { title: string; subpages: number } | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeletePageDialog({ page, onConfirm, onCancel }: DeletePageDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={page !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        {page ? (
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pages.deleteTitle', { title: page.title || t('pages.untitled') })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {page.subpages > 0
                ? t('pages.deleteDescriptionWithSubpages', { count: page.subpages })
                : t('pages.deleteDescription')}
            </AlertDialogDescription>
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

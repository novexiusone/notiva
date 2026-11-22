import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { useSetLock } from '@/features/pages/api';
import type { Page } from '@/lib/commands';

export function PageLockMenuItems({
  page,
  beforeLock,
}: {
  page: Page;
  beforeLock: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const setLock = useSetLock();

  const change = async (lock: Page['lock']) => {
    if (lock !== 'none' && !(await beforeLock())) return;
    setLock(page.id, lock);
  };

  return (
    <>
      <DropdownMenuCheckboxItem
        checked={page.lock === 'content'}
        onCheckedChange={(checked) => void change(checked ? 'content' : 'none')}
      >
        <Lock aria-hidden />
        {t('pages.lockContent')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={page.lock === 'all'}
        onCheckedChange={(checked) => void change(checked ? 'all' : 'none')}
      >
        <Lock aria-hidden />
        {t('pages.lockEverything')}
      </DropdownMenuCheckboxItem>
    </>
  );
}

export function PageLockButton({ page, className }: { page: Page; className: string }) {
  const { t } = useTranslation();
  const setLock = useSetLock();

  if ((page.lock ?? 'none') === 'none') return null;

  return (
    <button
      type="button"
      aria-label={t('pages.unlock')}
      title={t('pages.unlock')}
      className={className}
      onClick={() => setLock(page.id, 'none')}
    >
      <Lock size={18} aria-hidden />
    </button>
  );
}

import { open } from '@tauri-apps/plugin-dialog';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { commands, type CommandError } from '@/lib/commands';

/**
 * Returns a function that exports one page with its subpages, or every page
 * when called with `null`. It asks for a folder first and reports the outcome.
 */
export function useExport() {
  const { t } = useTranslation();

  return useCallback(
    async (pageId: string | null) => {
      const directory = await open({ directory: true, title: t('export.chooseFolder') });
      // The dialog was dismissed.
      if (typeof directory !== 'string') return;

      try {
        const summary =
          pageId === null
            ? await commands.exportAll(directory)
            : await commands.exportPage(pageId, directory);
        toast.success(t('export.done', { count: summary.pages, directory: summary.directory }));
      } catch (error) {
        const message = (error as Partial<CommandError>).message ?? String(error);
        toast.error(t('export.failed', { message }));
      }
    },
    [t],
  );
}

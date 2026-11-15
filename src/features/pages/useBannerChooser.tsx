import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateAppearance } from '@/features/pages/api';
import type { CommandError } from '@/lib/commands';

/** The hidden file input for the banner and the function that opens it. */
export function useBannerChooser(pageId: string): { choose: () => void; input: ReactNode } {
  const { t } = useTranslation();
  const { saveBanner } = useUpdateAppearance();
  const input = useRef<HTMLInputElement>(null);

  const save = async (file: File | undefined) => {
    if (!file) return;
    try {
      await saveBanner(pageId, file);
    } catch (error) {
      const refused = (error as Partial<CommandError>).kind === 'invalid';
      toast.error(t(refused ? 'editor.imageRefused' : 'pages.bannerFailed'));
    }
  };

  return {
    choose: () => input.current?.click(),
    input: (
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={t('pages.chooseBanner')}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void save(file);
        }}
      />
    ),
  };
}

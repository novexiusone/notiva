import { MutationCache, QueryClient, type QueryClientConfig } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CommandError } from '@/lib/commands';
import { i18n } from '@/lib/i18n';

export function createQueryClient(defaultOptions?: QueryClientConfig['defaultOptions']) {
  return new QueryClient({
    defaultOptions,
    mutationCache: new MutationCache({
      onError: (error) => {
        if ((error as Partial<CommandError>).kind === 'locked') {
          toast.error(i18n.t('pages.lockedError'));
        }
      },
    }),
  });
}

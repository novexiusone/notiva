import { useQuery } from '@tanstack/react-query';
import { commands } from '@/lib/commands';

/** The pages that link to a page. Refetched whenever any page has been saved. */
export function useBacklinks(pageId: string) {
  return useQuery({
    queryKey: ['backlinks', pageId],
    queryFn: () => commands.listBacklinks(pageId),
  });
}

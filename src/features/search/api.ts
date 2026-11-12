import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { commands } from '@/lib/commands';

export const MIN_QUERY_LENGTH = 2;

/** Search results for a query. Never cached, so every search sees the current content. */
export function useSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => commands.search(trimmed),
    enabled: trimmed.length >= MIN_QUERY_LENGTH,
    // Keeps the previous results on screen while the next ones load.
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
  });
}

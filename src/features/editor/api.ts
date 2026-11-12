import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { commands, type Block } from '@/lib/commands';

const blocksKey = (pageId: string) => ['blocks', pageId] as const;

/**
 * The blocks of a page. They are loaded once and then kept in step by
 * `useSaveBlocks`: within a session the editor is the only writer.
 */
export function useBlocks(pageId: string) {
  return useQuery({
    queryKey: blocksKey(pageId),
    queryFn: () => commands.loadBlocks(pageId),
    staleTime: Infinity,
  });
}

export function useSaveBlocks(pageId: string) {
  const queryClient = useQueryClient();

  return useCallback(
    (blocks: Block[]) => {
      // Reopening the page shows the document as it was left, even while the save is under way.
      queryClient.setQueryData(blocksKey(pageId), blocks);
      return commands.saveBlocks(pageId, blocks).then(() => {
        // A saved page may have gained or lost links to other pages.
        void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      });
    },
    [pageId, queryClient],
  );
}

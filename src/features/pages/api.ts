import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { databaseKeys } from '@/features/databases/api';
import { pagesKey } from '@/features/pages/queryKeys';
import { descendantIds, movePage } from '@/features/pages/tree';
import { commands, type Database, type Page, type Row } from '@/lib/commands';

const renameKey = ['rename-page'] as const;

export function usePages() {
  return useQuery({ queryKey: pagesKey, queryFn: commands.listPages });
}

function useSetPages() {
  const queryClient = useQueryClient();
  return (update: (pages: Page[]) => Page[]) =>
    queryClient.setQueryData<Page[]>(pagesKey, (pages) => update(pages ?? []));
}

export function useCreatePage() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  return useMutation({
    mutationFn: (parentId: string | null) => commands.createPage(parentId),
    onSuccess: (page) => setPages((pages) => [...pages, page]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pagesKey }),
  });
}

/**
 * Renames a page. The cache is updated right away so that inputs bound to the
 * title never lag behind the keyboard; the saves themselves run one after
 * another so the last one wins.
 */
export function useRenamePage() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  const mutation = useMutation({
    mutationKey: renameKey,
    scope: { id: 'rename-page' },
    mutationFn: ({ id, title }: { id: string; title: string }) => commands.renamePage(id, title),
    onSettled: () => {
      // Refetching while another save is queued would bring back an older title.
      if (queryClient.isMutating({ mutationKey: renameKey }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: pagesKey });
      }
    },
  });

  return (id: string, title: string) => {
    const renamed = queryClient.getQueryData<Page[]>(pagesKey)?.find((page) => page.id === id);
    setPages((pages) => pages.map((page) => (page.id === id ? { ...page, title } : page)));
    // A database and its rows are pages too, and what was loaded about them carries the title.
    if (renamed?.kind === 'database') {
      queryClient.setQueryData<Database>(
        databaseKeys.database(id),
        (database) => database && { ...database, page: { ...database.page, title } },
      );
    }
    if (renamed?.databaseId) {
      queryClient.setQueryData<Row[]>(databaseKeys.rows(renamed.databaseId), (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, title } : row)),
      );
    }
    mutation.mutate({ id, title });
  };
}

export function useMovePage() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  const mutation = useMutation({
    mutationFn: ({ id, parentId, index }: { id: string; parentId: string | null; index: number }) =>
      commands.movePage(id, parentId, index),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pagesKey }),
  });

  return (id: string, parentId: string | null, index: number) => {
    setPages((pages) => movePage(pages, id, parentId, index));
    mutation.mutate({ id, parentId, index });
  };
}

export function useDeletePage() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  return useMutation({
    mutationFn: (id: string) => commands.deletePage(id),
    onSuccess: (_, id) => {
      const databaseId = queryClient
        .getQueryData<Page[]>(pagesKey)
        ?.find((page) => page.id === id)?.databaseId;
      setPages((pages) => {
        const removed = new Set([id, ...descendantIds(pages, id)]);
        return pages.filter((page) => !removed.has(page.id));
      });
      if (databaseId) {
        queryClient.setQueryData<Row[]>(databaseKeys.rows(databaseId), (rows) =>
          rows?.filter((row) => row.id !== id),
        );
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: pagesKey }),
        // Deleting a row empties relation cells, and deleting a database removes
        // the relation properties that pointed at it.
        queryClient.invalidateQueries({ queryKey: databaseKeys.all }),
      ]),
  });
}

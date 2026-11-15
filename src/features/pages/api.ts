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

export function useSetFavorite() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  const mutation = useMutation({
    mutationKey: ['favorite-page'],
    scope: { id: 'favorite-page' },
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      commands.setFavorite(id, favorite),
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['favorite-page'] }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: pagesKey });
      }
    },
  });

  return (id: string, favorite: boolean) => {
    setPages((pages) =>
      pages.map((page) => (page.id === id ? { ...page, isFavorite: favorite } : page)),
    );
    mutation.mutate({ id, favorite });
  };
}

export function useUpdateAppearance() {
  const queryClient = useQueryClient();
  const setPages = useSetPages();

  const mutation = useMutation({
    mutationKey: ['update-appearance'],
    scope: { id: 'update-appearance' },
    mutationFn: ({
      id,
      icon,
      banner,
    }: {
      id: string;
      icon: string | null;
      banner: string | null;
    }) => commands.updateAppearance(id, icon, banner),
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['update-appearance'] }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: pagesKey });
      }
    },
  });

  const change = (id: string, changes: { icon?: string | null; banner?: string | null }) => {
    const current = queryClient.getQueryData<Page[]>(pagesKey)?.find((page) => page.id === id);
    if (!current) return;
    const icon = changes.icon === undefined ? current.icon : changes.icon;
    const banner = changes.banner === undefined ? current.banner : changes.banner;
    const updatedAt = new Date().toISOString();
    // A new cover starts in the middle, as in the backend.
    const bannerPosition = banner === current.banner ? current.bannerPosition : 50;
    setPages((pages) =>
      pages.map((page) =>
        page.id === id ? { ...page, icon, banner, bannerPosition, updatedAt } : page,
      ),
    );
    mutation.mutate({ id, icon, banner });
  };

  const positionMutation = useMutation({
    mutationKey: ['banner-position'],
    scope: { id: 'banner-position' },
    mutationFn: ({ id, position }: { id: string; position: number }) =>
      commands.setBannerPosition(id, position),
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: ['banner-position'] }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: pagesKey });
      }
    },
  });

  /** Moves the cover image inside the cover; `position` is 0 to 100. */
  const setBannerPosition = (id: string, position: number) => {
    const updatedAt = new Date().toISOString();
    setPages((pages) =>
      pages.map((page) =>
        page.id === id ? { ...page, bannerPosition: position, updatedAt } : page,
      ),
    );
    positionMutation.mutate({ id, position });
  };

  return {
    change,
    setBannerPosition,
    saveBanner: async (id: string, file: Blob) =>
      change(id, { banner: await commands.saveImage(file) }),
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

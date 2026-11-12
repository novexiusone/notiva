import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { adjustMoveIndex, Tree, type CursorProps, type TreeApi } from 'react-arborist';
import { useTranslation } from 'react-i18next';
import {
  useCreatePage,
  useDeletePage,
  useMovePage,
  usePages,
  useRenamePage,
} from '@/features/pages/api';
import { useExport } from '@/features/export/useExport';
import { DeletePageDialog } from '@/features/pages/DeletePageDialog';
import { PageRow } from '@/features/pages/PageRow';
import { PageRowActionsContext } from '@/features/pages/pageRowActions';
import { buildTree, canMove, childIds, descendantIds, type PageNode } from '@/features/pages/tree';
import { openPages, rememberOpenPage } from '@/lib/localState';
import { useElementSize } from '@/lib/useElementSize';

const ROW_HEIGHT = 28;
const INDENT = 14;

function DropCursor({ top, left, indent }: CursorProps) {
  return (
    <div
      className="bg-foreground/50 pointer-events-none absolute h-0.5 rounded-full"
      style={{ top: top - 1, left: left + indent + 8, right: 8 }}
    />
  );
}

export function PageTree() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pageId: openPageId } = useParams({ strict: false });
  const pages = usePages();
  const createPage = useCreatePage();
  const renamePage = useRenamePage();
  const movePage = useMovePage();
  const deletePage = useDeletePage();
  const exportMarkdown = useExport();
  const tree = useRef<TreeApi<PageNode>>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const size = useElementSize(container);
  const [initialOpenState] = useState(openPages);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const list = useMemo(() => pages.data ?? [], [pages.data]);
  const nodes = useMemo(() => buildTree(list), [list]);

  const open = (id: string) => navigate({ to: '/page/$pageId', params: { pageId: id } });

  const create = async (parentId: string | null) => {
    const page = await createPage.mutateAsync(parentId);
    if (parentId !== null) {
      tree.current?.open(parentId);
      rememberOpenPage(parentId, true);
    }
    await open(page.id);
  };

  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    const id = pendingDelete;
    const removesOpenPage =
      openPageId !== undefined &&
      (openPageId === id || descendantIds(list, id).includes(openPageId));

    setPendingDelete(null);
    await deletePage.mutateAsync(id);
    if (removesOpenPage) await navigate({ to: '/' });
  };

  const actions = {
    openPageId,
    open,
    addSubpage: (id: string) => void create(id),
    remove: setPendingDelete,
    exportMarkdown: (id: string) => void exportMarkdown(id),
  };

  const pageToDelete = list.find((page) => page.id === pendingDelete);

  return (
    <section className="mt-5 flex min-h-0 flex-1 flex-col">
      <header className="flex h-7 items-center pr-3 pl-4">
        <h2 className="text-muted-foreground flex-1 text-xs font-medium">{t('sidebar.pages')}</h2>
        <button
          type="button"
          aria-label={t('pages.new')}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-5 items-center justify-center rounded-sm"
          onClick={() => void create(null)}
        >
          <Plus size={16} aria-hidden />
        </button>
      </header>

      <div ref={setContainer} className="min-h-0 flex-1">
        {pages.isSuccess && list.length === 0 ? (
          <p className="text-muted-foreground px-4 py-1 text-sm opacity-70">
            {t('sidebar.noPages')}
          </p>
        ) : container === null ? null : (
          <PageRowActionsContext.Provider value={actions}>
            <Tree<PageNode>
              ref={tree}
              // Without a root the drag-and-drop backend listens on the whole window and
              // cancels every drag it does not know, including block drags in the editor.
              dndRootElement={container}
              data={nodes}
              width="100%"
              // Until the container has been measured there is room for a few rows.
              height={size.height || ROW_HEIGHT * 10}
              rowHeight={ROW_HEIGHT}
              indent={INDENT}
              openByDefault={false}
              initialOpenState={initialOpenState}
              disableMultiSelection
              renderCursor={DropCursor}
              onToggle={(id) => rememberOpenPage(id, tree.current?.isOpen(id) ?? false)}
              onRename={({ id, name }) => renamePage(id, name.trim())}
              disableDrop={({ parentNode, dragNodes }) =>
                dragNodes.some(
                  (node) => !canMove(list, node.id, parentNode.isRoot ? null : parentNode.id),
                )
              }
              onMove={({ dragIds, parentId, index }) => {
                const id = dragIds[0];
                if (id === undefined || !canMove(list, id, parentId)) return;
                movePage(
                  id,
                  parentId,
                  adjustMoveIndex({ index, dragIds, siblingIds: childIds(list, parentId) }),
                );
                if (parentId !== null) rememberOpenPage(parentId, true);
              }}
            >
              {PageRow}
            </Tree>
          </PageRowActionsContext.Provider>
        )}
      </div>

      <DeletePageDialog
        page={
          pageToDelete
            ? { title: pageToDelete.title, subpages: descendantIds(list, pageToDelete.id).length }
            : null
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

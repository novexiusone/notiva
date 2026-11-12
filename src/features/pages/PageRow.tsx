import { ChevronDown, ChevronRight, FileText, MoreHorizontal, Plus } from 'lucide-react';
import { useContext, useRef } from 'react';
import type { NodeRendererProps } from 'react-arborist';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageRowActionsContext } from '@/features/pages/pageRowActions';
import type { PageNode } from '@/features/pages/tree';
import { cn } from '@/lib/utils';

const iconButton =
  'text-muted-foreground hover:bg-border hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-sm';

export function PageRow({ node, style, dragHandle }: NodeRendererProps<PageNode>) {
  const { t } = useTranslation();
  const actions = useContext(PageRowActionsContext);
  const title = node.data.title || t('pages.untitled');
  const hasChildren = node.data.children.length > 0;
  const startedRenaming = useRef(false);
  const isOpenPage = actions?.openPageId === node.id;
  // The indent comes from the tree; the rest lines the icon up with the sidebar items.
  const indent = typeof style.paddingLeft === 'number' ? style.paddingLeft : 0;

  return (
    <div
      ref={dragHandle}
      style={{ ...style, paddingLeft: indent + 6 }}
      onClick={() => actions?.open(node.id)}
      className={cn(
        'group text-muted-foreground hover:bg-accent hover:text-foreground mx-2 flex h-7 cursor-default items-center gap-1 rounded-sm pr-1 text-sm',
        (isOpenPage || node.willReceiveDrop) && 'bg-accent text-foreground',
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={node.isOpen ? t('pages.collapse') : t('pages.expand')}
          className={iconButton}
          onClick={(event) => {
            event.stopPropagation();
            node.toggle();
          }}
        >
          {node.isOpen ? (
            <ChevronDown size={16} aria-hidden />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )}
        </button>
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <FileText size={16} aria-hidden />
        </span>
      )}

      {node.isEditing ? (
        <input
          autoFocus
          aria-label={t('pages.title')}
          defaultValue={node.data.title}
          className="bg-background min-w-0 flex-1 rounded-sm px-1 outline-none"
          onClick={(event) => event.stopPropagation()}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => node.submit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') node.submit(event.currentTarget.value);
            if (event.key === 'Escape') node.reset();
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{title}</span>
      )}

      {/* Stays in the layout so the row does not jump; visible on hover, focus and while the menu is open. */}
      <div
        className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t('pages.actions')} className={iconButton}>
              <MoreHorizontal size={16} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-40"
            // The menu hands focus back to its trigger when it closes, which
            // would take it away from the rename input that just appeared.
            onCloseAutoFocus={(event) => {
              if (startedRenaming.current) event.preventDefault();
              startedRenaming.current = false;
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                startedRenaming.current = true;
                void node.edit();
              }}
            >
              {t('pages.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions?.exportMarkdown(node.id)}>
              {t('export.page')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => actions?.remove(node.id)}>
              {t('pages.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t('pages.addSubpage')}
          className={iconButton}
          onClick={() => actions?.addSubpage(node.id)}
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}

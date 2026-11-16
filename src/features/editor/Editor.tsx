import { de, en } from '@blocknote/core/locales';
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useCreateDatabase } from '@/features/databases/api';
import { useBlocks, useSaveBlocks } from '@/features/editor/api';
import { schema } from '@/features/editor/schema';
import { SlashMenu } from '@/features/editor/SlashMenu';
import {
  getSlashMenuItems,
  type SlashMenuActions,
  type SlashMenuItem,
} from '@/features/editor/slashMenuItems';
import { SlashMenuQueryContext } from '@/features/editor/slashMenuQuery';
import { useAutosave } from '@/features/editor/useAutosave';
import { getPageLinkItems, type PageLinkItem } from '@/features/links/pageLinkItems';
import { PageLinkMenu } from '@/features/links/PageLinkMenu';
import { useCreatePage, usePages } from '@/features/pages/api';
import { commands, type Block, type CommandError } from '@/lib/commands';
import { useColorScheme } from '@/lib/useColorScheme';

export type EditorHandle = { focus: () => void };

type EditorProps = { pageId: string; ref?: Ref<EditorHandle> };

/** The content of a page. */
export function Editor({ pageId, ref }: EditorProps) {
  const blocks = useBlocks(pageId);

  if (!blocks.isSuccess) return null;
  // A fresh editor per page: undo history and selection do not carry over.
  return <LoadedEditor key={pageId} pageId={pageId} initialBlocks={blocks.data} ref={ref} />;
}

/** What inside an embedded database takes clicks of its own. */
const CONTROLS =
  'button, a, input, textarea, select, [role="tab"], [role="gridcell"], [role="columnheader"], [role="menuitem"]';

function LoadedEditor({ pageId, initialBlocks, ref }: EditorProps & { initialBlocks: Block[] }) {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme();
  const autosave = useAutosave(useSaveBlocks(pageId));
  const [slashQuery, setSlashQuery] = useState('');
  const pages = usePages().data ?? [];
  // What went wrong with the last image or block that was to be added.
  const [insertError, setInsertError] = useState<string | null>(null);
  const { mutateAsync: createDatabase } = useCreateDatabase();
  const { mutateAsync: createPage } = useCreatePage();
  const navigate = useNavigate();
  const slashActions = useMemo<SlashMenuActions>(
    () => ({
      createDatabase: async () => {
        setInsertError(null);
        return (await createDatabase(pageId)).page.id;
      },
      createPage: async () => {
        setInsertError(null);
        return (await createPage(pageId)).id;
      },
      openPage: (id) => void navigate({ to: '/page/$pageId', params: { pageId: id } }),
      onFailure: (_error, what) =>
        setInsertError(t(what === 'page' ? 'editor.pageFailed' : 'editor.databaseFailed')),
    }),
    [createDatabase, createPage, navigate, pageId, t],
  );

  const editor = useCreateBlockNote({
    schema,
    dictionary: i18n.language === 'de' ? de : en,
    // Used for the file picker as well as for dropped and pasted images.
    uploadFile: async (file) => {
      setInsertError(null);
      try {
        return await commands.saveImage(file);
      } catch (error) {
        // The editor only reports that the upload failed; say why.
        const refused = (error as Partial<CommandError>).kind === 'invalid';
        setInsertError(t(refused ? 'editor.imageRefused' : 'editor.imageFailed'));
        throw error;
      }
    },
    _tiptapOptions: {
      editorProps: {
        // Keys pressed inside an embedded database belong to the database. Without
        // this, Backspace in a cell with the block selected removes the block.
        handleDOMEvents: {
          keydown: (_view, event) =>
            event.target instanceof Element &&
            event.target.closest('[data-database-block]') !== null,
          // A click on a control of the block must not select the block or leave the
          // editor holding the focus, or the next Backspace edits the document.
          mousedown: (view, event) => {
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const block = target.closest<HTMLElement>('[data-database-block]');
            if (!block || !target.closest(CONTROLS)) return false;
            view.dom.blur();
            window.getSelection()?.removeAllRanges();
            block.focus({ preventScroll: true });
            return true;
          },
        },
      },
    },
    // The backend stores exactly what the editor produced, so this is the editor's own shape.
    initialContent: initialBlocks.length > 0 ? (initialBlocks as never) : undefined,
  });

  useImperativeHandle(ref, () => ({ focus: () => editor.focus() }), [editor]);

  // A block that was selected through its handle stays selected until the
  // selection moves; a click anywhere else on the page ends it too.
  useEffect(() => {
    const clearBlockSelection = (event: PointerEvent) => {
      const view = editor._tiptapEditor.view;
      const { selection } = view.state;
      // Only a selected node (a block) has a `node`; a text selection has none.
      if (!('node' in selection)) return;
      if (event.target instanceof Node && view.dom.contains(event.target)) return;
      // Popovers and menus are not "elsewhere": they belong to the selected block.
      if (
        event.target instanceof Element &&
        event.target.closest('[data-radix-popper-content-wrapper]')
      )
        return;
      editor._tiptapEditor.commands.setTextSelection(selection.to);
      view.dom.blur();
    };
    document.addEventListener('pointerdown', clearBlockSelection);
    return () => document.removeEventListener('pointerdown', clearBlockSelection);
  }, [editor]);

  return (
    <>
      <SlashMenuQueryContext.Provider value={slashQuery}>
        <BlockNoteView
          editor={editor}
          theme={colorScheme}
          slashMenu={false}
          onChange={() => autosave.schedule(() => editor.document as unknown as Block[])}
        >
          <SuggestionMenuController<(query: string) => Promise<SlashMenuItem[]>>
            triggerCharacter="/"
            suggestionMenuComponent={SlashMenu}
            getItems={async (query) => {
              setSlashQuery(query);
              return getSlashMenuItems(editor, t, query, slashActions);
            }}
            onItemClick={(item) => item.onItemClick()}
          />
          <SuggestionMenuController<(query: string) => Promise<PageLinkItem[]>>
            triggerCharacter="[["
            suggestionMenuComponent={PageLinkMenu}
            getItems={async (query) => getPageLinkItems(pages, query)}
            onItemClick={(item) =>
              editor.insertInlineContent([{ type: 'pageLink', props: { pageId: item.id } }, ' '])
            }
          />
        </BlockNoteView>
      </SlashMenuQueryContext.Provider>
      {insertError !== null ? (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {insertError}
        </p>
      ) : null}
      {autosave.failed ? (
        <p role="status" className="text-destructive mt-4 text-sm">
          {t('editor.saveFailed')}
        </p>
      ) : null}
    </>
  );
}

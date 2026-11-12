import { de, en } from '@blocknote/core/locales';
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useImperativeHandle, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocks, useSaveBlocks } from '@/features/editor/api';
import { schema } from '@/features/editor/schema';
import { SlashMenu } from '@/features/editor/SlashMenu';
import { getSlashMenuItems, type SlashMenuItem } from '@/features/editor/slashMenuItems';
import { SlashMenuQueryContext } from '@/features/editor/slashMenuQuery';
import { useAutosave } from '@/features/editor/useAutosave';
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

function LoadedEditor({ pageId, initialBlocks, ref }: EditorProps & { initialBlocks: Block[] }) {
  const { t, i18n } = useTranslation();
  const colorScheme = useColorScheme();
  const autosave = useAutosave(useSaveBlocks(pageId));
  const [slashQuery, setSlashQuery] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);

  const editor = useCreateBlockNote({
    schema,
    dictionary: i18n.language === 'de' ? de : en,
    // Used for the file picker as well as for dropped and pasted images.
    uploadFile: async (file) => {
      setImageError(null);
      try {
        return await commands.saveImage(file);
      } catch (error) {
        // The editor only reports that the upload failed; say why.
        const refused = (error as Partial<CommandError>).kind === 'invalid';
        setImageError(t(refused ? 'editor.imageRefused' : 'editor.imageFailed'));
        throw error;
      }
    },
    // The backend stores exactly what the editor produced, so this is the editor's own shape.
    initialContent: initialBlocks.length > 0 ? (initialBlocks as never) : undefined,
  });

  useImperativeHandle(ref, () => ({ focus: () => editor.focus() }), [editor]);

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
              return getSlashMenuItems(editor, t, query);
            }}
            onItemClick={(item) => item.onItemClick()}
          />
        </BlockNoteView>
      </SlashMenuQueryContext.Provider>
      {imageError !== null ? (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {imageError}
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

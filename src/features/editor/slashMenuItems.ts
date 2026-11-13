import {
  FilePanelExtension,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import type { TFunction } from 'i18next';
import {
  Code,
  FlaskConical,
  Heading1,
  Heading2,
  Heading3,
  Image,
  List,
  ListChecks,
  ListOrdered,
  TextQuote,
  Type,
  type LucideIcon,
} from 'lucide-react';
import type { schema } from '@/features/editor/schema';

type Editor = typeof schema.BlockNoteEditor;
type NewBlock = Parameters<
  typeof insertOrUpdateBlockForSlashMenu<
    typeof schema.blockSchema,
    typeof schema.inlineContentSchema,
    typeof schema.styleSchema
  >
>[1];

export type SlashMenuGroup = 'suggested' | 'basic' | 'spike';

export type SlashMenuItem = {
  /** Unique within the menu, also across groups. */
  id: string;
  group: SlashMenuGroup;
  title: string;
  aliases: string[];
  icon: LucideIcon;
  /** What to type at the start of a line to get the same block. */
  shortcut?: string;
  onItemClick: () => void;
};

type Definition = {
  key:
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'bulletList'
    | 'numberedList'
    | 'checkList'
    | 'quote'
    | 'codeBlock'
    | 'image'
    | 'spike'
    | 'spikeSelectable';
  icon: LucideIcon;
  shortcut?: string;
  /** Extra search terms, in every UI language. */
  aliases: string[];
  block: NewBlock;
};

const definitions: Definition[] = [
  {
    key: 'paragraph',
    icon: Type,
    aliases: ['p', 'paragraph', 'text', 'absatz'],
    block: { type: 'paragraph' },
  },
  {
    key: 'heading1',
    icon: Heading1,
    shortcut: '#',
    aliases: ['h1', 'heading', 'title', 'überschrift', 'titel'],
    block: { type: 'heading', props: { level: 1 } },
  },
  {
    key: 'heading2',
    icon: Heading2,
    shortcut: '##',
    aliases: ['h2', 'heading', 'subtitle', 'überschrift'],
    block: { type: 'heading', props: { level: 2 } },
  },
  {
    key: 'heading3',
    icon: Heading3,
    shortcut: '###',
    aliases: ['h3', 'heading', 'überschrift'],
    block: { type: 'heading', props: { level: 3 } },
  },
  {
    key: 'bulletList',
    icon: List,
    shortcut: '-',
    aliases: ['ul', 'list', 'bullet', 'liste', 'aufzählung'],
    block: { type: 'bulletListItem' },
  },
  {
    key: 'numberedList',
    icon: ListOrdered,
    shortcut: '1.',
    aliases: ['ol', 'list', 'numbered', 'liste', 'nummeriert'],
    block: { type: 'numberedListItem' },
  },
  {
    key: 'checkList',
    icon: ListChecks,
    shortcut: '[]',
    aliases: ['todo', 'task', 'checkbox', 'check', 'aufgabe', 'checkliste'],
    block: { type: 'checkListItem' },
  },
  {
    key: 'quote',
    icon: TextQuote,
    shortcut: '>',
    aliases: ['blockquote', 'citation', 'zitat'],
    block: { type: 'quote' },
  },
  {
    key: 'codeBlock',
    icon: Code,
    shortcut: '```',
    aliases: ['code', 'pre', 'snippet'],
    block: { type: 'codeBlock' },
  },
  {
    key: 'image',
    icon: Image,
    aliases: ['image', 'picture', 'photo', 'img', 'bild', 'foto'],
    block: { type: 'image' },
  },
];

// Spike #52, throwaway: listed in a group of their own so the menu's other groups stay as they are.
const spikeDefinitions: Definition[] = [
  { key: 'spike', icon: FlaskConical, aliases: ['spike'], block: { type: 'spike' } },
  {
    key: 'spikeSelectable',
    icon: FlaskConical,
    aliases: ['spike', 'selectable'],
    block: { type: 'spikeSelectable' },
  },
];

const suggested: Definition['key'][] = ['paragraph', 'heading1', 'bulletList', 'checkList'];

/**
 * The entries of the slash menu for a filter text. Without a filter the menu
 * opens with a few suggestions followed by every block; with a filter each
 * matching block is listed once.
 */
export function getSlashMenuItems(editor: Editor, t: TFunction, query: string): SlashMenuItem[] {
  const item = (definition: Definition, group: SlashMenuGroup): SlashMenuItem => ({
    id: `${group}-${definition.key}`,
    group,
    title: t(`slashMenu.items.${definition.key}`),
    aliases: definition.aliases,
    icon: definition.icon,
    shortcut: definition.shortcut,
    onItemClick: () => {
      const inserted = insertOrUpdateBlockForSlashMenu(editor, definition.block);
      // An empty image block is of no use, so ask for the file right away.
      if (definition.key === 'image') {
        editor.getExtension(FilePanelExtension)?.showMenu(inserted.id);
      }
    },
  });

  const basic = definitions.map((definition) => item(definition, 'basic'));
  const spike = spikeDefinitions.map((definition) => item(definition, 'spike'));
  if (query.trim() !== '') return filterSuggestionItems([...basic, ...spike], query);

  const top = definitions
    .filter((definition) => suggested.includes(definition.key))
    .map((definition) => item(definition, 'suggested'));
  return [...top, ...basic, ...spike];
}

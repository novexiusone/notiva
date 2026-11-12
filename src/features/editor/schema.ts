import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs } from '@blocknote/core';

/**
 * The block types of the MVP. BlockNote's other default blocks stay off until
 * search and export can handle them.
 */
export const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    codeBlock: defaultBlockSpecs.codeBlock,
    quote: defaultBlockSpecs.quote,
  },
});

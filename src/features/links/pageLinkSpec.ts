import { createReactInlineContentSpec } from '@blocknote/react';
import { createElement } from 'react';
import { PageLinkChip } from '@/features/links/PageLinkChip';

/**
 * A link to another page. It stores the id of its target and shows the
 * target's current title, so renaming a page updates every link to it.
 */
export const pageLink = createReactInlineContentSpec(
  {
    type: 'pageLink',
    propSchema: { pageId: { default: '' } },
    content: 'none',
  },
  {
    render: ({ inlineContent }) =>
      createElement(PageLinkChip, { pageId: inlineContent.props.pageId }),
  },
);

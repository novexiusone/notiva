import { createReactBlockSpec } from '@blocknote/react';
import { DatabaseBlock } from '@/features/databases/DatabaseBlock';

/** The `database` block: an embedded database, stored as `{ databaseId }`. */
export const databaseBlock = createReactBlockSpec(
  { type: 'database', propSchema: { databaseId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <DatabaseBlock databaseId={block.props.databaseId} />,
    // Copied or exported, the block says what it was and which database it named.
    toExternalHTML: ({ block }) => <p data-database-id={block.props.databaseId}>Database</p>,
  },
);

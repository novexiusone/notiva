import { useTranslation } from 'react-i18next';
import { useDatabase, useRows } from '@/features/databases/api';
import { TableView } from '@/features/databases/table/TableView';

/**
 * What a database page shows below its title: the table of its rows. It sets
 * its own width, so that the table can use the whole main area without a
 * change to the page around it, and an editor block can show it as well.
 */
export function DatabaseView({ databaseId }: { databaseId: string }) {
  const { t } = useTranslation();
  const database = useDatabase(databaseId);
  const rows = useRows(databaseId);

  if (database.isError || rows.isError) {
    return (
      <p role="alert" className="text-muted-foreground mx-auto w-full max-w-[720px] px-12 text-sm">
        {t('databases.table.loadFailed')}
      </p>
    );
  }
  if (!database.isSuccess || !rows.isSuccess) return null;

  return <TableView database={database.data} rows={rows.data} />;
}

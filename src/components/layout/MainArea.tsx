import { useTranslation } from 'react-i18next';

export function MainArea() {
  const { t } = useTranslation();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="flex-1 overflow-y-auto">
        <article className="mx-auto w-full max-w-[720px] px-12 pt-16 pb-32">
          <h1 className="text-4xl font-bold tracking-tight">{t('home.title')}</h1>
          <p className="text-muted-foreground mt-4">{t('home.empty')}</p>
        </article>
      </div>
    </main>
  );
}

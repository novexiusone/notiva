import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { rememberLastPage } from '@/lib/localState';

export function HomeView() {
  const { t } = useTranslation();

  // Being on home is remembered too, so a restart does not jump back into a page.
  useEffect(() => rememberLastPage(null), []);

  return (
    <article className="mx-auto w-full max-w-[720px] px-12 pt-16 pb-32">
      <h1 className="text-4xl font-bold tracking-tight">{t('home.title')}</h1>
      <p className="text-muted-foreground mt-4">{t('home.empty')}</p>
    </article>
  );
}

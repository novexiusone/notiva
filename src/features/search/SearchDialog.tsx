import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { MIN_QUERY_LENGTH, useSearch } from '@/features/search/api';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

type SearchDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useTranslation();

  // Rendered only while open: every search starts empty and with fresh
  // results, and the dialog's hidden title stays out of the page otherwise.
  if (!open) return null;

  return (
    <CommandDialog
      open
      onOpenChange={onOpenChange}
      title={t('search.title')}
      description={t('search.description')}
    >
      <SearchPanel onDone={() => onOpenChange(false)} />
    </CommandDialog>
  );
}

function SearchPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const searched = useDebouncedValue(query.trim(), 120);
  const results = useSearch(searched);

  const tooShort = searched.length < MIN_QUERY_LENGTH;
  const hits = tooShort ? [] : (results.data ?? []);

  const open = (pageId: string) => {
    onDone();
    void navigate({ to: '/page/$pageId', params: { pageId } });
  };

  return (
    // The backend searches; cmdk only handles the keyboard and the selection.
    <Command shouldFilter={false}>
      <CommandInput value={query} onValueChange={setQuery} placeholder={t('search.placeholder')} />
      <CommandList>
        {tooShort ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t('search.hint')}</p>
        ) : results.isSuccess && hits.length === 0 ? (
          <p role="status" className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t('search.empty', { query: searched })}
          </p>
        ) : null}

        {hits.map((hit) => (
          <CommandItem
            key={hit.pageId}
            value={hit.pageId}
            onSelect={() => open(hit.pageId)}
            className="items-start"
          >
            <FileText size={16} aria-hidden className="text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{hit.title || t('pages.untitled')}</div>
              {hit.excerpt ? (
                <div className="text-muted-foreground line-clamp-2 text-xs">
                  {hit.excerpt.map((segment, index) =>
                    segment.matched ? (
                      <mark key={index} className="text-foreground bg-transparent font-semibold">
                        {segment.text}
                      </mark>
                    ) : (
                      segment.text
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

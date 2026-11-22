import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { PageLockMenuItems } from '@/features/pages/PageLock';
import { pagesKey } from '@/features/pages/queryKeys';
import { commands } from '@/lib/commands';
import { createQueryClient } from '@/lib/queryClient';
import { installFakeBackend } from '@/test/fakeBackend';
import { page } from '@/test/renderApp';

afterEach(() => vi.restoreAllMocks());

function renderLockMenu(beforeLock: () => Promise<boolean>) {
  const current = page('a', 'Alpha');
  installFakeBackend({ pages: [current] });
  const queryClient = createQueryClient({ queries: { retry: false } });
  queryClient.setQueryData(pagesKey, [current]);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <PageLockMenuItems page={current} beforeLock={beforeLock} />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  return { user };
}

describe('page lock menu', () => {
  it('does not lock when the pre-lock save fails', async () => {
    const beforeLock = vi.fn().mockResolvedValue(false);
    const setLock = vi.spyOn(commands, 'setLock');
    const { user } = renderLockMenu(beforeLock);

    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Lock content' }));

    await waitFor(() => expect(beforeLock).toHaveBeenCalled());
    expect(setLock).not.toHaveBeenCalled();
  });
});

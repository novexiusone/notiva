import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';

function renderSidebar() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar />
    </QueryClientProvider>,
  );
}

afterEach(() => clearMocks());

describe('Sidebar', () => {
  it('shows search, home and settings', () => {
    mockIPC(() => ({ name: 'Notiva', version: '1.2.3' }));
    renderSidebar();

    expect(screen.getByRole('button', { name: /Search/ })).toHaveTextContent('⌘K');
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('No pages yet')).toBeInTheDocument();
  });

  it('shows the app version reported by the backend', async () => {
    mockIPC((command) => {
      if (command === 'app_info') return { name: 'Notiva', version: '1.2.3' };
      throw new Error(`unexpected command ${command}`);
    });
    renderSidebar();

    expect(await screen.findByText('v1.2.3')).toBeInTheDocument();
  });

  it('renders without a version when the backend is unavailable', async () => {
    mockIPC(() => {
      throw new Error('backend unavailable');
    });
    renderSidebar();

    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
  });
});

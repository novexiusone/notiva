import { act, renderHook } from '@testing-library/react';
import { useAutosave } from '@/features/editor/useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Lets the queued save and its callbacks run. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useAutosave', () => {
  it('saves once, a moment after the last change', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));

    act(() => result.current.schedule(() => 'a'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => result.current.schedule(() => 'ab'));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
  });

  it('saves at once when the window loses focus', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));
    act(() => result.current.schedule(() => 'draft'));

    act(() => void window.dispatchEvent(new Event('blur')));
    await settle();

    expect(save).toHaveBeenCalledWith('draft');
  });

  it('saves a pending change when the component goes away', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save, 500));
    act(() => result.current.schedule(() => 'unsaved'));

    unmount();
    await settle();

    expect(save).toHaveBeenCalledWith('unsaved');
  });

  it('does nothing when there is nothing to save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave(save, 500));

    act(() => void window.dispatchEvent(new Event('blur')));
    unmount();
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it('runs saves one after another', async () => {
    const finished: string[] = [];
    let release!: () => void;
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockImplementationOnce(
        (value) =>
          new Promise<void>((resolve) => {
            release = () => {
              finished.push(value);
              resolve();
            };
          }),
      )
      .mockImplementation(async (value) => {
        finished.push(value);
      });
    const { result } = renderHook(() => useAutosave(save, 500));

    act(() => result.current.schedule(() => 'first'));
    act(() => void result.current.flush());
    await settle();
    act(() => result.current.schedule(() => 'second'));
    act(() => void result.current.flush());
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await settle();

    expect(finished).toEqual(['first', 'second']);
  });

  it('reports a failed save and sends the change again with the next flush', async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));

    act(() => result.current.schedule(() => 'important'));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(result.current.failed).toBe(true);

    act(() => void result.current.flush());
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('important');
    expect(result.current.failed).toBe(false);
  });
});

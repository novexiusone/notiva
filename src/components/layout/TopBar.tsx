import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TopBarSlot } from '@/components/layout/topBarSlot';

export function TopBar({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlot);
  return slot ? createPortal(children, slot) : null;
}

import { createContext } from 'react';

export type PageRowActions = {
  /** The page shown in the main area, if any. */
  openPageId: string | undefined;
  open: (id: string) => void;
  addSubpage: (id: string) => void;
  remove: (id: string) => void;
  exportMarkdown: (id: string) => void;
};

/** react-arborist renders the rows itself, so the actions reach them through context. */
export const PageRowActionsContext = createContext<PageRowActions | null>(null);

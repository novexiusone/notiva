import { createContext } from 'react';

/** The bar at the top of the main area; pages put their path and actions into it. */
export const TopBarSlot = createContext<HTMLElement | null>(null);

import type { Property, ViewConfig } from '@/lib/commands';

/** What every menu of the toolbar gets: the view's configuration and a way to change it. */
export type ToolbarMenuProps = {
  config: ViewConfig;
  properties: Property[];
  onChange: (config: ViewConfig) => void;
  readOnly?: boolean;
};

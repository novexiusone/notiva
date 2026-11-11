import { invoke } from '@tauri-apps/api/core';

export type AppInfo = { name: string; version: string };

/** The only place that calls into the Rust backend. */
export const commands = {
  appInfo: () => invoke<AppInfo>('app_info'),
};

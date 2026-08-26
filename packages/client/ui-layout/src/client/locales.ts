/** `layout` namespace dictionaries: keyboard-operable panel separators. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  application: 'DSH 应用',
  'resize.sidebar': '调整侧边栏宽度',
  'resize.details': '调整详情面板宽度',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  application: 'DSH application',
  'resize.sidebar': 'Resize sidebar',
  'resize.details': 'Resize details panel',
} satisfies Record<LayoutKey, string>

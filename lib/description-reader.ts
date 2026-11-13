/**
 * Rules for the full-screen task description (AWTD-1629).
 *
 * Web half of iOS AITD-649: `DescriptionReader.initialMode(text, isReadOnly,
 * entry:)` in astrid-ios. Kept pure so it can move into astrid-core if Android
 * needs the same rule.
 */

export type DescriptionReaderMode = 'edit' | 'preview'

/** How the reader was opened: the expand button, or a tap to add/change text. */
export type DescriptionReaderEntry = 'expand' | 'write'

export function descriptionReaderInitialMode(
  text: string,
  isReadOnly: boolean,
  entry: DescriptionReaderEntry
): DescriptionReaderMode {
  if (isReadOnly) return 'preview'
  if (entry === 'write') return 'edit'
  return text.trim() === '' ? 'edit' : 'preview'
}

/** Done saves only if the text changed; clearing it counts as a change. */
export function descriptionReaderSaveNeeded(original: string | undefined | null, draft: string): boolean {
  return (original ?? '') !== draft
}

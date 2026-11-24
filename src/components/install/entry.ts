// The page's own history entry. Its own module so tests can replace it: jsdom does not load documents.

/**
 * Loads `address` as a new document in place of the page's own history entry. Chromium keeps the address a
 * tab was asked to open (the link, fragment included) in that entry, also after `history.replaceState`;
 * only a new entry, which a cross-document replacement starts, no longer has it.
 */
export function replaceEntry(address: string) {
  window.location.replace(address);
}

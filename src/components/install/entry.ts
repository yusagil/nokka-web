// The page's own history entry and the browser's download. Their own module so tests can replace them: jsdom
// does not load documents or download files.

/**
 * Loads `address` as a new document in place of the page's own history entry. Chromium keeps the address a
 * tab was asked to open (the link, fragment included) in that entry, also after `history.replaceState`;
 * only a new entry, which a cross-document replacement starts, no longer has it.
 */
export function replaceEntry(address: string) {
  window.location.replace(address);
}

/**
 * Starts the browser's own download of the attachment at `address` (same origin, so the link's cookie goes
 * with it), as a click on a download link would; the page stays where it is.
 */
export function startDownload(address: string, filename: string) {
  const link = document.createElement("a");
  link.href = address;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

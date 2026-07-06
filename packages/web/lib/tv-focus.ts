/** Shared TV focus helpers for spatial nav and page views. */

const TV_SCROLL_BEHAVIOR: ScrollBehavior = "auto";
const HORIZONTAL_SCROLL_PADDING = 32;

let tvFocusedElement: HTMLElement | null = null;

/** Sync focus ring attribute without scanning the whole document. */
export function syncTvFocusedAttribute(el: HTMLElement) {
  if (tvFocusedElement && tvFocusedElement !== el) {
    tvFocusedElement.removeAttribute("data-tv-focused");
  }
  tvFocusedElement = el;
  el.setAttribute("data-tv-focused", "");
}

function isRowVisibleInMain(row: HTMLElement): boolean {
  const main = document.querySelector("main");
  if (!main) return true;

  const mainRect = main.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const margin = 24;

  return (
    rowRect.top >= mainRect.top - margin &&
    rowRect.bottom <= mainRect.bottom + margin
  );
}

/** Keep the focused tile in view — scroll only when near the row edge (not center). */
function scrollHorizontalRowItemIntoView(el: HTMLElement, row: HTMLElement) {
  const rowRect = row.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const pad = HORIZONTAL_SCROLL_PADDING;

  let delta = 0;
  if (elRect.left < rowRect.left + pad) {
    delta = elRect.left - rowRect.left - pad;
  } else if (elRect.right > rowRect.right - pad) {
    delta = elRect.right - rowRect.right + pad;
  }

  if (delta !== 0) {
    row.scrollTo({
      left: Math.max(0, row.scrollLeft + delta),
      behavior: TV_SCROLL_BEHAVIOR,
    });
  }
}

export function scrollItemIntoView(
  el: HTMLElement,
  behavior: ScrollBehavior = TV_SCROLL_BEHAVIOR,
) {
  const horizontalRow = el.closest<HTMLElement>(
    "[data-tv-scroll-row]:not([data-tv-vertical])",
  );

  if (horizontalRow) {
    scrollHorizontalRowItemIntoView(el, horizontalRow);

    if (!isRowVisibleInMain(horizontalRow)) {
      horizontalRow.scrollIntoView({ behavior, block: "nearest", inline: "nearest" });
    }
    return;
  }

  el.scrollIntoView({
    behavior,
    block: "nearest",
    inline: "nearest",
  });
}

export function focusTvItem(
  el: HTMLElement,
  scrollBehavior: ScrollBehavior = TV_SCROLL_BEHAVIOR,
) {
  syncTvFocusedAttribute(el);
  el.focus({ preventScroll: true });
  scrollItemIntoView(el, scrollBehavior);
}

/** Focus a TV episode row by file id. Returns false if the row is not in the DOM. */
export function focusEpisodeItem(episodeId: number): boolean {
  const main = document.querySelector("main");
  if (!main) return false;
  const item = main.querySelector<HTMLElement>(
    `[data-tv-item][data-tv-episode-id="${episodeId}"]`,
  );
  if (!item) return false;
  focusTvItem(item);
  return true;
}

/** Focus the first focusable item inside main content (skips side nav and page chrome). */
export function focusFirstContentItem() {
  const main = document.querySelector("main");
  if (!main) return;

  const posterRow =
    main.querySelector<HTMLElement>("[data-tv-grid]") ??
    main.querySelector<HTMLElement>("[data-tv-scroll-row]");
  const posterItem = posterRow?.querySelector<HTMLElement>("[data-tv-item]");
  if (posterItem) {
    focusTvItem(posterItem);
    return;
  }

  const item = main.querySelector<HTMLElement>("[data-tv-item]");
  if (item) focusTvItem(item);
}

/** Focus the first item in the topmost content row. */
export function focusPrimaryContentItem() {
  const main = document.querySelector("main");
  if (!main) return;
  const row = main.querySelector<HTMLElement>("[data-tv-content-row]");
  const item = row?.querySelector<HTMLElement>("[data-tv-item]");
  if (item) focusTvItem(item);
}

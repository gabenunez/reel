/** Shared TV focus helpers for spatial nav and page views. */

export function scrollItemIntoView(el: HTMLElement) {
  const scrollRow = el.closest<HTMLElement>("[data-tv-scroll-row]");
  if (scrollRow) {
    const rowRect = scrollRow.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetLeft =
      scrollRow.scrollLeft +
      (elRect.left - rowRect.left) -
      (rowRect.width - elRect.width) / 2;
    scrollRow.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
  }

  const section =
    el.closest<HTMLElement>("section") ??
    el.closest<HTMLElement>("[data-tv-content-row]");
  if (section) {
    section.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    return;
  }

  el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

export function focusTvItem(el: HTMLElement) {
  document.querySelectorAll<HTMLElement>("[data-tv-focused]").forEach((node) => {
    node.removeAttribute("data-tv-focused");
  });
  el.setAttribute("data-tv-focused", "");
  el.focus({ preventScroll: true });
  requestAnimationFrame(() => scrollItemIntoView(el));
}

/** Focus the first focusable item inside main content (skips side nav). */
export function focusFirstContentItem() {
  const main = document.querySelector("main");
  if (!main) return;
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

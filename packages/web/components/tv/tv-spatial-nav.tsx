"use client";

import { focusTvItem, syncTvFocusedAttribute } from "@/lib/tv-focus";
import { useEffect, type ReactNode } from "react";

const NAV_COOLDOWN_MS = 50;
const NAV_REPEAT_COOLDOWN_MS = 32;
/** No throttle when holding left/right across a poster row. */
const NAV_SCROLL_ROW_REPEAT_COOLDOWN_MS = 0;

function isTvFocusable(el: HTMLElement) {
  return (
    !el.hasAttribute("disabled") &&
    el.offsetParent !== null &&
    !el.closest("[inert]") &&
    el.tabIndex !== -1
  );
}

function getRowItems(row: Element) {
  return Array.from(row.querySelectorAll<HTMLElement>("[data-tv-item]")).filter(isTvFocusable);
}

function getContentRows() {
  const main = document.querySelector("main");
  if (!main) return [];
  return Array.from(main.querySelectorAll<HTMLElement>("[data-tv-content-row]"));
}

function getNavRow() {
  return document.querySelector<HTMLElement>("[data-tv-nav-row]");
}

function isScrollRow(row: Element) {
  return (
    row.hasAttribute("data-tv-scroll-row") &&
    !row.hasAttribute("data-tv-grid") &&
    !row.hasAttribute("data-tv-vertical")
  );
}

function focusItem(el: HTMLElement) {
  focusTvItem(el);
}

function estimateGridColumns(items: HTMLElement[]): number {
  if (items.length <= 1) return 1;
  const firstTop = items[0].getBoundingClientRect().top;
  let cols = 1;
  for (let i = 1; i < items.length; i++) {
    if (Math.abs(items[i].getBoundingClientRect().top - firstTop) < 4) cols++;
    else break;
  }
  return cols || 1;
}

function moveInGridRow(
  active: HTMLElement,
  direction: "left" | "right" | "up" | "down",
) {
  const row = active.closest("[data-tv-row][data-tv-grid]");
  if (!row) return false;

  const items = getRowItems(row);
  const index = items.indexOf(active);
  if (index === -1) return false;

  const cols = estimateGridColumns(items);

  if (direction === "right" && index < items.length - 1) {
    focusItem(items[index + 1]);
    return true;
  }

  if (direction === "left" && index > 0) {
    focusItem(items[index - 1]);
    return true;
  }

  if (direction === "down") {
    const next = index + cols;
    if (next < items.length) {
      focusItem(items[next]);
      return true;
    }
  }

  if (direction === "up") {
    const prev = index - cols;
    if (prev >= 0) {
      focusItem(items[prev]);
      return true;
    }
  }

  return false;
}

function findNextByGeometry(
  active: HTMLElement,
  direction: "left" | "right" | "up" | "down",
): HTMLElement | null {
  const container = active.closest("[data-tv-row]");
  if (!container) return null;

  const items = getRowItems(container);
  const rect = active.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let best: { el: HTMLElement; score: number } | null = null;

  for (const item of items) {
    if (item === active) continue;
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    if (direction === "right" && cx <= centerX + 4) continue;
    if (direction === "left" && cx >= centerX - 4) continue;
    if (direction === "down" && cy <= centerY + 4) continue;
    if (direction === "up" && cy >= centerY - 4) continue;

    const primary =
      direction === "left" || direction === "right"
        ? Math.abs(cx - centerX)
        : Math.abs(cy - centerY);
    const secondary =
      direction === "left" || direction === "right"
        ? Math.abs(cy - centerY)
        : Math.abs(cx - centerX);
    const score = primary + secondary * 3;

    if (!best || score < best.score) best = { el: item, score };
  }

  return best?.el ?? null;
}

function getAdjacentScrollRowItem(
  active: HTMLElement,
  direction: "left" | "right",
): HTMLElement | null {
  const tile = active.closest(".tv-poster-tile");
  if (tile?.parentElement) {
    let sibling: Element | null =
      direction === "right" ? tile.nextElementSibling : tile.previousElementSibling;
    while (sibling) {
      const item =
        sibling instanceof HTMLElement && sibling.hasAttribute("data-tv-item")
          ? sibling
          : sibling.querySelector<HTMLElement>("[data-tv-item]");
      if (item && isTvFocusable(item)) return item;
      sibling =
        direction === "right" ? sibling.nextElementSibling : sibling.previousElementSibling;
    }
    return null;
  }

  let sibling: Element | null =
    direction === "right" ? active.nextElementSibling : active.previousElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.hasAttribute("data-tv-item")) {
      if (isTvFocusable(sibling)) return sibling;
    } else {
      const item = sibling.querySelector<HTMLElement>("[data-tv-item]");
      if (item && isTvFocusable(item)) return item;
    }
    sibling =
      direction === "right" ? sibling.nextElementSibling : sibling.previousElementSibling;
  }

  return null;
}

function moveInScrollRow(active: HTMLElement, direction: "left" | "right") {
  const row = active.closest("[data-tv-row]");
  if (!row || !isScrollRow(row)) return false;

  const next = getAdjacentScrollRowItem(active, direction);
  if (!next) {
    return false;
  }

  focusItem(next);
  return true;
}

function moveInVerticalRow(active: HTMLElement, direction: "up" | "down") {
  const row = active.closest("[data-tv-row][data-tv-vertical]");
  if (!row) return false;

  const items = getRowItems(row);
  const index = items.indexOf(active);
  if (index === -1) return false;

  if (direction === "down" && index < items.length - 1) {
    focusItem(items[index + 1]);
    return true;
  }

  if (direction === "up" && index > 0) {
    focusItem(items[index - 1]);
    return true;
  }

  return false;
}

function focusNavFromContent(active: HTMLElement) {
  const navRow = getNavRow();
  if (!navRow) return false;

  const navItems = getRowItems(navRow);
  if (!navItems.length) return false;

  const rect = active.getBoundingClientRect();
  const verticalNav = navRow.hasAttribute("data-tv-vertical");
  const activeCenter = verticalNav
    ? rect.top + rect.height / 2
    : rect.left + rect.width / 2;

  let best = navItems[0];
  let bestDist = Infinity;

  for (const item of navItems) {
    const r = item.getBoundingClientRect();
    const itemCenter = verticalNav
      ? r.top + r.height / 2
      : r.left + r.width / 2;
    const dist = Math.abs(itemCenter - activeCenter);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }

  focusItem(best);
  return true;
}

function focusContentFromNav(active: HTMLElement) {
  const contentRows = getContentRows();
  if (!contentRows.length) return false;

  const navRow = getNavRow();
  const navItems = navRow ? getRowItems(navRow) : [];
  const navIndex = navItems.indexOf(active);

  for (const row of contentRows) {
    const items = getRowItems(row);
    if (!items.length) continue;
    const next = items[Math.min(Math.max(navIndex, 0), items.length - 1)];
    focusItem(next);
    return true;
  }

  return false;
}

function moveHorizontal(active: HTMLElement, direction: "left" | "right") {
  const row = active.closest("[data-tv-row]");
  if (!row) return false;

  const inNav = row.hasAttribute("data-tv-nav-row");

  if (inNav && direction === "right" && row.hasAttribute("data-tv-vertical")) {
    return focusContentFromNav(active);
  }

  if (!inNav && row.hasAttribute("data-tv-grid")) {
    if (moveInGridRow(active, direction)) return true;
  }

  if (!inNav && isScrollRow(row)) {
    if (moveInScrollRow(active, direction)) return true;
    if (direction === "left") return focusNavFromContent(active);
    return false;
  }

  const next = findNextByGeometry(active, direction);
  if (next) {
    focusItem(next);
    return true;
  }

  if (!inNav && direction === "left") {
    return focusNavFromContent(active);
  }

  return false;
}

function moveVertical(active: HTMLElement, direction: "up" | "down") {
  const contentRows = getContentRows();
  const activeRow = active.closest("[data-tv-row]");
  if (!activeRow) return false;

  const inNav = activeRow.hasAttribute("data-tv-nav-row");
  const contentIndex = contentRows.indexOf(activeRow as HTMLElement);

  if (inNav) {
    const next = findNextByGeometry(active, direction);
    if (next) {
      focusItem(next);
      return true;
    }
    if (direction === "down" && !activeRow.hasAttribute("data-tv-vertical")) {
      return focusContentFromNav(active);
    }
    return false;
  }

  if (activeRow.hasAttribute("data-tv-vertical")) {
    if (moveInVerticalRow(active, direction)) return true;
  }

  if (activeRow.hasAttribute("data-tv-grid")) {
    if (moveInGridRow(active, direction)) return true;
  }

  if (direction === "down" && contentIndex >= 0 && contentIndex < contentRows.length - 1) {
    const items = getRowItems(activeRow);
    const itemIndex = items.indexOf(active);
    const nextItems = getRowItems(contentRows[contentIndex + 1]);
    const next = nextItems[Math.min(itemIndex, nextItems.length - 1)];
    if (next) {
      focusItem(next);
      return true;
    }
    return false;
  }

  if (direction === "up" && contentIndex === 0) {
    return focusNavFromContent(active);
  }

  if (direction === "up" && contentIndex > 0) {
    const items = getRowItems(activeRow);
    const itemIndex = items.indexOf(active);
    const prevItems = getRowItems(contentRows[contentIndex - 1]);
    const prev = prevItems[Math.min(itemIndex, prevItems.length - 1)];
    if (prev) {
      focusItem(prev);
      return true;
    }
    return false;
  }

  return false;
}

export function TvSpatialNav({ children }: { children: ReactNode }) {
  useEffect(() => {
    let lastMoveAt = 0;

    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === "Enter" ||
        e.key === "NumpadEnter" ||
        e.key === "Select"
      ) {
        const active = document.activeElement as HTMLElement | null;
        if (
          active?.hasAttribute("data-tv-item") &&
          (active.tagName === "BUTTON" || active.tagName === "A")
        ) {
          e.preventDefault();
          active.click();
        }
        return;
      }

      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown"
      ) {
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      if (!active?.hasAttribute("data-tv-item")) return;

      if (document.querySelector("[data-tv-watch-player]")) {
        if (active.hasAttribute("data-tv-watch-scrub")) return;
        if (
          !active.closest("[data-tv-watch-menu]") &&
          !active.closest("[data-tv-watch-controls]")
        ) {
          return;
        }
        // Watch view handles Up/Down on the control bar (menus, play focus).
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          return;
        }
      }

      const row = active.closest("[data-tv-row]");
      if (!row) return;

      e.preventDefault();

      const now = performance.now();
      const horizontalScrollRow =
        isScrollRow(row) && (e.key === "ArrowLeft" || e.key === "ArrowRight");
      const cooldown = e.repeat
        ? horizontalScrollRow
          ? NAV_SCROLL_ROW_REPEAT_COOLDOWN_MS
          : NAV_REPEAT_COOLDOWN_MS
        : NAV_COOLDOWN_MS;
      if (now - lastMoveAt < cooldown) return;
      lastMoveAt = now;

      if (e.key === "ArrowRight") {
        moveHorizontal(active, "right");
        return;
      }

      if (e.key === "ArrowLeft") {
        moveHorizontal(active, "left");
        return;
      }

      if (e.key === "ArrowDown") {
        moveVertical(active, "down");
        return;
      }

      moveVertical(active, "up");
    }

    function onFocusIn(e: FocusEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.hasAttribute("data-tv-item")) return;
      syncTvFocusedAttribute(target);
    }

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  return <>{children}</>;
}

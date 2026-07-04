"use client";

import { focusTvItem, scrollItemIntoView } from "@/lib/tv-focus";
import { useEffect, type ReactNode } from "react";

const NAV_COOLDOWN_MS = 90;
const NAV_REPEAT_COOLDOWN_MS = 45;

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
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tv-content-row]"));
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

function moveInScrollRow(active: HTMLElement, direction: "left" | "right") {
  const row = active.closest("[data-tv-row]");
  if (!row || !isScrollRow(row)) return false;

  const items = getRowItems(row);
  const index = items.indexOf(active);
  if (index === -1) return false;

  if (direction === "right" && index < items.length - 1) {
    focusTvItem(items[index + 1]);
    return true;
  }

  if (direction === "left" && index > 0) {
    focusTvItem(items[index - 1]);
    return true;
  }

  return false;
}

function focusNavFromContent(active: HTMLElement) {
  const navRow = getNavRow();
  if (!navRow) return false;

  const navItems = getRowItems(navRow);
  if (!navItems.length) return false;

  const centerY = active.getBoundingClientRect().top + active.getBoundingClientRect().height / 2;
  let best = navItems[0];
  let bestDist = Infinity;

  for (const item of navItems) {
    const r = item.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const dist = Math.abs(cy - centerY);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }

  focusTvItem(best);
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
    focusTvItem(next);
    return true;
  }

  return false;
}

function moveHorizontal(active: HTMLElement, direction: "left" | "right") {
  const row = active.closest("[data-tv-row]");
  if (!row) return false;

  const inNav = row.hasAttribute("data-tv-nav-row");

  if (inNav && direction === "right") {
    return focusContentFromNav(active);
  }

  if (!inNav && isScrollRow(row)) {
    if (moveInScrollRow(active, direction)) return true;
    if (direction === "left") return focusNavFromContent(active);
    return false;
  }

  const next = findNextByGeometry(active, direction);
  if (next) {
    focusTvItem(next);
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
      focusTvItem(next);
      return true;
    }
    return false;
  }

  if (activeRow.hasAttribute("data-tv-grid") || activeRow.hasAttribute("data-tv-vertical")) {
    const next = findNextByGeometry(active, direction);
    if (next) {
      focusTvItem(next);
      return true;
    }
  }

  if (direction === "down" && contentIndex >= 0 && contentIndex < contentRows.length - 1) {
    const items = getRowItems(activeRow);
    const itemIndex = items.indexOf(active);
    const nextItems = getRowItems(contentRows[contentIndex + 1]);
    const next = nextItems[Math.min(itemIndex, nextItems.length - 1)];
    if (next) {
      focusTvItem(next);
      return true;
    }
    return false;
  }

  if (direction === "up" && contentIndex > 0) {
    const items = getRowItems(activeRow);
    const itemIndex = items.indexOf(active);
    const prevItems = getRowItems(contentRows[contentIndex - 1]);
    const prev = prevItems[Math.min(itemIndex, prevItems.length - 1)];
    if (prev) {
      focusTvItem(prev);
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
      }

      const row = active.closest("[data-tv-row]");
      if (!row) return;

      e.preventDefault();

      const now = performance.now();
      const cooldown = e.repeat ? NAV_REPEAT_COOLDOWN_MS : NAV_COOLDOWN_MS;
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
      document.querySelectorAll<HTMLElement>("[data-tv-focused]").forEach((node) => {
        if (node !== target) node.removeAttribute("data-tv-focused");
      });
      target.setAttribute("data-tv-focused", "");
      requestAnimationFrame(() => scrollItemIntoView(target));
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

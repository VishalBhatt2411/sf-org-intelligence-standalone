// Keyboard handling for the Explorer search box, kept free of React so it can be tested directly.

export type SearchNavState = { open: boolean; active: number };
export type SearchNavResult = { state: SearchNavState; action: "select" | "close" | null; index?: number };

export const SEARCH_MIN_CHARS = 2;

// `count` is the number of results currently listed. Arrow keys wrap, Enter picks the highlighted
// result (or the first when none is highlighted), Escape closes. Anything else changes nothing.
export function searchKeyDown(state: SearchNavState, key: string, count: number): SearchNavResult {
  switch (key) {
    case "ArrowDown":
      if (count === 0) return { state, action: null };
      return { state: { open: true, active: state.open ? (state.active + 1) % count : 0 }, action: null };
    case "ArrowUp":
      if (count === 0) return { state, action: null };
      return { state: { open: true, active: state.open && state.active > 0 ? state.active - 1 : count - 1 }, action: null };
    case "Home":
      return count === 0 ? { state, action: null } : { state: { open: true, active: 0 }, action: null };
    case "End":
      return count === 0 ? { state, action: null } : { state: { open: true, active: count - 1 }, action: null };
    case "Enter":
      if (!state.open || count === 0) return { state, action: null };
      return { state: { open: false, active: -1 }, action: "select", index: state.active >= 0 && state.active < count ? state.active : 0 };
    case "Escape":
      return { state: { open: false, active: -1 }, action: "close" };
    default:
      return { state, action: null };
  }
}

export const canSearch = (query: string): boolean => query.trim().length >= SEARCH_MIN_CHARS;

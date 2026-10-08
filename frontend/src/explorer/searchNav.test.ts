import { describe, expect, it } from "vitest";
import { canSearch, searchKeyDown, type SearchNavState } from "./searchNav";

const closed: SearchNavState = { open: false, active: -1 };
const open = (active: number): SearchNavState => ({ open: true, active });

describe("searchKeyDown", () => {
  it("opens on ArrowDown at the first result, then moves down and wraps", () => {
    expect(searchKeyDown(closed, "ArrowDown", 3).state).toEqual(open(0));
    expect(searchKeyDown(open(0), "ArrowDown", 3).state).toEqual(open(1));
    expect(searchKeyDown(open(2), "ArrowDown", 3).state).toEqual(open(0));
  });

  it("moves up and wraps to the last result, starting from the end when closed", () => {
    expect(searchKeyDown(open(2), "ArrowUp", 3).state).toEqual(open(1));
    expect(searchKeyDown(open(0), "ArrowUp", 3).state).toEqual(open(2));
    expect(searchKeyDown(closed, "ArrowUp", 3).state).toEqual(open(2));
  });

  it("jumps to the ends with Home and End", () => {
    expect(searchKeyDown(open(1), "Home", 4).state).toEqual(open(0));
    expect(searchKeyDown(open(1), "End", 4).state).toEqual(open(3));
  });

  it("selects the highlighted result on Enter, or the first when none is highlighted", () => {
    expect(searchKeyDown(open(2), "Enter", 3)).toEqual({ state: { open: false, active: -1 }, action: "select", index: 2 });
    expect(searchKeyDown(open(-1), "Enter", 3)).toMatchObject({ action: "select", index: 0 });
  });

  it("does nothing on Enter when closed or when there are no results", () => {
    expect(searchKeyDown(closed, "Enter", 3).action).toBeNull();
    expect(searchKeyDown(open(0), "Enter", 0).action).toBeNull();
  });

  it("closes on Escape", () => {
    expect(searchKeyDown(open(1), "Escape", 3)).toEqual({ state: closed, action: "close" });
  });

  it("ignores navigation keys with no results and other keys altogether", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) expect(searchKeyDown(open(0), key, 0).state).toEqual(open(0));
    expect(searchKeyDown(open(1), "a", 3)).toEqual({ state: open(1), action: null });
  });
});

describe("canSearch", () => {
  it("needs at least two characters after trimming", () => {
    expect(canSearch("a")).toBe(false);
    expect(canSearch("  a ")).toBe(false);
    expect(canSearch("ab")).toBe(true);
  });
});

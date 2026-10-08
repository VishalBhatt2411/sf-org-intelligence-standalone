import { describe, expect, it } from "vitest";
import { nodesInCycles } from "./cycles";

describe("nodesInCycles", () => {
  it("finds nothing in an acyclic graph", () => {
    expect(nodesInCycles(["a", "b", "c"], [["a", "b"], ["b", "c"]]).size).toBe(0);
  });

  it("finds every member of a cycle, and only them", () => {
    const found = nodesInCycles(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"]]);
    expect([...found].sort()).toEqual(["a", "b", "c"]);
  });

  it("counts a self-reference as a cycle", () => {
    expect([...nodesInCycles(["a", "b"], [["a", "a"], ["a", "b"]])]).toEqual(["a"]);
  });

  it("finds separate cycles and ignores edges leaving the node set", () => {
    const found = nodesInCycles(["a", "b", "x", "y"], [["a", "b"], ["b", "a"], ["x", "y"], ["y", "x"], ["a", "outside"], ["outside", "a"]]);
    expect([...found].sort()).toEqual(["a", "b", "x", "y"]);
  });

  it("survives a very long chain and a long ring without overflowing the stack", () => {
    const names = Array.from({ length: 50_000 }, (_, i) => `n${i}`);
    const chain = names.slice(1).map((n, i): [string, string] => [names[i], n]);
    expect(nodesInCycles(names, chain).size).toBe(0);
    expect(nodesInCycles(names, [...chain, [names[names.length - 1], names[0]]]).size).toBe(names.length);
  });
});

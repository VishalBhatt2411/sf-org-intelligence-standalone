// Strongly connected components (Tarjan, iterative so a deep dependency chain cannot overflow the stack).
// A node is "in a cycle" when its component has more than one member, or it points at itself.

export function nodesInCycles(nodes: string[], edges: Array<[string, string]>): Set<string> {
  const universe = new Set(nodes);
  const next = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const [from, to] of edges) {
    if (!universe.has(from) || !universe.has(to)) continue;
    if (from === to) selfLoops.add(from);
    (next.get(from) ?? next.set(from, []).get(from)!).push(to);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result = new Set<string>(selfLoops);
  let counter = 0;

  for (const root of universe) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; child: number }> = [{ node: root, child: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const children = next.get(frame.node) ?? [];
      if (frame.child < children.length) {
        const to = children[frame.child++];
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, child: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const members: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          members.push(member);
        } while (member !== frame.node);
        if (members.length > 1) members.forEach((m) => result.add(m));
      }
    }
  }
  return result;
}

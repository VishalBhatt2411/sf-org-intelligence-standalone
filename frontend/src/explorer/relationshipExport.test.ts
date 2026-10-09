import { describe, expect, it } from "vitest";
import { buildSvgExport } from "./relationshipExport";
import { computeDiagram } from "./relationshipLayout";
import { relationshipTokens } from "./relationshipTokens";
import type { ObjectConnector } from "./objectRelationshipView";

const connector = (label: string, direction: ObjectConnector["direction"], md = false): ObjectConnector => ({
  connectorKey: `${direction}::${label}`,
  counterpartObject: { nodeKey: label, label, fqn: label, isCustom: false },
  direction,
  fields: [{ fieldNodeKey: `f-${label}`, fieldFqn: `X.${label}Id`, fieldApiName: `${label}Id`, relationshipType: md ? "MasterDetail" : "Lookup", isSystemRelationship: false }],
  relationshipCount: 1,
  primaryRelationshipType: md ? "MasterDetail" : "Lookup",
  isSystemRelationship: false,
});

describe("buildSvgExport", () => {
  const d = computeDiagram({ incoming: [connector("Contact", "incoming")], outgoing: [connector("Owner & <Co>", "outgoing", true)], self: [connector("Account", "self")], showAllIncoming: false, showAllOutgoing: false, selectedConnectorKey: null });
  const svg = buildSvgExport(d, "Account", "Standard Object", relationshipTokens(false));

  it("is a standalone svg sized to the diagram", () => {
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`width="${d.canvasWidth}"`);
  });
  it("escapes markup in labels", () => {
    expect(svg).toContain("Owner &amp; &lt;Co&gt;");
    expect(svg).not.toContain("<Co>");
  });
  it("draws the centre, connectors and the self card", () => {
    expect(svg).toContain("ACCOUNT");
    expect(svg).toContain("Account (Self)");
    expect((svg.match(/<path /g) ?? []).length).toBe(4);
  });
});

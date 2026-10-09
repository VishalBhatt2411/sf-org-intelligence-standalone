import type { Diagram } from "./relationshipLayout";
import { CARD_HEIGHT, SELF_CARD_HEIGHT, SELF_CARD_WIDTH } from "./relationshipLayout";
import type { ObjectConnector } from "./objectRelationshipView";
import type { RelationshipTokens } from "./relationshipTokens";

// Standalone SVG export of the Object-mode diagram. Built from the computed layout rather than by
// serialising the live DOM: the on-screen cards are HTML inside foreignObject styled by the app's runtime
// stylesheet, which a saved file would lose. Native shapes keep the export portable and dependency-free.

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const strokeOf = (c: ObjectConnector, t: RelationshipTokens): string => (c.direction === "self" ? t.self : c.primaryRelationshipType === "MasterDetail" ? t.masterDetail : c.direction === "incoming" ? t.incoming : t.outgoing);

function card(x: number, y: number, w: number, h: number, title: string, subtitle: string, t: RelationshipTokens, dashed = false): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${dashed ? t.sunken : t.surface}" stroke="${t.border}"${dashed ? ' stroke-dasharray="5 4"' : ""}/>`,
    `<text x="${x + 14}" y="${y + h / 2 - 3}" font-size="13" font-weight="700" fill="${t.text}">${esc(clip(title, 26))}</text>`,
    `<text x="${x + 14}" y="${y + h / 2 + 14}" font-size="11" fill="${t.muted}">${esc(subtitle)}</text>`,
  ].join("");
}

export function buildSvgExport(diagram: Diagram, rootLabel: string, rootType: string, t: RelationshipTokens): string {
  const parts: string[] = [];
  const lane = (entries: Diagram["incoming"]) => {
    for (const e of entries) {
      const stroke = strokeOf(e.connector, t);
      const width = e.connector.primaryRelationshipType === "MasterDetail" ? 3 : 1.5;
      parts.push(`<path d="${e.path}" fill="none" stroke="${stroke}" stroke-width="${width}"${e.connector.isSystemRelationship ? ' stroke-dasharray="5 4"' : ""}/>`);
      parts.push(`<text x="${e.labelX}" y="${e.labelY + 18}" font-size="12" font-weight="600" fill="${stroke}">${esc(e.label)}</text>`);
      parts.push(card(e.x, e.y, e.width, e.height, e.connector.counterpartObject.label, e.connector.counterpartObject.isCustom ? "Custom Object" : "Standard Object", t));
    }
  };
  lane(diagram.incoming);
  lane(diagram.outgoing);
  for (const m of [diagram.incomingShowMore, diagram.outgoingShowMore]) {
    if (m) parts.push(`<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${CARD_HEIGHT}" rx="8" fill="none" stroke="${t.accent}" stroke-dasharray="5 4"/><text x="${m.x + m.width / 2}" y="${m.y + CARD_HEIGHT / 2 + 4}" text-anchor="middle" font-size="13" font-weight="600" fill="${t.accent}">${esc(m.label)}</text>`);
  }
  for (const s of diagram.self) {
    const stroke = t.self;
    parts.push(`<path d="${s.downPath}" fill="none" stroke="${stroke}" stroke-width="1.5"/><path d="${s.upPath}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`);
    parts.push(card(s.cardX, s.cardY, SELF_CARD_WIDTH, SELF_CARD_HEIGHT, `${rootLabel} (Self)`, s.label, t, true));
  }
  const c = diagram.centerBox;
  parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="10" fill="${t.surface}" stroke="${t.object}" stroke-width="2"/>`);
  parts.push(`<text x="${c.x + c.width / 2}" y="${c.y + c.height / 2 - 4}" text-anchor="middle" font-size="14" font-weight="700" fill="${t.text}">${esc(rootLabel.toUpperCase())}</text>`);
  parts.push(`<text x="${c.x + c.width / 2}" y="${c.y + c.height / 2 + 14}" text-anchor="middle" font-size="11" fill="${t.muted}">${esc(rootType)}</text>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${diagram.canvasWidth}" height="${diagram.canvasHeight}" viewBox="0 0 ${diagram.canvasWidth} ${diagram.canvasHeight}" font-family="Roboto, 'Helvetica Neue', Arial, sans-serif"><rect width="100%" height="100%" fill="${t.sunken}"/>${parts.join("")}</svg>`;
}

import { DEFAULT_VISIBLE_PER_LANE, type ObjectConnector } from "./objectRelationshipView";

// Deterministic geometry for Object mode's directional-lane canvas. Port of the native oiRelationshipCanvas
// layout: counterparts that reference the centre sit on the left, the centre is fixed in the middle,
// counterparts the centre references sit on the right, and self-relationships hang below the centre. Each lane
// shares one vertical "trunk" so any number of connectors stay orthogonal and non-crossing. No force pass, so
// the same input always yields the same picture. Pure functions: no DOM, no React.

export const CARD_WIDTH = 236;
export const CARD_HEIGHT = 80;
export const CENTER_WIDTH = 210;
export const CENTER_HEIGHT = 196;

// The "Explore From Here" button renders in the gap below the selected card, so every row reserves that gap
// whether or not it is selected. Nothing may reflow when the selection changes.
export const EXPLORE_ACTION_GAP = 6;
export const EXPLORE_ACTION_HEIGHT = 24;
const EXPLORE_ACTION_MARGIN = 8;
const ROW_GAP = EXPLORE_ACTION_GAP + EXPLORE_ACTION_HEIGHT + EXPLORE_ACTION_MARGIN;
const ROW_HEIGHT = CARD_HEIGHT + ROW_GAP;
const MARGIN_X = 24;
const TOP_MARGIN = 30;

export const LABEL_SLOT_HEIGHT = 28;
export const SELF_CARD_WIDTH = 190;
export const SELF_CARD_HEIGHT = 62;
const SELF_CAPTION_TOP_GAP = 4;
export const SELF_CAPTION_HEIGHT = 40;
const SELF_CAPTION_CARD_GAP = 10;
const SELF_CARD_LABEL_GAP = 10;
const SELF_ENTRY_GAP = 22;
const SELF_ENTRY_HEIGHT = SELF_CAPTION_TOP_GAP + SELF_CAPTION_HEIGHT + SELF_CAPTION_CARD_GAP + SELF_CARD_HEIGHT + SELF_CARD_LABEL_GAP + LABEL_SLOT_HEIGHT + SELF_ENTRY_GAP;

// The card-to-trunk segment is sized to the lane's widest label so a label never spills across the trunk.
const LABEL_SEGMENT_MIN = 75;
const LABEL_SEGMENT_MAX = 260;
const LABEL_H_PADDING = 28;
const FINAL_SEGMENT = 75;
const CONNECTOR_CORNER_RADIUS = 14;
// A generous per-character estimate for the 12px semibold label. Not measured from the DOM so layout stays
// deterministic in tests and in browsers with different fonts; CSS ellipsis is the final safety net.
const CHAR_WIDTH = 7;

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 0.1;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const relationshipTypeLabel = (c: ObjectConnector): string => (c.primaryRelationshipType === "MasterDetail" ? "Master-Detail" : "Lookup");

// One field reads as "AccountId · Lookup"; several read as "3 Lookup Relationships" rather than a cryptic "+2".
export function connectorLabelText(c: ObjectConnector): string {
  const type = relationshipTypeLabel(c);
  if (c.fields.length > 0 && c.fields[0].fieldApiName) {
    return c.relationshipCount > 1 ? `${c.relationshipCount} ${type} Relationships` : `${c.fields[0].fieldApiName} · ${type}`;
  }
  return c.relationshipCount > 1 ? `${c.relationshipCount} ${type}` : type;
}

function labelSegment(connectors: readonly ObjectConnector[]): number {
  let widest = 0;
  for (const c of connectors) widest = Math.max(widest, connectorLabelText(c).length * CHAR_WIDTH);
  return clamp(widest + LABEL_H_PADDING, LABEL_SEGMENT_MIN, LABEL_SEGMENT_MAX);
}

// One orthogonal path with rounded corners: card row -> shared trunk -> centre row. Rows that share a trunk
// overlap pixel for pixel, so they read as one merged trunk line. The corner radius is clamped to the shorter
// adjacent segment so tight spacing can never produce a self-intersecting curve.
export function buildElbowPath(startX: number, startY: number, trunkX: number, endX: number, endY: number, radius = CONNECTOR_CORNER_RADIUS): string {
  if (startY === endY) return `M ${startX} ${startY} H ${endX}`;
  const hIn = Math.abs(trunkX - startX);
  const hOut = Math.abs(endX - trunkX);
  const vRun = Math.abs(endY - startY);
  const r = Math.min(radius, hIn, hOut, vRun / 2);
  const hInSign = Math.sign(trunkX - startX);
  const vSign = Math.sign(endY - startY);
  const hOutSign = Math.sign(endX - trunkX);
  const corner1X = trunkX - r * hInSign;
  const corner1Y = startY + r * vSign;
  const corner2Y = endY - r * vSign;
  const corner2X = trunkX + r * hOutSign;
  return `M ${startX} ${startY} H ${corner1X} Q ${trunkX} ${startY} ${trunkX} ${corner1Y} V ${corner2Y} Q ${trunkX} ${endY} ${corner2X} ${endY} H ${endX}`;
}

export type LaneEntry = {
  connector: ObjectConnector;
  rowKey: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  path: string;
  labelX: number;
  labelY: number;
};

export type SelfEntry = {
  connector: ObjectConnector;
  rowKey: string;
  label: string;
  captionX: number;
  captionY: number;
  captionWidth: number;
  cardX: number;
  cardY: number;
  downPath: string;
  upPath: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
};

export type ShowMoreEntry = { x: number; y: number; width: number; height: number; label: string };

export type Diagram = {
  canvasWidth: number;
  canvasHeight: number;
  centerBox: { x: number; y: number; width: number; height: number };
  incoming: LaneEntry[];
  outgoing: LaneEntry[];
  incomingShowMore: ShowMoreEntry | null;
  outgoingShowMore: ShowMoreEntry | null;
  self: SelfEntry[];
  explore: { x: number; y: number; width: number; height: number; nodeKey: string } | null;
};

export type DiagramInput = {
  incoming: readonly ObjectConnector[];
  outgoing: readonly ObjectConnector[];
  self: readonly ObjectConnector[];
  showAllIncoming: boolean;
  showAllOutgoing: boolean;
  selectedConnectorKey: string | null;
};

const laneRowCenterY = (index: number, slots: number, bodyHeight: number): number => {
  const contentHeight = slots * ROW_HEIGHT - ROW_GAP;
  const offset = TOP_MARGIN + (bodyHeight - contentHeight) / 2;
  return offset + index * ROW_HEIGHT + CARD_HEIGHT / 2;
};

const remaining = (total: number): number => Math.max(0, total - DEFAULT_VISIBLE_PER_LANE);

export function computeDiagram(input: DiagramInput): Diagram {
  const incoming = input.showAllIncoming ? input.incoming.slice() : input.incoming.slice(0, DEFAULT_VISIBLE_PER_LANE);
  const outgoing = input.showAllOutgoing ? input.outgoing.slice() : input.outgoing.slice(0, DEFAULT_VISIBLE_PER_LANE);
  const incomingMore = !input.showAllIncoming ? remaining(input.incoming.length) : 0;
  const outgoingMore = !input.showAllOutgoing ? remaining(input.outgoing.length) : 0;
  // A lane with a hidden remainder reserves one extra row for its own "Show N more" button.
  const incomingSlots = incoming.length + (incomingMore > 0 ? 1 : 0);
  const outgoingSlots = outgoing.length + (outgoingMore > 0 ? 1 : 0);
  const rowCount = Math.max(incomingSlots, outgoingSlots, 1);
  const bodyHeight = Math.max(rowCount * ROW_HEIGHT - ROW_GAP, CENTER_HEIGHT);
  const diagramHeight = TOP_MARGIN * 2 + bodyHeight;
  const centerY = TOP_MARGIN + bodyHeight / 2;

  const incomingSegment = labelSegment(incoming);
  const outgoingSegment = labelSegment(outgoing);
  const canvasWidth = MARGIN_X * 2 + CARD_WIDTH * 2 + incomingSegment + outgoingSegment + FINAL_SEGMENT * 2 + CENTER_WIDTH;
  const centerX = MARGIN_X + CARD_WIDTH + incomingSegment + FINAL_SEGMENT;
  const incomingCardX = MARGIN_X;
  const outgoingCardX = canvasWidth - MARGIN_X - CARD_WIDTH;
  const incomingTrunkX = incomingCardX + CARD_WIDTH + incomingSegment;
  const outgoingTrunkX = outgoingCardX - outgoingSegment;
  const centerRightX = centerX + CENTER_WIDTH;
  const centerBottomY = centerY + CENTER_HEIGHT / 2;

  const selfHeight = input.self.length > 0 ? input.self.length * SELF_ENTRY_HEIGHT + 20 : 0;

  const incomingEntries: LaneEntry[] = incoming.map((connector, index) => {
    const rowY = laneRowCenterY(index, incomingSlots, bodyHeight);
    return {
      connector,
      rowKey: `incoming-${index}-${connector.connectorKey}`,
      label: connectorLabelText(connector),
      x: incomingCardX,
      y: rowY - CARD_HEIGHT / 2,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      path: buildElbowPath(incomingCardX + CARD_WIDTH, rowY, incomingTrunkX, centerX, centerY),
      labelX: incomingCardX + CARD_WIDTH + 8,
      labelY: rowY - LABEL_SLOT_HEIGHT / 2,
    };
  });
  const outgoingEntries: LaneEntry[] = outgoing.map((connector, index) => {
    const rowY = laneRowCenterY(index, outgoingSlots, bodyHeight);
    return {
      connector,
      rowKey: `outgoing-${index}-${connector.connectorKey}`,
      label: connectorLabelText(connector),
      x: outgoingCardX,
      y: rowY - CARD_HEIGHT / 2,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      path: buildElbowPath(centerRightX, centerY, outgoingTrunkX, outgoingCardX, rowY),
      labelX: outgoingTrunkX + 8,
      labelY: rowY - LABEL_SLOT_HEIGHT / 2,
    };
  });

  const showMore = (rowY: number, cardX: number, count: number): ShowMoreEntry => ({ x: cardX, y: rowY - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT, label: `+ Show ${count} more` });

  // A self-relationship is a small "(Self)" card below the centre, joined by a rounded down-and-back loop.
  const selfEntries: SelfEntry[] = input.self.map((connector, index) => {
    const entryTop = diagramHeight + index * SELF_ENTRY_HEIGHT;
    const captionY = entryTop + SELF_CAPTION_TOP_GAP;
    const cardY = captionY + SELF_CAPTION_HEIGHT + SELF_CAPTION_CARD_GAP;
    const cardX = centerX + (CENTER_WIDTH - SELF_CARD_WIDTH) / 2;
    const leftX = centerX + CENTER_WIDTH * 0.32;
    const rightX = centerX + CENTER_WIDTH * 0.68;
    const cardLeftX = cardX + SELF_CARD_WIDTH * 0.3;
    const cardRightX = cardX + SELF_CARD_WIDTH * 0.7;
    const midY = (centerBottomY + cardY) / 2;
    const captionWidth = 260;
    return {
      connector,
      rowKey: `self-${index}-${connector.connectorKey}`,
      label: connectorLabelText(connector),
      captionX: centerX + CENTER_WIDTH / 2 - captionWidth / 2,
      captionY,
      captionWidth,
      cardX,
      cardY,
      downPath: `M ${leftX} ${centerBottomY} Q ${leftX} ${midY} ${cardLeftX} ${cardY}`,
      upPath: `M ${cardRightX} ${cardY} Q ${rightX} ${midY} ${rightX} ${centerBottomY}`,
      labelX: cardX,
      labelY: cardY + SELF_CARD_HEIGHT + SELF_CARD_LABEL_GAP,
      labelWidth: SELF_CARD_WIDTH,
    };
  });

  const active = [...incomingEntries, ...outgoingEntries].find((e) => e.connector.connectorKey === input.selectedConnectorKey) ?? null;

  return {
    canvasWidth,
    canvasHeight: diagramHeight + selfHeight,
    centerBox: { x: centerX, y: centerY - CENTER_HEIGHT / 2, width: CENTER_WIDTH, height: CENTER_HEIGHT },
    incoming: incomingEntries,
    outgoing: outgoingEntries,
    incomingShowMore: incomingMore > 0 ? showMore(laneRowCenterY(incoming.length, incomingSlots, bodyHeight), incomingCardX, incomingMore) : null,
    outgoingShowMore: outgoingMore > 0 ? showMore(laneRowCenterY(outgoing.length, outgoingSlots, bodyHeight), outgoingCardX, outgoingMore) : null,
    self: selfEntries,
    explore: active ? { x: active.x, y: active.y + active.height + EXPLORE_ACTION_GAP, width: active.width, height: EXPLORE_ACTION_HEIGHT, nodeKey: active.connector.counterpartObject.nodeKey } : null,
  };
}

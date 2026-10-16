import { useState } from "react";
import { Alert, Box, Dialog, DialogContent, IconButton, Link, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";
import type { ConnectorField, ObjectConnector, ObjectRef } from "./objectRelationshipView";
import { relationshipTypeLabel } from "./relationshipLayout";
import type { OpenResult } from "./openInSalesforce";

// One aggregated relationship's own detail (port of native oiRelationshipConnectorDetail): source, type,
// target, direction and the individual fields. Renders the connector the canvas already holds, so there is
// no extra fetch. The "open" actions are optional callbacks: the native app navigates to Setup, the
// standalone opens Salesforce in a new tab when the connection has an instance URL, and otherwise the names
// render as plain text.

type Props = {
  connector: ObjectConnector;
  root: ObjectRef;
  onClose: () => void;
  // May resolve to a failure, which is shown inline instead of a link that silently does nothing.
  onOpenObject?: (object: ObjectRef) => void | Promise<OpenResult | void>;
  onOpenField?: (field: ConnectorField) => void | Promise<OpenResult | void>;
};

export function ConnectorDetailDialog({ connector, root, onClose, onOpenObject, onOpenField }: Props) {
  const source = connector.direction === "incoming" ? connector.counterpartObject : root;
  const target = connector.direction === "incoming" ? root : connector.counterpartObject;
  const type = relationshipTypeLabel(connector);
  const direction = `${source.label} → ${target.label}`;
  const [openError, setOpenError] = useState<string | null>(null);
  const run = async (action: () => void | Promise<OpenResult | void>) => {
    const r = await action();
    setOpenError(r && !r.ok ? r.error : null);
  };
  const plural = connector.fields.length === 1 ? "" : "s";

  const objectLink = (o: ObjectRef) =>
    onOpenObject ? (
      <Link component="button" type="button" underline="hover" onClick={() => void run(() => onOpenObject(o))} sx={{ font: "inherit", fontWeight: 600 }}>
        {o.label}
      </Link>
    ) : (
      <Typography component="span" fontWeight={600}>
        {o.label}
      </Typography>
    );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="connector-detail-heading">
      <Box sx={{ bgcolor: "primary.main", color: "primary.contrastText", px: 3, py: 2, position: "relative" }}>
        <IconButton aria-label="Close" onClick={onClose} size="small" sx={{ position: "absolute", top: 8, right: 8, color: "inherit" }}>
          <Close fontSize="small" />
        </IconButton>
        <Typography id="connector-detail-heading" variant="h6" component="h2" sx={{ pr: 4 }}>
          {direction}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85 }}>
          {type} Relationship
        </Typography>
      </Box>
      <DialogContent>
        {openError && (
          <Alert severity="error" role="alert" onClose={() => setOpenError(null)} sx={{ mb: 2 }}>
            {openError}
          </Alert>
        )}
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 3, rowGap: 1.25, "& dt": { color: "text.secondary", fontSize: 13 }, "& dd": { m: 0, fontSize: 14 } }}>
          <dt>Source Object</dt>
          <dd>{objectLink(source)}</dd>
          <dt>Relationship Type</dt>
          <dd>{type}</dd>
          <dt>Target Object</dt>
          <dd>{objectLink(target)}</dd>
          <dt>Direction</dt>
          <dd>{direction}</dd>
        </Box>
        {connector.fields.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="overline" color="text.secondary">
              Field{plural}
            </Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: "none", display: "grid", gap: 0.75 }}>
              {connector.fields.map((f) => (
                <Box component="li" key={f.fieldNodeKey} sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  {onOpenField ? (
                    <Link component="button" type="button" underline="hover" onClick={() => void run(() => onOpenField(f))} sx={{ font: "inherit" }}>
                      {f.fieldApiName ?? f.fieldFqn}
                    </Link>
                  ) : (
                    <Typography component="span" variant="body2">
                      {f.fieldApiName ?? f.fieldFqn}
                    </Typography>
                  )}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {f.relationshipType}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { IconButton, Tooltip, CircularProgress } from "@mui/material";
import { api } from "../api/client";
import { useToast } from "../toast";

// Types that don't map to a specific Salesforce Setup page (org-wide findings, etc.)
const UNLINKABLE_TYPES = new Set(["Organization"]);

function OpenInNewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
    </svg>
  );
}

export function OpenInSalesforceButton({
  scanId,
  type,
  name,
}: {
  scanId: string;
  type: string;
  name: string;
}) {
  const [loading, setLoading] = useState(false);
  const notify = useToast();

  if (UNLINKABLE_TYPES.has(type)) return null;

  async function open(e: React.MouseEvent) {
    e.stopPropagation();
    // Open the tab synchronously in the click handler so browsers don't treat the
    // later navigation (after the async lookup below) as a blocked popup.
    const tab = window.open("", "_blank");
    setLoading(true);
    try {
      const { data } = await api.get<{ url: string | null }>(`/scans/${scanId}/setup-link`, {
        params: { type, name },
      });
      if (data.url && tab) {
        tab.location.href = data.url;
      } else {
        tab?.close();
        notify("Couldn't find this component in the org (it may have been removed since the scan)", "error");
      }
    } catch {
      tab?.close();
      notify("Couldn't open Salesforce Setup for this component", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Tooltip title="Open in Salesforce">
      <span>
        <IconButton size="small" onClick={open} disabled={loading}>
          {loading ? <CircularProgress size={16} /> : <OpenInNewIcon />}
        </IconButton>
      </span>
    </Tooltip>
  );
}

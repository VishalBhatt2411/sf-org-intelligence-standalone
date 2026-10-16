import { metadataSetupTarget, type MetadataNodeRef } from "./salesforceLinks";

// "Open in Salesforce" / "Open in Setup" without requiring the instance URL up front (native resolves it
// on the server per click). The page may not hold the URL yet, so it is resolved on demand, and any failure
// comes back as a message the caller shows inline instead of a link that silently does nothing.

export type OpenResult = { ok: true; caveat?: string } | { ok: false; error: string };

export type OpenDeps = {
  instanceUrl: string | null;
  resolveInstanceUrl: () => Promise<string | null>;
  open?: (url: string) => void;
};

const defaultOpen = (url: string) => {
  window.open(url, "_blank", "noopener");
};

export const NO_INSTANCE_URL = "Couldn't work out this org's Salesforce address, so the page can't be opened.";

export async function openSetupFor(node: MetadataNodeRef, deps: OpenDeps): Promise<OpenResult> {
  let base = deps.instanceUrl;
  if (!base) {
    try {
      base = await deps.resolveInstanceUrl();
    } catch {
      base = null;
    }
  }
  if (!base) return { ok: false, error: NO_INSTANCE_URL };
  const target = metadataSetupTarget(base, node);
  if (target.url === null) return { ok: false, error: target.reason };
  try {
    (deps.open ?? defaultOpen)(target.url);
  } catch {
    return { ok: false, error: "Couldn't open Salesforce in a new tab." };
  }
  return target.caveat ? { ok: true, caveat: target.caveat } : { ok: true };
}

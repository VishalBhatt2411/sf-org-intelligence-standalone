import axios from "axios";

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL, withCredentials: true });

export type Session = { connectionId: string; organizationId: string };

export type FindingStatus = "open" | "acknowledged" | "resolved" | "wont_fix";

export type Finding = {
  id: string;
  category: string;
  ruleKey: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  componentType: string;
  componentName: string;
  status: FindingStatus;
  assignedTo: string | null;
};

export type ScanDiff = {
  previousScanId: string | null;
  newFindings: Finding[];
  resolvedFindings: Finding[];
};

export type ScheduleFrequency = "off" | "daily" | "weekly" | "monthly";

export type OrgInfo = {
  name: string | null;
  edition: string | null;
  advancedDetailsUrl: string;
};

export type HealthScore = {
  overall: number;
  categoryScores: Record<string, number>;
  totalFindings: number;
};

export type Scan = {
  id: string;
  connectionId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
};


export type UsageRef = { type: string; name: string };

export type AccessGrant = { name: string; type: "Profile" | "PermissionSet"; level: string };

export type ComponentUsage = {
  objects: {
    apiName: string;
    label: string;
    usedIn: UsageRef[];
    references: UsageRef[];
    access: AccessGrant[];
    fields: { apiName: string; type: string; usedIn: UsageRef[]; references: UsageRef[]; access: AccessGrant[] }[];
  }[];
  classes: { name: string; usedIn: UsageRef[]; references: UsageRef[]; isBatch: boolean; category: string }[];
  triggers: { name: string; usedIn: UsageRef[]; references: UsageRef[] }[];
  flows: { apiName: string; label: string; status: string; category: string; usedIn: UsageRef[]; references: UsageRef[] }[];
  workflowRules: {
    name: string;
    objectName: string;
    active: boolean;
    triggerType: string | null;
    usedIn: UsageRef[];
    references: UsageRef[];
  }[];
  lwc: { apiName: string; usedIn: UsageRef[]; references: UsageRef[] }[];
  visualforcePages: { name: string; usedIn: UsageRef[]; references: UsageRef[] }[];
  visualforceComponents: { name: string; usedIn: UsageRef[]; references: UsageRef[] }[];
  emailTemplates: { name: string; developerName: string; templateType: string; isActive: boolean }[];
  installedPackages: { name: string; namespacePrefix: string; versionName: string | null; versionNumber: string | null }[];
};

export type HealthHistoryPoint = { scanId: string; startedAt: string; overall: number };

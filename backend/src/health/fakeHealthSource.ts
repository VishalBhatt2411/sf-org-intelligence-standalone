import type { BroadGrant, HealthSource, LimitValue, ObjectProfile, SecuritySet, SensitiveGrant } from "./healthSource";

// Test double for HealthSource: hand it the data a section should see, and name the reads that should fail.
// Nothing in production imports this.

export type FakeData = {
  sets?: SecuritySet[];
  setsTruncated?: boolean;
  broad?: BroadGrant[];
  sensitive?: SensitiveGrant[];
  sensitiveTruncated?: boolean;
  assignments?: Record<string, number>;
  profiles?: Record<string, ObjectProfile>;
  limits?: Record<string, LimitValue>;
  // Methods (or "objectProfile:Account") that should throw.
  failing?: string[];
};

export class FakeHealthSource implements HealthSource {
  calls: string[] = [];
  constructor(private data: FakeData = {}) {}

  private check(name: string, detail?: string) {
    this.calls.push(detail ? `${name}:${detail}` : name);
    if (this.data.failing?.some((f) => f === name || (detail && f === `${name}:${detail}`))) throw new Error(`${detail ?? name} is not available`);
  }

  async securitySets() {
    this.check("securitySets");
    return { sets: this.data.sets ?? [], truncated: this.data.setsTruncated ?? false };
  }
  async broadGrants() {
    this.check("broadGrants");
    return this.data.broad ?? [];
  }
  async sensitiveGrants(objects: string[]) {
    this.check("sensitiveGrants");
    return { grants: (this.data.sensitive ?? []).filter((g) => objects.includes(g.object)), truncated: this.data.sensitiveTruncated ?? false };
  }
  async assignmentCounts() {
    this.check("assignmentCounts");
    return new Map(Object.entries(this.data.assignments ?? {}));
  }
  async objectProfile(object: string): Promise<ObjectProfile> {
    this.check("objectProfile", object);
    const p = this.data.profiles?.[object];
    if (!p) throw new Error(`${object} is not queryable`);
    return p;
  }
  async limits() {
    this.check("limits");
    return this.data.limits ?? {};
  }
}

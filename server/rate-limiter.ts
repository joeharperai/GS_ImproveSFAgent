/**
 * GS_ImproveSFAgent — Salesforce API Rate Limiter
 *
 * Tracks API calls per org to avoid hitting Salesforce daily API limits.
 * Salesforce limits: Enterprise = 100,000/day, Unlimited = 100,000/day, Developer = 15,000/day
 */

export interface OrgApiUsage {
  orgId: number;
  callsToday: number;
  lastReset: string; // ISO date (YYYY-MM-DD)
  dailyLimit: number;
  sfReportedUsed?: number;
  sfReportedTotal?: number;
}

const orgUsage = new Map<number, OrgApiUsage>();

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function ensureEntry(orgId: number): OrgApiUsage {
  const today = getToday();
  let usage = orgUsage.get(orgId);
  if (!usage || usage.lastReset !== today) {
    usage = {
      orgId,
      callsToday: 0,
      lastReset: today,
      dailyLimit: usage?.dailyLimit || 100000, // default to Enterprise
    };
    orgUsage.set(orgId, usage);
  }
  return usage;
}

export function trackApiCall(orgId: number): void {
  const usage = ensureEntry(orgId);
  usage.callsToday++;
}

export function canMakeApiCall(orgId: number): boolean {
  const usage = ensureEntry(orgId);
  return usage.callsToday < usage.dailyLimit;
}

export function isApproachingLimit(orgId: number): boolean {
  const usage = ensureEntry(orgId);
  return usage.callsToday >= usage.dailyLimit * 0.8;
}

export function getApiUsage(orgId: number): OrgApiUsage {
  return ensureEntry(orgId);
}

export function setDailyLimit(orgId: number, limit: number): void {
  const usage = ensureEntry(orgId);
  usage.dailyLimit = limit;
}

/**
 * Auto-detect daily limit from Salesforce org edition.
 * Call this after edition detection during discovery.
 */
export function setLimitFromEdition(orgId: number, edition: string): void {
  const edLower = edition.toLowerCase();
  let limit = 100000; // default Enterprise/Unlimited

  if (edLower.includes("developer")) {
    limit = 15000;
  } else if (edLower.includes("professional")) {
    limit = 5000;
  } else if (edLower.includes("group") || edLower.includes("essentials")) {
    limit = 1000;
  }

  setDailyLimit(orgId, limit);
}

/**
 * Parse the Sforce-Limit-Info response header from Salesforce API calls.
 * Format: "api-usage=35/100000"
 */
export function parseSforceLimitHeader(orgId: number, headerValue: string): void {
  const match = headerValue.match(/api-usage=(\d+)\/(\d+)/);
  if (match) {
    const used = parseInt(match[1]);
    const total = parseInt(match[2]);
    const usage = ensureEntry(orgId);
    usage.sfReportedUsed = used;
    usage.sfReportedTotal = total;
    // Update daily limit from SF's actual value
    if (total > 0) {
      usage.dailyLimit = total;
    }
    // Sync our tracked count with SF's reported count (SF is authoritative)
    usage.callsToday = used;
  }
}

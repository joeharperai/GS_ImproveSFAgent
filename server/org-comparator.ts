/**
 * GS_ImproveSFAgent — Multi-Org Comparison
 *
 * Compares metadata inventory between two connected orgs.
 * Uses existing orgInventory data — no additional Salesforce API calls.
 */

import { storage } from "./storage";

export interface OrgComparisonResult {
  onlyInSource: { apiName: string; type: string; label: string }[];
  onlyInTarget: { apiName: string; type: string; label: string }[];
  inBoth: { apiName: string; type: string; label: string; sourceModified?: string; targetModified?: string }[];
  summary: { sourceTotal: number; targetTotal: number; onlySource: number; onlyTarget: number; shared: number };
}

export function compareOrgs(sourceOrgId: number, targetOrgId: number): OrgComparisonResult {
  const sourceItems = storage.getOrgInventory(sourceOrgId);
  const targetItems = storage.getOrgInventory(targetOrgId);

  // Build lookup maps using category+apiName as key
  const sourceMap = new Map<string, typeof sourceItems[number]>();
  for (const item of sourceItems) {
    sourceMap.set(`${item.category}::${item.apiName}`, item);
  }

  const targetMap = new Map<string, typeof targetItems[number]>();
  for (const item of targetItems) {
    targetMap.set(`${item.category}::${item.apiName}`, item);
  }

  const onlyInSource: OrgComparisonResult["onlyInSource"] = [];
  const onlyInTarget: OrgComparisonResult["onlyInTarget"] = [];
  const inBoth: OrgComparisonResult["inBoth"] = [];

  // Check source items against target
  for (const [key, item] of sourceMap) {
    const targetItem = targetMap.get(key);
    if (targetItem) {
      inBoth.push({
        apiName: item.apiName,
        type: item.category,
        label: item.label,
        sourceModified: item.discoveredAt,
        targetModified: targetItem.discoveredAt,
      });
    } else {
      onlyInSource.push({
        apiName: item.apiName,
        type: item.category,
        label: item.label,
      });
    }
  }

  // Check target items not in source
  for (const [key, item] of targetMap) {
    if (!sourceMap.has(key)) {
      onlyInTarget.push({
        apiName: item.apiName,
        type: item.category,
        label: item.label,
      });
    }
  }

  return {
    onlyInSource,
    onlyInTarget,
    inBoth,
    summary: {
      sourceTotal: sourceItems.length,
      targetTotal: targetItems.length,
      onlySource: onlyInSource.length,
      onlyTarget: onlyInTarget.length,
      shared: inBoth.length,
    },
  };
}

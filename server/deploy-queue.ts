/**
 * GS_ImproveSFAgent — Deployment Queue
 *
 * Salesforce allows only one deployment per org at a time.
 * This module queues deployments and processes them serially per org.
 */

import { storage } from "./storage";
import { deployToOrg } from "./metadata-deployer";
import type { DeployQueueItem } from "@shared/schema";

export function enqueueDeployment(
  orgId: number,
  requirementId: number | null,
  componentIds: number[],
  options?: { checkOnly?: boolean; priority?: number }
): DeployQueueItem {
  const item = storage.createDeployQueueItem({
    orgId,
    requirementId: requirementId || undefined,
    status: "queued",
    priority: options?.priority || 0,
    payload: JSON.stringify({ componentIds, options: { checkOnly: options?.checkOnly || false } }),
    createdAt: new Date().toISOString(),
  });

  // Trigger queue processing asynchronously
  setTimeout(() => processQueue(orgId), 0);

  return item;
}

export async function processQueue(orgId: number): Promise<void> {
  // Check if there's already a running deploy for this org
  const running = storage.getRunningDeploy(orgId);
  if (running) return; // Another deploy is in progress

  // Get next queued item
  const next = storage.getNextQueuedDeploy(orgId);
  if (!next) return; // Nothing queued

  const org = storage.getOrg(orgId);
  if (!org || !org.accessToken) {
    storage.updateDeployQueueItem(next.id, {
      status: "failed",
      result: JSON.stringify({ error: "Org not connected" }),
      completedAt: new Date().toISOString(),
    });
    // Try next in queue
    setTimeout(() => processQueue(orgId), 0);
    return;
  }

  // Mark as running
  storage.updateDeployQueueItem(next.id, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  try {
    const payload = JSON.parse(next.payload);
    const componentIds: number[] = payload.componentIds || [];
    const deployOptions = payload.options || {};

    // Load components
    const components = componentIds
      .map(id => storage.getComponent(id))
      .filter(Boolean) as any[];

    if (components.length === 0) {
      storage.updateDeployQueueItem(next.id, {
        status: "failed",
        result: JSON.stringify({ error: "No valid components found" }),
        completedAt: new Date().toISOString(),
      });
      setTimeout(() => processQueue(orgId), 0);
      return;
    }

    const result = await deployToOrg(org, components, undefined, deployOptions);

    storage.updateDeployQueueItem(next.id, {
      status: result.success ? "completed" : "failed",
      result: JSON.stringify(result),
      completedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    storage.updateDeployQueueItem(next.id, {
      status: "failed",
      result: JSON.stringify({ error: e.message }),
      completedAt: new Date().toISOString(),
    });
  }

  // Process next in queue
  setTimeout(() => processQueue(orgId), 0);
}

export function getQueueStatus(orgId: number): DeployQueueItem[] {
  return storage.getDeployQueue(orgId);
}

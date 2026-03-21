/**
 * GS_ImproveSFAgent — Deployment Scheduler
 *
 * Checks every 60 seconds for scheduled deploys that are due,
 * then executes them via the existing agent run flow.
 */

import { storage } from "./storage";
import { executeAgentRun } from "./agent-engine";
import type { AgentStep } from "@shared/schema";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (schedulerInterval) return; // Already running

  schedulerInterval = setInterval(async () => {
    try {
      await checkAndExecuteScheduledDeploys();
    } catch (err: any) {
      console.error("Scheduler error:", err.message);
    }
  }, 60_000); // Every 60 seconds

  console.log("[Scheduler] Started — checking for due deployments every 60s");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Stopped");
  }
}

async function checkAndExecuteScheduledDeploys(): Promise<void> {
  const pending = storage.getPendingScheduledDeploys();
  if (pending.length === 0) return;

  for (const sd of pending) {
    console.log(`[Scheduler] Executing scheduled deploy #${sd.id} for requirement #${sd.requirementId}`);

    // Mark as deploying
    storage.updateScheduledDeploy(sd.id, { status: "deploying" } as any);

    const requirement = storage.getRequirement(sd.requirementId);
    if (!requirement) {
      storage.updateScheduledDeploy(sd.id, { status: "failed" } as any);
      continue;
    }

    try {
      // Create an agent run for this scheduled deploy
      const run = storage.createAgentRun({
        requirementId: sd.requirementId,
        orgId: sd.orgId,
        status: "pending",
        phase: "init",
        stepsJson: "[]",
        retryCount: 0,
        maxRetries: 3,
        startedAt: new Date().toISOString(),
      });

      // Execute the agent run (fire-and-forget)
      executeAgentRun(run.id, sd.requirementId, sd.orgId, (_step: AgentStep) => {
        // No SSE clients for scheduled deploys — steps are still logged in the run
      }).then(() => {
        const completedRun = storage.getAgentRun(run.id);
        storage.updateScheduledDeploy(sd.id, {
          status: completedRun?.status === "success" ? "completed" : "failed",
          deploymentId: run.id,
        } as any);
      }).catch(() => {
        storage.updateScheduledDeploy(sd.id, { status: "failed" } as any);
      });
    } catch {
      storage.updateScheduledDeploy(sd.id, { status: "failed" } as any);
    }
  }
}

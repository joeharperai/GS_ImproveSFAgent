/**
 * GS_ImproveSFAgent — Webhook Notification Service
 *
 * Sends notifications when key events occur (deploys, health assessments, scans).
 * Supports Slack, Teams, and generic JSON webhooks.
 * Fire-and-forget: webhook failures are logged but never throw.
 */

import { storage } from "./storage";

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, any>;
}

export async function fireWebhook(event: string, data: Record<string, any>): Promise<void> {
  const hooks = storage.getActiveWebhooksForEvent(event);
  if (hooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const hook of hooks) {
    try {
      let body: string;
      let contentType = "application/json";

      switch (hook.type) {
        case "slack":
          body = JSON.stringify(formatSlackMessage(event, data));
          break;
        case "teams":
          body = JSON.stringify(formatTeamsMessage(event, data));
          break;
        default:
          body = JSON.stringify(payload);
          break;
      }

      await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    } catch (err: any) {
      console.error(`[Webhook] Failed to send to "${hook.name}" (${hook.url}): ${err.message}`);
    }
  }
}

function getEventEmoji(event: string): string {
  switch (event) {
    case "deploy_success": return ":white_check_mark:";
    case "deploy_failed": return ":x:";
    case "health_assessment": return ":stethoscope:";
    case "scan_complete": return ":mag:";
    default: return ":bell:";
  }
}

function getEventTitle(event: string): string {
  switch (event) {
    case "deploy_success": return "Deployment Successful";
    case "deploy_failed": return "Deployment Failed";
    case "health_assessment": return "Health Assessment Complete";
    case "scan_complete": return "Org Discovery Complete";
    default: return event;
  }
}

function formatSlackMessage(event: string, data: any): object {
  const emoji = getEventEmoji(event);
  const title = getEventTitle(event);

  const fields: string[] = [];
  if (data.requirementTitle) fields.push(`*Requirement:* ${data.requirementTitle}`);
  if (data.orgName) fields.push(`*Org:* ${data.orgName}`);
  if (data.componentsCount) fields.push(`*Components:* ${data.componentsCount}`);
  if (data.overallGrade) fields.push(`*Grade:* ${data.overallGrade} (Score: ${data.overallScore})`);
  if (data.totalComponents) fields.push(`*Components Found:* ${data.totalComponents}`);
  if (data.errorSummary) fields.push(`*Error:* ${data.errorSummary}`);

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${title}*\n${fields.join("\n")}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `GS_ImproveSFAgent | ${new Date().toISOString()}`,
          },
        ],
      },
    ],
  };
}

function formatTeamsMessage(event: string, data: any): object {
  const title = getEventTitle(event);

  const facts: { name: string; value: string }[] = [];
  if (data.requirementTitle) facts.push({ name: "Requirement", value: data.requirementTitle });
  if (data.orgName) facts.push({ name: "Org", value: data.orgName });
  if (data.componentsCount) facts.push({ name: "Components", value: String(data.componentsCount) });
  if (data.overallGrade) facts.push({ name: "Grade", value: `${data.overallGrade} (${data.overallScore})` });
  if (data.totalComponents) facts.push({ name: "Components Found", value: String(data.totalComponents) });
  if (data.errorSummary) facts.push({ name: "Error", value: data.errorSummary });

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: title,
              size: "Large",
              weight: "Bolder",
            },
            {
              type: "FactSet",
              facts,
            },
            {
              type: "TextBlock",
              text: `GS_ImproveSFAgent | ${new Date().toISOString()}`,
              size: "Small",
              isSubtle: true,
            },
          ],
        },
      },
    ],
  };
}

export async function sendTestWebhook(webhookId: number): Promise<boolean> {
  const hook = storage.getWebhook(webhookId);
  if (!hook) return false;

  try {
    const testData = {
      requirementTitle: "Test Requirement",
      orgName: "Test Org",
      componentsCount: 5,
    };

    let body: string;
    switch (hook.type) {
      case "slack":
        body = JSON.stringify(formatSlackMessage("test", testData));
        break;
      case "teams":
        body = JSON.stringify(formatTeamsMessage("test", testData));
        break;
      default:
        body = JSON.stringify({ event: "test", timestamp: new Date().toISOString(), data: testData });
        break;
    }

    const response = await fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    return response.ok;
  } catch {
    return false;
  }
}

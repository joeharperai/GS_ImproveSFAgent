import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import type { SfOrg } from "@shared/schema";

const client = new Anthropic();

interface ScanProgress {
  phase: string;
  message: string;
  totalComponents: number;
  describedComponents: number;
}

type ProgressCallback = (progress: ScanProgress) => void;

// Helper to make authenticated Salesforce API calls
async function sfFetch(org: SfOrg, path: string): Promise<any> {
  const response = await fetch(`${org.instanceUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${org.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SF API error ${response.status}: ${errText}`);
  }
  return response.json();
}

// Tooling API query helper
async function toolingQuery(org: SfOrg, soql: string): Promise<any[]> {
  const result = await sfFetch(org, `/services/data/v60.0/tooling/query/?q=${encodeURIComponent(soql)}`);
  return result.records || [];
}

// REST API query helper
async function restQuery(org: SfOrg, soql: string): Promise<any[]> {
  const result = await sfFetch(org, `/services/data/v60.0/query/?q=${encodeURIComponent(soql)}`);
  return result.records || [];
}

export async function executeOrgDiscovery(
  scanId: number,
  orgId: number,
  onProgress: ProgressCallback
): Promise<void> {
  const org = storage.getOrg(orgId);
  if (!org || !org.accessToken) {
    storage.updateOrgScan(scanId, { status: "failed", errorLog: "Org not found or not connected" });
    return;
  }

  storage.updateOrgScan(scanId, { status: "running" });

  // Clear previous inventory for this org
  storage.deleteOrgInventory(orgId);

  let totalDiscovered = 0;
  const now = new Date().toISOString();
  const detectedClouds: string[] = [];
  const installedPackages: any[] = [];
  let allObjects: any[] = [];

  try {
    // ========== PHASE 1: Custom Objects & Fields ==========
    onProgress({ phase: "objects", message: "Discovering objects and fields...", totalComponents: totalDiscovered, describedComponents: 0 });

    const sobjectsResult = await sfFetch(org, "/services/data/v60.0/sobjects/");
    allObjects = sobjectsResult.sobjects || [];
    const customObjects = allObjects.filter((o: any) => o.custom && !o.name.endsWith("__mdt") && !o.name.endsWith("__e"));

    for (const obj of customObjects) {
      storage.createOrgInventoryItem({
        orgId,
        category: "CustomObject",
        apiName: obj.name,
        label: obj.label || obj.name,
        metadataJson: JSON.stringify({ keyPrefix: obj.keyPrefix, queryable: obj.queryable, triggerable: obj.triggerable }),
        status: "discovered",
        discoveredAt: now,
      });
      totalDiscovered++;

      // Get fields for this custom object
      try {
        const describeResult = await sfFetch(org, `/services/data/v60.0/sobjects/${obj.name}/describe/`);
        const customFields = (describeResult.fields || []).filter((f: any) => f.custom);
        for (const field of customFields) {
          storage.createOrgInventoryItem({
            orgId,
            category: "CustomField",
            apiName: `${obj.name}.${field.name}`,
            label: field.label || field.name,
            parentApiName: obj.name,
            metadataJson: JSON.stringify({ type: field.type, length: field.length, required: !field.nillable, unique: field.unique, externalId: field.externalId }),
            status: "discovered",
            discoveredAt: now,
          });
          totalDiscovered++;
        }
      } catch (_e) {
        // Some objects may not be describable — skip
      }
    }

    storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
    onProgress({ phase: "objects", message: `Discovered ${customObjects.length} custom objects`, totalComponents: totalDiscovered, describedComponents: 0 });

    // ========== PHASE 2: Apex Classes ==========
    onProgress({ phase: "apex", message: "Discovering Apex classes...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const apexClasses = await toolingQuery(org, "SELECT Id, Name, Body, Status, ApiVersion, LengthWithoutComments FROM ApexClass WHERE NamespacePrefix = null");
      for (const cls of apexClasses) {
        storage.createOrgInventoryItem({
          orgId,
          category: "ApexClass",
          apiName: cls.Name,
          label: cls.Name,
          sourceCode: cls.Body || null,
          metadataJson: JSON.stringify({ status: cls.Status, apiVersion: cls.ApiVersion, length: cls.LengthWithoutComments }),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
      onProgress({ phase: "apex", message: `Discovered ${apexClasses.length} Apex classes`, totalComponents: totalDiscovered, describedComponents: 0 });
    } catch (_e) {
      onProgress({ phase: "apex", message: "Could not query Apex classes (may require Tooling API access)", totalComponents: totalDiscovered, describedComponents: 0 });
    }

    // ========== PHASE 3: Apex Triggers ==========
    onProgress({ phase: "triggers", message: "Discovering Apex triggers...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const triggers = await toolingQuery(org, "SELECT Id, Name, Body, TableEnumOrId, Status, ApiVersion FROM ApexTrigger WHERE NamespacePrefix = null");
      for (const trig of triggers) {
        storage.createOrgInventoryItem({
          orgId,
          category: "ApexTrigger",
          apiName: trig.Name,
          label: trig.Name,
          sourceCode: trig.Body || null,
          parentApiName: trig.TableEnumOrId || null,
          metadataJson: JSON.stringify({ status: trig.Status, apiVersion: trig.ApiVersion }),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
      onProgress({ phase: "triggers", message: `Discovered ${triggers.length} Apex triggers`, totalComponents: totalDiscovered, describedComponents: 0 });
    } catch (_e) {
      onProgress({ phase: "triggers", message: "Could not query Apex triggers", totalComponents: totalDiscovered, describedComponents: 0 });
    }

    // ========== PHASE 4: Flows ==========
    onProgress({ phase: "flows", message: "Discovering Flows...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const flows = await toolingQuery(org, "SELECT Id, DeveloperName, MasterLabel, ProcessType, Status, Description FROM Flow WHERE Status = 'Active'");
      for (const flow of flows) {
        storage.createOrgInventoryItem({
          orgId,
          category: flow.ProcessType === "Workflow" ? "ProcessBuilder" : "Flow",
          apiName: flow.DeveloperName,
          label: flow.MasterLabel || flow.DeveloperName,
          description: flow.Description || null,
          metadataJson: JSON.stringify({ processType: flow.ProcessType, status: flow.Status }),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
      onProgress({ phase: "flows", message: `Discovered ${flows.length} Flows`, totalComponents: totalDiscovered, describedComponents: 0 });
    } catch (_e) {
      onProgress({ phase: "flows", message: "Could not query Flows", totalComponents: totalDiscovered, describedComponents: 0 });
    }

    // ========== PHASE 5: Validation Rules ==========
    onProgress({ phase: "validations", message: "Discovering Validation Rules...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const validations = await toolingQuery(org, "SELECT Id, ValidationName, Active, Description, EntityDefinition.DeveloperName FROM ValidationRule WHERE Active = true");
      for (const vr of validations) {
        storage.createOrgInventoryItem({
          orgId,
          category: "ValidationRule",
          apiName: vr.ValidationName,
          label: vr.ValidationName,
          description: vr.Description || null,
          parentApiName: vr.EntityDefinition?.DeveloperName || null,
          metadataJson: JSON.stringify({ active: vr.Active }),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 6: LWC ==========
    onProgress({ phase: "lwc", message: "Discovering Lightning Web Components...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const lwcBundles = await toolingQuery(org, "SELECT Id, DeveloperName, MasterLabel, Description FROM LightningComponentBundle WHERE NamespacePrefix = null");
      for (const lwc of lwcBundles) {
        storage.createOrgInventoryItem({
          orgId,
          category: "LWC",
          apiName: lwc.DeveloperName,
          label: lwc.MasterLabel || lwc.DeveloperName,
          description: lwc.Description || null,
          metadataJson: JSON.stringify({}),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 7: Permission Sets ==========
    try {
      const permSets = await toolingQuery(org, "SELECT Id, Name, Label, Description FROM PermissionSet WHERE IsOwnedByProfile = false AND NamespacePrefix = null");
      for (const ps of permSets) {
        storage.createOrgInventoryItem({
          orgId,
          category: "PermissionSet",
          apiName: ps.Name,
          label: ps.Label || ps.Name,
          description: ps.Description || null,
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 8: Profiles ==========
    try {
      const profiles = await restQuery(org, "SELECT Id, Name FROM Profile");
      for (const p of profiles) {
        storage.createOrgInventoryItem({
          orgId,
          category: "Profile",
          apiName: p.Name.replace(/\s+/g, "_"),
          label: p.Name,
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 9: Installed Packages ==========
    onProgress({ phase: "packages", message: "Detecting installed packages...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const packages = await toolingQuery(org, "SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion FROM InstalledSubscriberPackage");
      for (const pkg of packages) {
        const name = pkg.SubscriberPackage?.Name || "Unknown";
        const ns = pkg.SubscriberPackage?.NamespacePrefix || "";
        const ver = `${pkg.SubscriberPackageVersion?.MajorVersion || 0}.${pkg.SubscriberPackageVersion?.MinorVersion || 0}.${pkg.SubscriberPackageVersion?.PatchVersion || 0}`;
        installedPackages.push({ name, namespace: ns, version: ver });
        storage.createOrgInventoryItem({
          orgId,
          category: "InstalledPackage",
          apiName: ns || name,
          label: name,
          metadataJson: JSON.stringify({ namespace: ns, version: ver }),
          status: "discovered",
          discoveredAt: now,
        });
        totalDiscovered++;
      }
      storage.updateOrgScan(scanId, { totalComponents: totalDiscovered, packagesJson: JSON.stringify(installedPackages) });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 10: Cloud/Feature Detection ==========
    onProgress({ phase: "clouds", message: "Detecting active Salesforce Clouds...", totalComponents: totalDiscovered, describedComponents: 0 });

    try {
      const licenses = await restQuery(org, "SELECT Id, Name, Status, TotalLicenses, UsedLicenses FROM UserLicense WHERE Status = 'Active'");
      const cloudMap: Record<string, string> = {
        "Salesforce": "Sales Cloud",
        "Salesforce Platform": "Platform",
        "Service Cloud": "Service Cloud",
        "Marketing Cloud": "Marketing Cloud",
        "Knowledge": "Knowledge",
        "Customer Community": "Experience Cloud",
        "Partner Community": "Experience Cloud",
        "Financial Services Cloud": "Financial Services Cloud",
        "Health Cloud": "Health Cloud",
      };

      for (const lic of licenses) {
        const cloud = cloudMap[lic.Name];
        if (cloud && !detectedClouds.includes(cloud)) {
          detectedClouds.push(cloud);
        }
      }

      // Also check for FSC-specific objects
      const allObjectNames = allObjects.map((o: any) => o.name);
      if (allObjectNames.includes("FinServ__FinancialAccount__c") || allObjectNames.includes("FinServ__FinancialGoal__c")) {
        if (!detectedClouds.includes("Financial Services Cloud")) detectedClouds.push("Financial Services Cloud");
      }
      if (allObjectNames.includes("HealthCloudGA__EhrPatient__c")) {
        if (!detectedClouds.includes("Health Cloud")) detectedClouds.push("Health Cloud");
      }

      storage.updateOrgScan(scanId, { cloudsDetectedJson: JSON.stringify(detectedClouds) });
    } catch (_e) {
      // skip
    }

    // ========== PHASE 11: AI Descriptions (batch) ==========
    onProgress({ phase: "ai_descriptions", message: "Generating AI descriptions...", totalComponents: totalDiscovered, describedComponents: 0 });

    const undescribed = storage.getOrgInventory(orgId).filter(item => !item.description && (item.sourceCode || item.category === "CustomObject" || item.category === "Flow"));
    let described = 0;

    // Process in batches of 5
    for (let i = 0; i < undescribed.length; i += 5) {
      const batch = undescribed.slice(i, i + 5);
      try {
        const batchPrompt = batch.map((item, idx) => {
          let context = `${idx + 1}. [${item.category}] ${item.apiName} (Label: ${item.label})`;
          if (item.sourceCode) {
            context += `\nCode:\n${item.sourceCode.substring(0, 2000)}`;
          }
          if (item.metadataJson) {
            context += `\nMetadata: ${item.metadataJson.substring(0, 500)}`;
          }
          return context;
        }).join("\n\n");

        const message = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: `You are a Salesforce Technical Architect. For each component below, write a 1-2 sentence plain-English description of what it does and why it exists. Be specific about business logic, not just restating the name.

${batchPrompt}

Respond with JSON only (no markdown). Format:
{"descriptions": ["Description for item 1", "Description for item 2", ...]}`
          }],
        });

        const content = message.content[0];
        if (content.type === "text") {
          let parsed: any;
          try {
            parsed = JSON.parse(content.text);
          } catch {
            const jsonMatch = content.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed?.descriptions) {
            for (let j = 0; j < batch.length && j < parsed.descriptions.length; j++) {
              storage.updateOrgInventoryItem(batch[j].id, {
                description: parsed.descriptions[j],
                status: "described",
              });
              described++;
            }
          }
        }
      } catch (_e) {
        // Continue with next batch if AI fails
      }

      storage.updateOrgScan(scanId, { describedComponents: described });
      onProgress({ phase: "ai_descriptions", message: `Described ${described} of ${undescribed.length} components`, totalComponents: totalDiscovered, describedComponents: described });
    }

    // ========== COMPLETE ==========
    storage.updateOrgScan(scanId, {
      status: "completed",
      totalComponents: totalDiscovered,
      describedComponents: described,
      completedAt: new Date().toISOString(),
    });

    onProgress({ phase: "complete", message: `Discovery complete: ${totalDiscovered} components found, ${described} described by AI`, totalComponents: totalDiscovered, describedComponents: described });

  } catch (error: any) {
    storage.updateOrgScan(scanId, {
      status: "failed",
      errorLog: error.message || "Unknown error during discovery",
      completedAt: new Date().toISOString(),
    });
    onProgress({ phase: "error", message: `Discovery failed: ${error.message}`, totalComponents: totalDiscovered, describedComponents: 0 });
  }
}

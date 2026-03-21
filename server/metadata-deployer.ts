/**
 * GS_ImproveSFAgent — Metadata API ZIP Deployer
 * 
 * Packages generated components into a deployable ZIP with package.xml,
 * deploys via the Salesforce Metadata REST API (/metadata/deployRequest),
 * and polls checkDeployStatus until completion.
 */

import JSZip from "jszip";
import type { SfOrg, MetadataComponent } from "@shared/schema";

// ============================================================
// TYPES
// ============================================================

export interface DeployResult {
  success: boolean;
  id?: string;
  status?: string;
  numberComponentsDeployed?: number;
  numberComponentErrors?: number;
  numberComponentsTotal?: number;
  errors: DeployError[];
  details?: any;
}

export interface DeployError {
  componentType: string;
  apiName: string;
  problem: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface DeployProgress {
  status: string;
  done: boolean;
  success?: boolean;
  componentsDeployed?: number;
  componentsTotal?: number;
  componentErrors?: number;
  stateDetail?: string;
  errors?: DeployError[];
}

type ProgressCallback = (progress: DeployProgress) => void;

// ============================================================
// METADATA TYPE → FOLDER & EXTENSION MAPPING
// ============================================================
// Reference: https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_types_list.htm

interface MetadataTypeConfig {
  folder: string;
  extension: string;
  /** For XML metadata, the wrapping element name */
  xmlType?: string;
  /** If true, this goes in a subfolder per component (e.g., LWC) */
  hasSubfolder?: boolean;
  /** For types nested inside an object folder (e.g., fields, validations) */
  parentFolder?: string;
  /** Package.xml type name (if different from our internal type) */
  packageType: string;
  /** For CustomField, the member format is Object.FieldName */
  memberFormat?: "objectDotField";
}

const METADATA_MAP: Record<string, MetadataTypeConfig> = {
  CustomObject: {
    folder: "objects",
    extension: ".object",
    xmlType: "CustomObject",
    packageType: "CustomObject",
  },
  CustomField: {
    folder: "objects",
    extension: ".object",
    xmlType: "CustomField",
    packageType: "CustomField",
    memberFormat: "objectDotField",
  },
  ApexClass: {
    folder: "classes",
    extension: ".cls",
    packageType: "ApexClass",
  },
  ApexTrigger: {
    folder: "triggers",
    extension: ".trigger",
    packageType: "ApexTrigger",
  },
  Flow: {
    folder: "flows",
    extension: ".flow",
    xmlType: "Flow",
    packageType: "Flow",
  },
  ValidationRule: {
    folder: "objects",
    extension: ".object",
    xmlType: "ValidationRule",
    packageType: "ValidationRule",
    memberFormat: "objectDotField",
  },
  PermissionSet: {
    folder: "permissionsets",
    extension: ".permissionset",
    xmlType: "PermissionSet",
    packageType: "PermissionSet",
  },
  Layout: {
    folder: "layouts",
    extension: ".layout",
    xmlType: "Layout",
    packageType: "Layout",
  },
  LWC: {
    folder: "lwc",
    extension: ".js",
    hasSubfolder: true,
    packageType: "LightningComponentBundle",
  },
  RecordType: {
    folder: "objects",
    extension: ".object",
    xmlType: "RecordType",
    packageType: "RecordType",
    memberFormat: "objectDotField",
  },
  Report: {
    folder: "reports",
    extension: ".report",
    xmlType: "Report",
    packageType: "Report",
  },
  Dashboard: {
    folder: "dashboards",
    extension: ".dashboard",
    xmlType: "Dashboard",
    packageType: "Dashboard",
  },
};

const API_VERSION = "60.0";

// ============================================================
// PACKAGE.XML GENERATOR
// ============================================================

function generatePackageXml(components: MetadataComponent[]): string {
  // Group components by their package.xml type
  const typeGroups = new Map<string, Set<string>>();

  for (const comp of components) {
    const config = METADATA_MAP[comp.componentType];
    if (!config) continue;

    const pkgType = config.packageType;
    if (!typeGroups.has(pkgType)) {
      typeGroups.set(pkgType, new Set());
    }

    // Determine the member name for package.xml
    let memberName = comp.apiName;

    // For CustomField, ValidationRule, RecordType: use Object.FieldName format
    if (config.memberFormat === "objectDotField") {
      // The apiName might already be in Object__c.Field__c format
      // If not, try to extract the object name from the metadata
      if (!memberName.includes(".")) {
        // Try to find the parent object from the metadata
        const objectMatch = (comp.metadataXml || "").match(/<fullName>(\w+__c)\.(\w+)<\/fullName>/);
        if (objectMatch) {
          memberName = `${objectMatch[1]}.${objectMatch[2]}`;
        }
      }
    }

    typeGroups.get(pkgType)!.add(memberName);
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;

  for (const [typeName, members] of typeGroups) {
    xml += `  <types>\n`;
    for (const member of members) {
      xml += `    <members>${escapeXml(member)}</members>\n`;
    }
    xml += `    <name>${typeName}</name>\n`;
    xml += `  </types>\n`;
  }

  xml += `  <version>${API_VERSION}</version>\n`;
  xml += `</Package>`;

  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================
// APEX META-XML GENERATOR
// ============================================================

function generateApexMetaXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${API_VERSION}</apiVersion>
    <status>Active</status>
</ApexClass>`;
}

function generateTriggerMetaXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${API_VERSION}</apiVersion>
    <status>Active</status>
</ApexTrigger>`;
}

// ============================================================
// ZIP PACKAGER
// ============================================================

export async function buildDeployZip(components: MetadataComponent[]): Promise<Buffer> {
  const zip = new JSZip();

  for (const comp of components) {
    const config = METADATA_MAP[comp.componentType];
    if (!config) {
      console.warn(`Unknown component type: ${comp.componentType}, skipping`);
      continue;
    }

    const metadata = comp.metadataXml || "";
    const cleanName = comp.apiName.replace(/__c$/, "").replace(/\./g, "_");

    switch (comp.componentType) {
      case "ApexClass": {
        // classes/ClassName.cls + classes/ClassName.cls-meta.xml
        const className = comp.apiName.replace(/__c$/, "");
        zip.file(`classes/${className}.cls`, metadata);
        zip.file(`classes/${className}.cls-meta.xml`, generateApexMetaXml());
        break;
      }

      case "ApexTrigger": {
        // triggers/TriggerName.trigger + triggers/TriggerName.trigger-meta.xml
        const triggerName = comp.apiName.replace(/__c$/, "");
        zip.file(`triggers/${triggerName}.trigger`, metadata);
        zip.file(`triggers/${triggerName}.trigger-meta.xml`, generateTriggerMetaXml());
        break;
      }

      case "CustomObject": {
        // objects/ObjectName__c.object
        // The metadata should be complete object XML
        let objectXml = metadata;
        if (!objectXml.includes('<?xml')) {
          objectXml = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n${objectXml}\n</CustomObject>`;
        }
        zip.file(`objects/${comp.apiName}.object`, objectXml);
        break;
      }

      case "CustomField": {
        // Fields are deployed as part of the object definition
        // objects/ObjectName__c.object with <fields> element
        let fieldXml = metadata;
        if (!fieldXml.includes('<?xml')) {
          // Wrap in a minimal object definition containing just this field
          const objectName = comp.apiName.includes('.') ? comp.apiName.split('.')[0] : 'Account';
          fieldXml = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n  <fields>\n${fieldXml}\n  </fields>\n</CustomObject>`;
          zip.file(`objects/${objectName}.object`, fieldXml);
        } else {
          const objectName = comp.apiName.includes('.') ? comp.apiName.split('.')[0] : cleanName;
          zip.file(`objects/${objectName}.object`, fieldXml);
        }
        break;
      }

      case "Flow": {
        // flows/FlowName.flow
        let flowXml = metadata;
        if (!flowXml.includes('<?xml')) {
          flowXml = `<?xml version="1.0" encoding="UTF-8"?>\n${flowXml}`;
        }
        zip.file(`flows/${comp.apiName}.flow`, flowXml);
        break;
      }

      case "ValidationRule": {
        // Validation rules are part of the object definition
        let vrXml = metadata;
        const objectName = comp.apiName.includes('.') ? comp.apiName.split('.')[0] : 'Account';
        if (!vrXml.includes('<?xml')) {
          vrXml = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n  <validationRules>\n${vrXml}\n  </validationRules>\n</CustomObject>`;
        }
        zip.file(`objects/${objectName}.object`, vrXml);
        break;
      }

      case "PermissionSet": {
        // permissionsets/PermSetName.permissionset
        let psXml = metadata;
        if (!psXml.includes('<?xml')) {
          psXml = `<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">\n${psXml}\n</PermissionSet>`;
        }
        zip.file(`permissionsets/${comp.apiName}.permissionset`, psXml);
        break;
      }

      case "Layout": {
        // layouts/ObjectName__c-LayoutName.layout
        let layoutXml = metadata;
        if (!layoutXml.includes('<?xml')) {
          layoutXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Layout xmlns="http://soap.sforce.com/2006/04/metadata">\n${layoutXml}\n</Layout>`;
        }
        zip.file(`layouts/${comp.apiName}.layout`, layoutXml);
        break;
      }

      case "LWC": {
        // lwc/componentName/componentName.js + componentName.html + componentName.js-meta.xml
        const lwcName = comp.apiName.replace(/^c__/, "").replace(/__c$/, "");
        const lwcFolder = `lwc/${lwcName}`;

        // The AI may have generated combined JS+HTML+meta — try to parse them apart
        const jsMatch = metadata.match(/\/\/ ?(?:JS|JavaScript)[\s\S]*?(?=\/\/ ?(?:HTML|Template)|<template>|$)/i);
        const htmlMatch = metadata.match(/<template>[\s\S]*?<\/template>/i);

        const jsContent = jsMatch ? jsMatch[0].trim() : metadata;
        const htmlContent = htmlMatch ? htmlMatch[0].trim() : `<template>\n  <div>Component: ${lwcName}</div>\n</template>`;

        zip.file(`${lwcFolder}/${lwcName}.js`, jsContent);
        zip.file(`${lwcFolder}/${lwcName}.html`, htmlContent);
        zip.file(`${lwcFolder}/${lwcName}.js-meta.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${API_VERSION}</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__RecordPage</target>
        <target>lightning__AppPage</target>
        <target>lightning__HomePage</target>
    </targets>
</LightningComponentBundle>`);
        break;
      }

      default: {
        // Generic: just put the metadata in the appropriate folder
        zip.file(`${config.folder}/${comp.apiName}${config.extension}`, metadata);
        break;
      }
    }
  }

  // Add package.xml at the root
  zip.file("package.xml", generatePackageXml(components));

  // Generate the ZIP buffer
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buffer;
}

// ============================================================
// METADATA REST API DEPLOY
// ============================================================

export async function deployToOrg(
  org: SfOrg,
  components: MetadataComponent[],
  onProgress?: ProgressCallback,
  options?: { checkOnly?: boolean }
): Promise<DeployResult> {
  if (!org.accessToken || !org.instanceUrl) {
    return {
      success: false,
      errors: [{ componentType: "N/A", apiName: "N/A", problem: "Org not connected — missing access token or instance URL" }],
    };
  }

  // Step 1: Build the ZIP
  onProgress?.({
    status: "Packaging",
    done: false,
    stateDetail: `Packaging ${components.length} components into deploy ZIP...`,
  });

  const zipBuffer = await buildDeployZip(components);

  // Step 2: Deploy via Metadata REST API (multipart/form-data)
  onProgress?.({
    status: "Uploading",
    done: false,
    stateDetail: "Uploading deployment package to Salesforce...",
  });

  const deployId = await initiateRestDeploy(org, zipBuffer, options?.checkOnly);

  if (!deployId) {
    return {
      success: false,
      errors: [{ componentType: "N/A", apiName: "N/A", problem: "Failed to initiate deployment — no deploy ID returned" }],
    };
  }

  // Step 3: Poll for status
  onProgress?.({
    status: "InProgress",
    done: false,
    stateDetail: `Deployment ${deployId} initiated, polling for status...`,
  });

  const result = await pollDeployStatus(org, deployId, onProgress);
  return result;
}

// ============================================================
// REST DEPLOY INITIATION
// ============================================================

async function initiateRestDeploy(org: SfOrg, zipBuffer: Buffer, checkOnly?: boolean): Promise<string | null> {
  const boundary = "----GS_ImproveSFAgent_Deploy_" + Date.now();

  const deployOptions = JSON.stringify({
    deployOptions: {
      allowMissingFiles: false,
      autoUpdatePackage: false,
      checkOnly: checkOnly || false,
      ignoreWarnings: false,
      performRetrieve: false,
      purgeOnDelete: false,
      rollbackOnError: true,
      singlePackage: true,
      testLevel: "NoTestRun",
    },
  });

  // Build multipart body manually
  const parts: Buffer[] = [];

  // JSON part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="json"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    deployOptions + `\r\n`
  ));

  // ZIP file part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="deploy.zip"\r\n` +
    `Content-Type: application/zip\r\n\r\n`
  ));
  parts.push(zipBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  try {
    const response = await fetch(
      `${org.instanceUrl}/services/data/v${API_VERSION}/metadata/deployRequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${org.accessToken}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length.toString(),
        },
        body: body,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Deploy initiation failed (${response.status}): ${errText}`);
      return null;
    }

    const result = await response.json() as any;
    return result.id || result.deployResult?.id || null;
  } catch (err: any) {
    console.error("Deploy initiation error:", err.message);
    return null;
  }
}

// ============================================================
// DEPLOY STATUS POLLING
// ============================================================

async function pollDeployStatus(
  org: SfOrg,
  deployId: string,
  onProgress?: ProgressCallback
): Promise<DeployResult> {
  const MAX_POLLS = 60;
  let waitMs = 2000; // Start with 2 seconds
  const MAX_WAIT = 15000; // Cap at 15 seconds

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await sleep(waitMs);
    waitMs = Math.min(waitMs * 1.5, MAX_WAIT); // Exponential backoff capped at 15s

    try {
      const response = await fetch(
        `${org.instanceUrl}/services/data/v${API_VERSION}/metadata/deployRequest/${deployId}?includeDetails=true`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${org.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Deploy status check failed (${response.status}): ${errText}`);
        continue;
      }

      const data = await response.json() as any;
      const dr = data.deployResult || data;

      const progress: DeployProgress = {
        status: dr.status || "Unknown",
        done: dr.done === true,
        success: dr.success === true,
        componentsDeployed: dr.numberComponentsDeployed || 0,
        componentsTotal: dr.numberComponentsTotal || 0,
        componentErrors: dr.numberComponentErrors || 0,
        stateDetail: dr.stateDetail || "",
      };

      onProgress?.(progress);

      if (dr.done) {
        // Extract errors from details
        const errors: DeployError[] = [];
        const details = dr.details;

        if (details?.componentFailures) {
          const failures = Array.isArray(details.componentFailures)
            ? details.componentFailures
            : [details.componentFailures];

          for (const f of failures) {
            if (f.success === false || f.problem) {
              errors.push({
                componentType: f.componentType || "Unknown",
                apiName: f.fullName || f.fileName || "Unknown",
                problem: f.problem || "Unknown error",
                lineNumber: f.lineNumber || undefined,
                columnNumber: f.columnNumber || undefined,
              });
            }
          }
        }

        return {
          success: dr.success === true,
          id: deployId,
          status: dr.status,
          numberComponentsDeployed: dr.numberComponentsDeployed || 0,
          numberComponentErrors: dr.numberComponentErrors || 0,
          numberComponentsTotal: dr.numberComponentsTotal || 0,
          errors,
          details: details,
        };
      }
    } catch (err: any) {
      console.error(`Poll error (attempt ${poll + 1}):`, err.message);
    }
  }

  // Timeout
  return {
    success: false,
    id: deployId,
    status: "Timeout",
    errors: [{ componentType: "N/A", apiName: "N/A", problem: `Deployment ${deployId} timed out after ${MAX_POLLS} status checks` }],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

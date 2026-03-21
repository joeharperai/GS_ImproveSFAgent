/**
 * GS_ImproveSFAgent — Salesforce Bulk API 2.0 Client
 *
 * Supports insert, update, upsert, delete, and query operations
 * via the Bulk API 2.0 endpoints.
 */

import type { SfOrg } from "@shared/schema";
import { trackApiCall, canMakeApiCall, parseSforceLimitHeader } from "./rate-limiter";

const API_VERSION = "60.0";

export interface BulkJobConfig {
  object: string;
  operation: "insert" | "update" | "upsert" | "delete" | "query";
  externalIdField?: string;
  csvData?: string;
  query?: string;
}

export interface BulkJobResult {
  jobId: string;
  state: string;
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errors: string[];
}

async function sfFetchRaw(org: SfOrg, path: string, options: RequestInit = {}): Promise<Response> {
  if (!canMakeApiCall(org.id)) {
    throw new Error("API rate limit reached — daily limit exhausted");
  }

  const response = await fetch(`${org.instanceUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${org.accessToken}`,
      ...options.headers,
    },
  });

  trackApiCall(org.id);
  const limitHeader = response.headers.get("sforce-limit-info");
  if (limitHeader) parseSforceLimitHeader(org.id, limitHeader);

  return response;
}

export async function createBulkJob(org: SfOrg, config: BulkJobConfig): Promise<string> {
  const isQuery = config.operation === "query";
  const endpoint = isQuery
    ? `/services/data/v${API_VERSION}/jobs/query`
    : `/services/data/v${API_VERSION}/jobs/ingest`;

  const body: Record<string, string> = {
    object: config.object,
    operation: config.operation,
    contentType: "CSV",
  };

  if (config.externalIdField && config.operation === "upsert") {
    body.externalIdFieldName = config.externalIdField;
  }

  if (isQuery && config.query) {
    body.query = config.query;
  }

  const response = await sfFetchRaw(org, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create bulk job: ${response.status} ${errText}`);
  }

  const result = await response.json() as any;
  return result.id;
}

export async function uploadBulkData(org: SfOrg, jobId: string, csvData: string): Promise<void> {
  const response = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/ingest/${jobId}/batches`, {
    method: "PUT",
    headers: { "Content-Type": "text/csv" },
    body: csvData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to upload bulk data: ${response.status} ${errText}`);
  }
}

export async function closeBulkJob(org: SfOrg, jobId: string): Promise<void> {
  const response = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/ingest/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "UploadComplete" }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to close bulk job: ${response.status} ${errText}`);
  }
}

export async function pollBulkJobStatus(org: SfOrg, jobId: string, isQuery = false): Promise<BulkJobResult> {
  const base = isQuery ? "query" : "ingest";
  const MAX_POLLS = 60;
  let waitMs = 2000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, waitMs));
    waitMs = Math.min(waitMs * 1.5, 15000);

    const response = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/${base}/${jobId}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) continue;

    const data = await response.json() as any;
    const state = data.state || "Unknown";

    if (state === "JobComplete" || state === "Failed" || state === "Aborted") {
      return {
        jobId,
        state,
        numberRecordsProcessed: data.numberRecordsProcessed || 0,
        numberRecordsFailed: data.numberRecordsFailed || 0,
        errors: state === "Failed" ? [data.errorMessage || "Job failed"] : [],
      };
    }
  }

  return {
    jobId,
    state: "Timeout",
    numberRecordsProcessed: 0,
    numberRecordsFailed: 0,
    errors: ["Polling timed out"],
  };
}

export async function getBulkJobResults(org: SfOrg, jobId: string, isQuery = false): Promise<{ successfulResults: string; failedResults: string }> {
  const base = isQuery ? "query" : "ingest";

  let successfulResults = "";
  let failedResults = "";

  if (isQuery) {
    // Query jobs: GET /jobs/query/{jobId}/results
    const res = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/${base}/${jobId}/results`, {
      method: "GET",
      headers: { Accept: "text/csv" },
    });
    if (res.ok) successfulResults = await res.text();
  } else {
    // Ingest jobs: separate success and failure endpoints
    const successRes = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/${base}/${jobId}/successfulResults`, {
      method: "GET",
      headers: { Accept: "text/csv" },
    });
    if (successRes.ok) successfulResults = await successRes.text();

    const failRes = await sfFetchRaw(org, `/services/data/v${API_VERSION}/jobs/${base}/${jobId}/failedResults`, {
      method: "GET",
      headers: { Accept: "text/csv" },
    });
    if (failRes.ok) failedResults = await failRes.text();
  }

  return { successfulResults, failedResults };
}

export async function executeBulkQuery(org: SfOrg, query: string): Promise<{ jobId: string; results: string }> {
  const jobId = await createBulkJob(org, { object: "", operation: "query", query });
  const result = await pollBulkJobStatus(org, jobId, true);

  if (result.state !== "JobComplete") {
    throw new Error(`Bulk query failed: ${result.errors.join(", ") || result.state}`);
  }

  const { successfulResults } = await getBulkJobResults(org, jobId, true);
  return { jobId, results: successfulResults };
}

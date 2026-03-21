import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, like, or, and } from "drizzle-orm";
import {
  customers, sfOrgs, requirements, analyses, metadataComponents, deployments, agentRuns,
  orgScans, orgInventory, healthAssessments, healthFindings, changeRequests,
  type InsertCustomer, type Customer,
  type InsertSfOrg, type SfOrg,
  type InsertRequirement, type Requirement,
  type InsertAnalysis, type Analysis,
  type InsertMetadataComponent, type MetadataComponent,
  type InsertDeployment, type Deployment,
  type InsertAgentRun, type AgentRun,
  type InsertOrgScan, type OrgScan,
  type InsertOrgInventoryItem, type OrgInventoryItem,
  type InsertHealthAssessment, type HealthAssessment,
  type InsertHealthFinding, type HealthFinding,
  type InsertChangeRequest, type ChangeRequest,
} from "@shared/schema";

const sqlite = new Database("sf_deploy.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Run migrations
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    contact_name TEXT,
    contact_email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sf_orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    instance_url TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    client_id TEXT,
    client_secret TEXT,
    org_type TEXT NOT NULL DEFAULT 'sandbox',
    status TEXT NOT NULL DEFAULT 'disconnected',
    connected_at TEXT
  );
  CREATE TABLE IF NOT EXISTS requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'declarative',
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'draft',
    org_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL,
    summary TEXT NOT NULL,
    components_json TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    best_practices_json TEXT NOT NULL,
    risks_json TEXT NOT NULL,
    estimated_effort TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL,
    component_type TEXT NOT NULL,
    api_name TEXT NOT NULL,
    label TEXT NOT NULL,
    metadata_xml TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    deployment_log TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    components_json TEXT NOT NULL,
    log_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL,
    org_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    phase TEXT NOT NULL DEFAULT 'init',
    steps_json TEXT NOT NULL DEFAULT '[]',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    error_summary TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS org_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_components INTEGER DEFAULT 0,
    described_components INTEGER DEFAULT 0,
    clouds_detected_json TEXT DEFAULT '[]',
    packages_json TEXT DEFAULT '[]',
    error_log TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS org_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    api_name TEXT NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    source_code TEXT,
    metadata_json TEXT,
    parent_api_name TEXT,
    status TEXT NOT NULL DEFAULT 'discovered',
    discovered_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS health_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    overall_grade TEXT NOT NULL DEFAULT 'N/A',
    overall_score INTEGER NOT NULL DEFAULT 0,
    security_score INTEGER NOT NULL DEFAULT 0,
    performance_score INTEGER NOT NULL DEFAULT 0,
    maintainability_score INTEGER NOT NULL DEFAULT 0,
    scalability_score INTEGER NOT NULL DEFAULT 0,
    total_findings INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    info_count INTEGER NOT NULL DEFAULT 0,
    complexity_score TEXT DEFAULT 'Low',
    complexity_summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS health_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    component_api_name TEXT,
    component_type TEXT,
    recommendation TEXT NOT NULL,
    code_snippet TEXT
  );
  CREATE TABLE IF NOT EXISTS change_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    target_component_id INTEGER,
    target_api_name TEXT,
    target_type TEXT,
    original_code TEXT,
    proposed_code TEXT,
    diff_json TEXT,
    impact_analysis_json TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    rollback_package_json TEXT,
    deployed_to_sandbox INTEGER DEFAULT 0,
    deployed_to_production INTEGER DEFAULT 0,
    sandbox_org_id INTEGER,
    production_org_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
`);

// Migrations: add columns if missing
const migrations = [
  `ALTER TABLE sf_orgs ADD COLUMN client_id TEXT`,
  `ALTER TABLE sf_orgs ADD COLUMN client_secret TEXT`,
  `ALTER TABLE sf_orgs ADD COLUMN customer_id INTEGER`,
  `ALTER TABLE sf_orgs ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'read_only'`,
];
for (const m of migrations) {
  try { sqlite.exec(m + ";"); } catch (_e) { /* column already exists */ }
}

export interface IStorage {
  // Customers
  getCustomers(): Customer[];
  getCustomer(id: number): Customer | undefined;
  createCustomer(customer: InsertCustomer): Customer;
  updateCustomer(id: number, data: Partial<InsertCustomer>): Customer | undefined;
  deleteCustomer(id: number): void;

  // Orgs
  getOrgs(): SfOrg[];
  getOrgsByCustomer(customerId: number): SfOrg[];
  getOrg(id: number): SfOrg | undefined;
  createOrg(org: InsertSfOrg): SfOrg;
  updateOrg(id: number, data: Partial<InsertSfOrg>): SfOrg | undefined;
  deleteOrg(id: number): void;

  // Requirements
  getRequirements(): Requirement[];
  getRequirement(id: number): Requirement | undefined;
  createRequirement(req: InsertRequirement): Requirement;
  updateRequirement(id: number, data: Partial<InsertRequirement>): Requirement | undefined;
  deleteRequirement(id: number): void;

  // Analyses
  getAnalysisByRequirement(requirementId: number): Analysis | undefined;
  createAnalysis(analysis: InsertAnalysis): Analysis;

  // Metadata Components
  getComponentsByRequirement(requirementId: number): MetadataComponent[];
  getComponent(id: number): MetadataComponent | undefined;
  createComponent(component: InsertMetadataComponent): MetadataComponent;
  updateComponent(id: number, data: Partial<InsertMetadataComponent>): MetadataComponent | undefined;

  // Deployments
  getDeployments(): Deployment[];
  getDeploymentsByRequirement(requirementId: number): Deployment[];
  createDeployment(deployment: InsertDeployment): Deployment;
  updateDeployment(id: number, data: Partial<InsertDeployment>): Deployment | undefined;

  // Agent Runs
  getAgentRuns(): AgentRun[];
  getAgentRun(id: number): AgentRun | undefined;
  getAgentRunsByRequirement(requirementId: number): AgentRun[];
  createAgentRun(run: InsertAgentRun): AgentRun;
  updateAgentRun(id: number, data: Partial<InsertAgentRun>): AgentRun | undefined;

  // Org Scans
  getOrgScans(orgId: number): OrgScan[];
  getOrgScan(id: number): OrgScan | undefined;
  getLatestOrgScan(orgId: number): OrgScan | undefined;
  createOrgScan(scan: InsertOrgScan): OrgScan;
  updateOrgScan(id: number, data: Partial<InsertOrgScan>): OrgScan | undefined;

  // Org Inventory
  getOrgInventory(orgId: number): OrgInventoryItem[];
  getOrgInventoryByCategory(orgId: number, category: string): OrgInventoryItem[];
  getOrgInventoryItem(id: number): OrgInventoryItem | undefined;
  createOrgInventoryItem(item: InsertOrgInventoryItem): OrgInventoryItem;
  updateOrgInventoryItem(id: number, data: Partial<InsertOrgInventoryItem>): OrgInventoryItem | undefined;
  deleteOrgInventory(orgId: number): void;
  searchOrgInventory(orgId: number, query: string): OrgInventoryItem[];

  // Health Assessments
  getHealthAssessments(orgId: number): HealthAssessment[];
  getHealthAssessment(id: number): HealthAssessment | undefined;
  getLatestHealthAssessment(orgId: number): HealthAssessment | undefined;
  createHealthAssessment(a: InsertHealthAssessment): HealthAssessment;
  updateHealthAssessment(id: number, data: Partial<InsertHealthAssessment>): HealthAssessment | undefined;

  // Health Findings
  getHealthFindings(assessmentId: number): HealthFinding[];
  getHealthFindingsByCategory(assessmentId: number, category: string): HealthFinding[];
  createHealthFinding(f: InsertHealthFinding): HealthFinding;
  deleteHealthFindings(assessmentId: number): void;

  // Change Requests
  getChangeRequests(orgId: number): ChangeRequest[];
  getChangeRequest(id: number): ChangeRequest | undefined;
  createChangeRequest(cr: InsertChangeRequest): ChangeRequest;
  updateChangeRequest(id: number, data: Partial<InsertChangeRequest>): ChangeRequest | undefined;
  deleteChangeRequest(id: number): void;
  getAllChangeRequests(): ChangeRequest[];
}

export class SqliteStorage implements IStorage {
  // Customers
  getCustomers(): Customer[] {
    return db.select().from(customers).all();
  }
  getCustomer(id: number): Customer | undefined {
    return db.select().from(customers).where(eq(customers.id, id)).get();
  }
  createCustomer(customer: InsertCustomer): Customer {
    return db.insert(customers).values(customer).returning().get();
  }
  updateCustomer(id: number, data: Partial<InsertCustomer>): Customer | undefined {
    return db.update(customers).set(data).where(eq(customers.id, id)).returning().get();
  }
  deleteCustomer(id: number): void {
    // Unlink any orgs from this customer
    db.update(sfOrgs).set({ customerId: null }).where(eq(sfOrgs.customerId, id)).run();
    db.delete(customers).where(eq(customers.id, id)).run();
  }

  // Orgs
  getOrgs(): SfOrg[] {
    return db.select().from(sfOrgs).all();
  }
  getOrgsByCustomer(customerId: number): SfOrg[] {
    return db.select().from(sfOrgs).where(eq(sfOrgs.customerId, customerId)).all();
  }
  getOrg(id: number): SfOrg | undefined {
    return db.select().from(sfOrgs).where(eq(sfOrgs.id, id)).get();
  }
  createOrg(org: InsertSfOrg): SfOrg {
    return db.insert(sfOrgs).values(org).returning().get();
  }
  updateOrg(id: number, data: Partial<InsertSfOrg>): SfOrg | undefined {
    return db.update(sfOrgs).set(data).where(eq(sfOrgs.id, id)).returning().get();
  }
  deleteOrg(id: number): void {
    db.delete(sfOrgs).where(eq(sfOrgs.id, id)).run();
  }

  getRequirements(): Requirement[] {
    return db.select().from(requirements).all();
  }
  getRequirement(id: number): Requirement | undefined {
    return db.select().from(requirements).where(eq(requirements.id, id)).get();
  }
  createRequirement(req: InsertRequirement): Requirement {
    return db.insert(requirements).values(req).returning().get();
  }
  updateRequirement(id: number, data: Partial<InsertRequirement>): Requirement | undefined {
    return db.update(requirements).set(data).where(eq(requirements.id, id)).returning().get();
  }
  deleteRequirement(id: number): void {
    db.delete(requirements).where(eq(requirements.id, id)).run();
  }

  getAnalysisByRequirement(requirementId: number): Analysis | undefined {
    return db.select().from(analyses).where(eq(analyses.requirementId, requirementId)).get();
  }
  createAnalysis(analysis: InsertAnalysis): Analysis {
    return db.insert(analyses).values(analysis).returning().get();
  }

  getComponentsByRequirement(requirementId: number): MetadataComponent[] {
    return db.select().from(metadataComponents).where(eq(metadataComponents.requirementId, requirementId)).all();
  }
  getComponent(id: number): MetadataComponent | undefined {
    return db.select().from(metadataComponents).where(eq(metadataComponents.id, id)).get();
  }
  createComponent(component: InsertMetadataComponent): MetadataComponent {
    return db.insert(metadataComponents).values(component).returning().get();
  }
  updateComponent(id: number, data: Partial<InsertMetadataComponent>): MetadataComponent | undefined {
    return db.update(metadataComponents).set(data).where(eq(metadataComponents.id, id)).returning().get();
  }

  getDeployments(): Deployment[] {
    return db.select().from(deployments).all();
  }
  getDeploymentsByRequirement(requirementId: number): Deployment[] {
    return db.select().from(deployments).where(eq(deployments.requirementId, requirementId)).all();
  }
  createDeployment(deployment: InsertDeployment): Deployment {
    return db.insert(deployments).values(deployment).returning().get();
  }
  updateDeployment(id: number, data: Partial<InsertDeployment>): Deployment | undefined {
    return db.update(deployments).set(data).where(eq(deployments.id, id)).returning().get();
  }

  // Agent Runs
  getAgentRuns(): AgentRun[] {
    return db.select().from(agentRuns).orderBy(desc(agentRuns.id)).all();
  }
  getAgentRun(id: number): AgentRun | undefined {
    return db.select().from(agentRuns).where(eq(agentRuns.id, id)).get();
  }
  getAgentRunsByRequirement(requirementId: number): AgentRun[] {
    return db.select().from(agentRuns).where(eq(agentRuns.requirementId, requirementId)).orderBy(desc(agentRuns.id)).all();
  }
  createAgentRun(run: InsertAgentRun): AgentRun {
    return db.insert(agentRuns).values(run).returning().get();
  }
  updateAgentRun(id: number, data: Partial<InsertAgentRun>): AgentRun | undefined {
    return db.update(agentRuns).set(data).where(eq(agentRuns.id, id)).returning().get();
  }

  // Org Scans
  getOrgScans(orgId: number): OrgScan[] {
    return db.select().from(orgScans).where(eq(orgScans.orgId, orgId)).orderBy(desc(orgScans.id)).all();
  }
  getOrgScan(id: number): OrgScan | undefined {
    return db.select().from(orgScans).where(eq(orgScans.id, id)).get();
  }
  getLatestOrgScan(orgId: number): OrgScan | undefined {
    return db.select().from(orgScans).where(eq(orgScans.orgId, orgId)).orderBy(desc(orgScans.id)).get();
  }
  createOrgScan(scan: InsertOrgScan): OrgScan {
    return db.insert(orgScans).values(scan).returning().get();
  }
  updateOrgScan(id: number, data: Partial<InsertOrgScan>): OrgScan | undefined {
    return db.update(orgScans).set(data).where(eq(orgScans.id, id)).returning().get();
  }

  // Org Inventory
  getOrgInventory(orgId: number): OrgInventoryItem[] {
    return db.select().from(orgInventory).where(eq(orgInventory.orgId, orgId)).all();
  }
  getOrgInventoryByCategory(orgId: number, category: string): OrgInventoryItem[] {
    return db.select().from(orgInventory).where(
      and(eq(orgInventory.orgId, orgId), eq(orgInventory.category, category))
    ).all();
  }
  getOrgInventoryItem(id: number): OrgInventoryItem | undefined {
    return db.select().from(orgInventory).where(eq(orgInventory.id, id)).get();
  }
  createOrgInventoryItem(item: InsertOrgInventoryItem): OrgInventoryItem {
    return db.insert(orgInventory).values(item).returning().get();
  }
  updateOrgInventoryItem(id: number, data: Partial<InsertOrgInventoryItem>): OrgInventoryItem | undefined {
    return db.update(orgInventory).set(data).where(eq(orgInventory.id, id)).returning().get();
  }
  deleteOrgInventory(orgId: number): void {
    db.delete(orgInventory).where(eq(orgInventory.orgId, orgId)).run();
  }
  searchOrgInventory(orgId: number, query: string): OrgInventoryItem[] {
    const pattern = `%${query}%`;
    return db.select().from(orgInventory).where(
      and(
        eq(orgInventory.orgId, orgId),
        or(
          like(orgInventory.apiName, pattern),
          like(orgInventory.label, pattern),
          like(orgInventory.description, pattern),
        ),
      )
    ).all();
  }

  // Health Assessments
  getHealthAssessments(orgId: number): HealthAssessment[] {
    return db.select().from(healthAssessments).where(eq(healthAssessments.orgId, orgId)).orderBy(desc(healthAssessments.id)).all();
  }
  getHealthAssessment(id: number): HealthAssessment | undefined {
    return db.select().from(healthAssessments).where(eq(healthAssessments.id, id)).get();
  }
  getLatestHealthAssessment(orgId: number): HealthAssessment | undefined {
    return db.select().from(healthAssessments).where(eq(healthAssessments.orgId, orgId)).orderBy(desc(healthAssessments.id)).get();
  }
  createHealthAssessment(a: InsertHealthAssessment): HealthAssessment {
    return db.insert(healthAssessments).values(a).returning().get();
  }
  updateHealthAssessment(id: number, data: Partial<InsertHealthAssessment>): HealthAssessment | undefined {
    return db.update(healthAssessments).set(data).where(eq(healthAssessments.id, id)).returning().get();
  }

  // Health Findings
  getHealthFindings(assessmentId: number): HealthFinding[] {
    return db.select().from(healthFindings).where(eq(healthFindings.assessmentId, assessmentId)).all();
  }
  getHealthFindingsByCategory(assessmentId: number, category: string): HealthFinding[] {
    return db.select().from(healthFindings).where(
      and(eq(healthFindings.assessmentId, assessmentId), eq(healthFindings.category, category))
    ).all();
  }
  createHealthFinding(f: InsertHealthFinding): HealthFinding {
    return db.insert(healthFindings).values(f).returning().get();
  }
  deleteHealthFindings(assessmentId: number): void {
    db.delete(healthFindings).where(eq(healthFindings.assessmentId, assessmentId)).run();
  }

  // Change Requests
  getChangeRequests(orgId: number): ChangeRequest[] {
    return db.select().from(changeRequests).where(eq(changeRequests.orgId, orgId)).orderBy(desc(changeRequests.id)).all();
  }
  getChangeRequest(id: number): ChangeRequest | undefined {
    return db.select().from(changeRequests).where(eq(changeRequests.id, id)).get();
  }
  createChangeRequest(cr: InsertChangeRequest): ChangeRequest {
    return db.insert(changeRequests).values(cr).returning().get();
  }
  updateChangeRequest(id: number, data: Partial<InsertChangeRequest>): ChangeRequest | undefined {
    return db.update(changeRequests).set(data).where(eq(changeRequests.id, id)).returning().get();
  }
  deleteChangeRequest(id: number): void {
    db.delete(changeRequests).where(eq(changeRequests.id, id)).run();
  }
  getAllChangeRequests(): ChangeRequest[] {
    return db.select().from(changeRequests).orderBy(desc(changeRequests.id)).all();
  }
}

export const storage = new SqliteStorage();

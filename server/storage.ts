import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  sfOrgs, requirements, analyses, metadataComponents, deployments,
  type InsertSfOrg, type SfOrg,
  type InsertRequirement, type Requirement,
  type InsertAnalysis, type Analysis,
  type InsertMetadataComponent, type MetadataComponent,
  type InsertDeployment, type Deployment,
} from "@shared/schema";

const sqlite = new Database("sf_deploy.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Run migrations
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sf_orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    instance_url TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
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
`);

export interface IStorage {
  // Orgs
  getOrgs(): SfOrg[];
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
}

export class SqliteStorage implements IStorage {
  getOrgs(): SfOrg[] {
    return db.select().from(sfOrgs).all();
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
}

export const storage = new SqliteStorage();

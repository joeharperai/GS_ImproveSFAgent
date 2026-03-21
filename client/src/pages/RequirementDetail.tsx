import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ArrowLeft, Zap, Code, Rocket, CheckCircle, XCircle,
  AlertTriangle, Shield, Clock, FileCode, Loader2,
  ChevronRight, Bot, Play,
} from "lucide-react";
import type { Requirement, Analysis, MetadataComponent, AgentRun } from "@shared/schema";
import { ArchitectReviewPanel } from "@/components/ArchitectReview";

export default function RequirementDetail() {
  const params = useParams<{ id: string }>();
  const reqId = parseInt(params.id || "0");
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: requirement } = useQuery<Requirement>({
    queryKey: ["/api/requirements", reqId],
    queryFn: () => apiRequest("GET", `/api/requirements/${reqId}`).then((r) => r.json()),
  });

  const { data: analysis } = useQuery<Analysis>({
    queryKey: ["/api/requirements", reqId, "analysis"],
    queryFn: () =>
      apiRequest("GET", `/api/requirements/${reqId}/analysis`).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }),
  });

  const { data: components = [] } = useQuery<MetadataComponent[]>({
    queryKey: ["/api/requirements", reqId, "components"],
    queryFn: () => apiRequest("GET", `/api/requirements/${reqId}/components`).then((r) => r.json()),
  });

  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ["/api/orgs"],
    queryFn: () => apiRequest("GET", "/api/orgs").then((r) => r.json()),
  });

  const { data: agentRuns = [] } = useQuery<AgentRun[]>({
    queryKey: ["/api/requirements", reqId, "agent-runs"],
    queryFn: () => apiRequest("GET", `/api/requirements/${reqId}/agent-runs`).then((r) => r.json()),
    refetchInterval: 3000,
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/requirements/${reqId}/analyze`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId, "analysis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Analysis complete", description: "Review the AI analysis below" });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message || "Please try again", variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/requirements/${reqId}/generate`).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId, "components"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Metadata generated", description: "Review and approve components" });
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message || "Please try again", variant: "destructive" });
    },
  });

  const approveComponentMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/components/${id}`, { status }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId, "components"] });
    },
  });

  const agentMutation = useMutation({
    mutationFn: (orgId?: number) =>
      apiRequest("POST", "/api/agent-runs", { requirementId: reqId, orgId: orgId || null }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId, "agent-runs"] });
      toast({ title: "Agent started", description: "Redirecting to agent console..." });
      navigate("/agent");
    },
    onError: (err: any) => {
      toast({ title: "Agent failed to start", description: err.message, variant: "destructive" });
    },
  });

  const deployMutation = useMutation({
    mutationFn: (orgId: number) =>
      apiRequest("POST", `/api/requirements/${reqId}/deploy`, { orgId }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/requirements", reqId, "components"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deployments"] });
      toast({ title: "Deployment complete", description: "Components deployed to sandbox" });
    },
    onError: (err: any) => {
      toast({ title: "Deployment failed", description: err.message || "Please try again", variant: "destructive" });
    },
  });

  if (!requirement) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const parsedAnalysis = analysis
    ? {
        summary: analysis.summary,
        components: JSON.parse(analysis.componentsJson || "[]"),
        dependencies: JSON.parse(analysis.dependenciesJson || "[]"),
        bestPractices: JSON.parse(analysis.bestPracticesJson || "[]"),
        risks: JSON.parse(analysis.risksJson || "[]"),
        estimatedEffort: analysis.estimatedEffort,
      }
    : null;

  const approvedCount = components.filter((c) => c.status === "approved").length;
  const canDeploy = approvedCount > 0;
  const activeAgentRun = agentRuns.find((r) => r.status === "running");
  const hasRunBefore = agentRuns.length > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <SidebarTrigger />
          <Link href="/requirements">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{requirement.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{requirement.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={requirement.status} />
              <span className="text-xs text-muted-foreground capitalize">
                {requirement.category?.replace("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground capitalize">
                {requirement.priority} priority
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Architect Review Card — BEFORE code generation */}
      <ArchitectReviewPanel requirementId={reqId} />

      {/* Agent Deploy Card */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/[0.03] to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">Deploy with Agent</p>
                <p className="text-xs text-muted-foreground">
                  AI agent will analyze, generate, deploy, test, and auto-fix — fully autonomous
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeAgentRun ? (
                <Link href="/agent">
                  <Button size="sm" variant="outline" className="gap-1.5" data-testid="button-view-agent">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    View Live Agent
                  </Button>
                </Link>
              ) : (
                <AgentStartButton
                  orgs={orgs}
                  onStart={(orgId) => agentMutation.mutate(orgId)}
                  isPending={agentMutation.isPending}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual Action Pipeline */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manual Steps:</span>
        <Button
          data-testid="button-analyze"
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending || requirement.status === "analyzing"}
          variant={!analysis ? "default" : "outline"}
          size="sm"
        >
          {analyzeMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1.5" />
          )}
          {analyzeMutation.isPending ? "Analyzing..." : analysis ? "Re-Analyze" : "Analyze"}
        </Button>

        {analysis && (
          <Button
            data-testid="button-generate"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || requirement.status === "generating"}
            variant={components.length === 0 ? "default" : "outline"}
            size="sm"
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Code className="h-3.5 w-3.5 mr-1.5" />
            )}
            {generateMutation.isPending ? "Generating..." : components.length > 0 ? "Re-Generate" : "Generate"}
          </Button>
        )}

        {canDeploy && (
          <DeployButton
            orgs={orgs}
            onDeploy={(orgId) => deployMutation.mutate(orgId)}
            isPending={deployMutation.isPending}
          />
        )}

        {parsedAnalysis?.estimatedEffort && (
          <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Est: {parsedAnalysis.estimatedEffort}
          </span>
        )}
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue={analysis ? "analysis" : "overview"}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {analysis && <TabsTrigger value="analysis">Analysis</TabsTrigger>}
          {components.length > 0 && (
            <TabsTrigger value="components">
              Components ({components.length})
            </TabsTrigger>
          )}
          {agentRuns.length > 0 && (
            <TabsTrigger value="history">
              Agent History ({agentRuns.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Requirement Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{requirement.description}</p>
              </div>
            </CardContent>
          </Card>

          {!analysis && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                <Bot className="h-8 w-8 text-primary/40 mb-3" />
                <p className="text-sm font-medium">Ready for Deployment</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Click "Deploy with Agent" above for the fully autonomous flow, or use the manual
                  steps to analyze and generate metadata step by step.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {analysis && (
          <TabsContent value="analysis" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm" data-testid="text-analysis-summary">{parsedAnalysis?.summary}</p>
              </CardContent>
            </Card>

            {parsedAnalysis?.components?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Proposed Components ({parsedAnalysis.components.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {parsedAnalysis.components.map((comp: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                        <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-primary">{comp.order || i + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{comp.label}</p>
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {comp.type}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{comp.apiName}</p>
                          <p className="text-xs text-muted-foreground mt-1">{comp.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {parsedAnalysis?.dependencies?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Dependencies</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {parsedAnalysis.dependencies.map((dep: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span>{dep}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {parsedAnalysis?.bestPractices?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-green-500" />
                    Best Practices
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {parsedAnalysis.bestPractices.map((bp: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                        <span>{bp}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {parsedAnalysis?.risks?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    Risks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {parsedAnalysis.risks.map((risk: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg border">
                        <div className="flex items-center gap-2">
                          <SeverityDot severity={risk.severity} />
                          <p className="text-sm font-medium">{risk.risk}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 ml-4">
                          Mitigation: {risk.mitigation}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {components.length > 0 && (
          <TabsContent value="components" className="mt-4 space-y-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{approvedCount} approved</span>
              <span>·</span>
              <span>{components.filter((c) => c.status === "pending").length} pending</span>
              <span>·</span>
              <span>{components.filter((c) => c.status === "deployed").length} deployed</span>
            </div>

            {components.map((comp) => (
              <ComponentCard
                key={comp.id}
                component={comp}
                onApprove={(status) => approveComponentMutation.mutate({ id: comp.id, status })}
              />
            ))}
          </TabsContent>
        )}

        {agentRuns.length > 0 && (
          <TabsContent value="history" className="mt-4 space-y-3">
            {agentRuns.map((run) => {
              const steps = JSON.parse(run.stepsJson || "[]");
              const isSuccess = run.status === "success";
              return (
                <Card key={run.id} data-testid={`card-agent-run-${run.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                          isSuccess ? "bg-green-500/10" : run.status === "running" ? "bg-blue-500/10" : "bg-red-500/10"
                        }`}>
                          {run.status === "running" ? (
                            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                          ) : isSuccess ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">Run #{run.id}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()} · {steps.length} steps
                            {run.retryCount > 0 && ` · ${run.retryCount} retries`}
                          </p>
                        </div>
                      </div>
                      {run.status === "running" && (
                        <Link href="/agent">
                          <Button size="sm" variant="outline" className="gap-1.5">
                            <Play className="h-3 w-3" />
                            View Live
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AgentStartButton({
  orgs,
  onStart,
  isPending,
}: {
  orgs: any[];
  onStart: (orgId?: number) => void;
  isPending: boolean;
}) {
  if (orgs.length === 0) {
    return (
      <Button
        size="sm"
        onClick={() => onStart()}
        disabled={isPending}
        data-testid="button-start-agent"
        className="gap-1.5"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {isPending ? "Starting..." : "Start Agent (Demo)"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select onValueChange={(v) => onStart(parseInt(v))}>
        <SelectTrigger className="h-8 w-[180px] text-xs" data-testid="select-agent-org">
          <Bot className="h-3.5 w-3.5 mr-1" />
          <SelectValue placeholder="Select org..." />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((org) => (
            <SelectItem key={org.id} value={String(org.id)}>
              {org.name} ({org.orgType})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={() => onStart()}
        disabled={isPending}
        data-testid="button-start-agent"
        className="gap-1.5"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {isPending ? "Starting..." : "Start Agent"}
      </Button>
    </div>
  );
}

function ComponentCard({
  component,
  onApprove,
}: {
  component: MetadataComponent;
  onApprove: (status: string) => void;
}) {
  return (
    <Card data-testid={`card-component-${component.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">{component.label}</CardTitle>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {component.componentType}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {component.status === "pending" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-green-600 border-green-200 hover:bg-green-50 dark:border-green-900 dark:hover:bg-green-950"
                  onClick={() => onApprove("approved")}
                  data-testid={`button-approve-${component.id}`}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                  onClick={() => onApprove("failed")}
                  data-testid={`button-reject-${component.id}`}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Reject
                </Button>
              </>
            )}
            <ComponentStatusBadge status={component.status} />
          </div>
        </div>
        <p className="text-xs font-mono text-muted-foreground">{component.apiName}</p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px] w-full rounded-md border bg-slate-950 p-4">
          <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">
            {component.metadataXml}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function DeployButton({
  orgs,
  onDeploy,
  isPending,
}: {
  orgs: any[];
  onDeploy: (orgId: number) => void;
  isPending: boolean;
}) {
  if (orgs.length === 0) {
    return (
      <Link href="/orgs">
        <Button variant="outline" size="sm">
          <Rocket className="h-3.5 w-3.5 mr-1.5" />
          Connect Org
        </Button>
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select onValueChange={(v) => onDeploy(parseInt(v))}>
        <SelectTrigger className="h-8 w-[200px] text-xs" data-testid="select-deploy-org">
          <Rocket className="h-3.5 w-3.5 mr-1.5" />
          <SelectValue placeholder="Deploy to org..." />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((org) => (
            <SelectItem key={org.id} value={String(org.id)}>
              {org.name} ({org.orgType})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    analyzing: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    analyzed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    generating: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    ready: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
    deploying: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    deployed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
      variants[status] || variants.draft
    }`}>
      {status}
    </span>
  );
}

function ComponentStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    pending: { color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Pending" },
    approved: { color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Approved" },
    deployed: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Deployed" },
    failed: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Rejected" },
  };

  const c = config[status] || config.pending;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = { low: "bg-green-500", medium: "bg-yellow-500", high: "bg-red-500" };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colors[severity] || colors.medium}`} />;
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import {
  HeartPulse, Play, Shield, Zap, Wrench, TrendingUp, AlertTriangle,
  AlertCircle, Info, CheckCircle2, RefreshCw, Globe, Clock, Brain,
  ChevronDown, ChevronRight, Code2,
} from "lucide-react";
import type { SfOrg, HealthAssessment, HealthFinding } from "@shared/schema";

const GRADE_COLORS: Record<string, string> = {
  A: "text-green-500 border-green-500",
  B: "text-blue-500 border-blue-500",
  C: "text-yellow-500 border-yellow-500",
  D: "text-orange-500 border-orange-500",
  F: "text-red-500 border-red-500",
  "N/A": "text-muted-foreground border-muted-foreground",
};

const GRADE_BG: Record<string, string> = {
  A: "bg-green-500/10",
  B: "bg-blue-500/10",
  C: "bg-yellow-500/10",
  D: "bg-orange-500/10",
  F: "bg-red-500/10",
  "N/A": "bg-muted",
};

const SEVERITY_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10 border-red-500/20", label: "Critical" },
  warning: { icon: AlertCircle, color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", label: "Warning" },
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20", label: "Info" },
};

const CATEGORY_CONFIG: Record<string, { icon: any; color: string; label: string; key: string }> = {
  security: { icon: Shield, color: "text-red-500", label: "Security", key: "securityScore" },
  performance: { icon: Zap, color: "text-amber-500", label: "Performance", key: "performanceScore" },
  maintainability: { icon: Wrench, color: "text-blue-500", label: "Maintainability", key: "maintainabilityScore" },
  scalability: { icon: TrendingUp, color: "text-green-500", label: "Scalability", key: "scalabilityScore" },
};

const COMPLEXITY_COLORS: Record<string, string> = {
  Low: "bg-green-500/10 text-green-700 border-green-500/20",
  Moderate: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  High: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  "Very High": "bg-orange-500/10 text-orange-700 border-orange-500/20",
  Extreme: "bg-red-500/10 text-red-700 border-red-500/20",
};

export default function HealthReport() {
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [assessProgress, setAssessProgress] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  // Fetch orgs
  const { data: orgs = [] } = useQuery<SfOrg[]>({
    queryKey: ["/api/orgs"],
  });
  const connectedOrgs = orgs.filter(o => o.status === "connected");

  // Fetch assessments for selected org
  const { data: assessments = [] } = useQuery<HealthAssessment[]>({
    queryKey: ["/api/orgs", selectedOrgId, "assessments"],
    queryFn: () => apiRequest("GET", `/api/orgs/${selectedOrgId}/assessments`).then(r => r.json()),
    enabled: !!selectedOrgId,
  });

  const latestAssessment = assessments[0];

  // Fetch findings for latest assessment
  const { data: findings = [] } = useQuery<HealthFinding[]>({
    queryKey: ["/api/assessments", latestAssessment?.id, "findings"],
    queryFn: () => apiRequest("GET", `/api/assessments/${latestAssessment!.id}/findings`).then(r => r.json()),
    enabled: !!latestAssessment?.id && latestAssessment.status === "completed",
  });

  // Start assessment
  const startAssessment = useMutation({
    mutationFn: () => apiRequest("POST", `/api/orgs/${selectedOrgId}/assess`),
    onSuccess: async (res) => {
      const assessment = await res.json();
      toast({ title: "Health assessment started", description: "Analyzing org health..." });

      const eventSource = new EventSource(`/api/assessments/${assessment.id}/stream`);
      eventSource.onmessage = (event) => {
        const progress = JSON.parse(event.data);
        setAssessProgress(progress);

        if (progress.phase === "done" || progress.phase === "complete" || progress.phase === "error") {
          eventSource.close();
          setAssessProgress(null);
          queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "assessments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/assessments"] });
          queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        }
      };
      eventSource.onerror = () => {
        eventSource.close();
        setAssessProgress(null);
        queryClient.invalidateQueries({ queryKey: ["/api/orgs", selectedOrgId, "assessments"] });
      };
    },
    onError: () => {
      toast({ title: "Assessment failed", description: "Could not start health assessment", variant: "destructive" });
    },
  });

  const toggleFinding = (id: number) => {
    const next = new Set(expandedFindings);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFindings(next);
  };

  const filteredFindings = activeTab === "all"
    ? findings
    : findings.filter(f => f.category === activeTab);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-red-500" />
              Health Report
            </h1>
            <p className="text-sm text-muted-foreground">
              Assess org health against Salesforce best practices
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedOrgId} onValueChange={(v) => { setSelectedOrgId(v); setExpandedFindings(new Set()); }}>
            <SelectTrigger className="w-[240px]" data-testid="select-org">
              <SelectValue placeholder="Select an org..." />
            </SelectTrigger>
            <SelectContent>
              {connectedOrgs.map(org => (
                <SelectItem key={org.id} value={String(org.id)}>
                  <div className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-green-500" />
                    {org.name}
                  </div>
                </SelectItem>
              ))}
              {connectedOrgs.length === 0 && (
                <SelectItem value="none" disabled>No connected orgs</SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button
            onClick={() => startAssessment.mutate()}
            disabled={!selectedOrgId || startAssessment.isPending || !!assessProgress}
            data-testid="button-run-assessment"
          >
            {assessProgress ? (
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {assessProgress ? "Assessing..." : "Run Assessment"}
          </Button>
        </div>
      </div>

      {/* Progress Banner */}
      {assessProgress && (
        <Card className="border-primary/30" data-testid="card-assess-progress">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary animate-pulse" />
                <span className="text-sm font-medium">{assessProgress.message}</span>
              </div>
              <Badge variant="outline" className="text-xs">{assessProgress.phase}</Badge>
            </div>
            <Progress value={assessProgress.progress || 0} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {!selectedOrgId ? (
        <EmptyState />
      ) : !latestAssessment ? (
        <Card>
          <CardContent className="p-12 text-center">
            <HeartPulse className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-1">No Assessment Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run a health assessment to analyze this org against 30+ best practice rules.
            </p>
          </CardContent>
        </Card>
      ) : latestAssessment.status === "pending" || latestAssessment.status === "running" ? (
        <Card>
          <CardContent className="p-12 text-center">
            <RefreshCw className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-1">Assessment In Progress</h3>
            <p className="text-sm text-muted-foreground">
              Analyzing org health... This may take a minute.
            </p>
          </CardContent>
        </Card>
      ) : latestAssessment.status === "failed" ? (
        <Card className="border-red-500/30">
          <CardContent className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-medium mb-1">Assessment Failed</h3>
            <p className="text-sm text-muted-foreground">
              Something went wrong. Please try again.
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Assessment Results */
        <>
          {/* Grade + Category Scores */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Overall Grade Circle */}
            <Card className="lg:col-span-1">
              <CardContent className="pt-6 flex flex-col items-center justify-center">
                <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center ${GRADE_COLORS[latestAssessment.overallGrade] || GRADE_COLORS["N/A"]} ${GRADE_BG[latestAssessment.overallGrade] || GRADE_BG["N/A"]}`}>
                  <span className="text-4xl font-bold">{latestAssessment.overallGrade}</span>
                </div>
                <p className="text-sm font-medium mt-3">Overall Grade</p>
                <p className="text-2xl font-bold">{latestAssessment.overallScore}<span className="text-sm text-muted-foreground">/100</span></p>
              </CardContent>
            </Card>

            {/* Category Score Bars */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Category Scores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                  const score = (latestAssessment as any)[config.key] as number;
                  const Icon = config.icon;
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 ${config.color}`} />
                          <span className="text-sm font-medium">{config.label}</span>
                        </div>
                        <span className="text-sm font-bold">{score}</span>
                      </div>
                      <Progress value={score} className="h-2" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Findings Summary + Complexity */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className={`rounded-lg border p-3 text-center ${SEVERITY_CONFIG.critical.bg}`}>
                    <AlertTriangle className="h-5 w-5 text-red-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-red-500">{latestAssessment.criticalCount}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Critical</p>
                  </div>
                  <div className={`rounded-lg border p-3 text-center ${SEVERITY_CONFIG.warning.bg}`}>
                    <AlertCircle className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-yellow-500">{latestAssessment.warningCount}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Warning</p>
                  </div>
                  <div className={`rounded-lg border p-3 text-center ${SEVERITY_CONFIG.info.bg}`}>
                    <Info className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-blue-500">{latestAssessment.infoCount}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Info</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Total Findings</span>
                  <span className="text-sm font-bold">{latestAssessment.totalFindings}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Complexity</span>
                  <Badge className={`${COMPLEXITY_COLORS[latestAssessment.complexityScore || "Low"] || COMPLEXITY_COLORS.Low}`}>
                    {latestAssessment.complexityScore}
                  </Badge>
                </div>

                {latestAssessment.complexitySummary && (
                  <p className="text-xs text-muted-foreground">{latestAssessment.complexitySummary}</p>
                )}

                <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
                  <Clock className="h-3 w-3" />
                  {latestAssessment.completedAt
                    ? new Date(latestAssessment.completedAt).toLocaleString()
                    : new Date(latestAssessment.startedAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Findings List with Tabs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Findings ({findings.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                  <TabsTrigger value="all">
                    All ({findings.length})
                  </TabsTrigger>
                  {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                    const count = findings.filter(f => f.category === key).length;
                    const Icon = config.icon;
                    return (
                      <TabsTrigger key={key} value={key} className="gap-1.5">
                        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                        {config.label} ({count})
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                <div className="mt-4">
                  {filteredFindings.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                      No findings in this category. Great job!
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[600px]">
                      <div className="space-y-2">
                        {filteredFindings.map((finding) => {
                          const sev = SEVERITY_CONFIG[finding.severity] || SEVERITY_CONFIG.info;
                          const SevIcon = sev.icon;
                          const isExpanded = expandedFindings.has(finding.id);
                          const catConfig = CATEGORY_CONFIG[finding.category];
                          const CatIcon = catConfig?.icon || Shield;

                          return (
                            <div
                              key={finding.id}
                              className={`rounded-lg border ${sev.bg} transition-colors`}
                              data-testid={`finding-${finding.id}`}
                            >
                              <button
                                className="w-full text-left px-4 py-3 flex items-start gap-3"
                                onClick={() => toggleFinding(finding.id)}
                              >
                                <SevIcon className={`h-4 w-4 mt-0.5 ${sev.color} flex-shrink-0`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium">{finding.title}</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      {finding.ruleId}
                                    </Badge>
                                    {finding.componentApiName && (
                                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                                        {finding.componentApiName}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                    {finding.description}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <CatIcon className={`h-3.5 w-3.5 ${catConfig?.color || "text-muted-foreground"}`} />
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                              </button>

                              {isExpanded && (
                                <div className="px-4 pb-4 pt-0 ml-7 space-y-3 border-t border-border/50 mt-1 pt-3">
                                  <div>
                                    <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</label>
                                    <p className="text-sm mt-0.5">{finding.description}</p>
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recommendation</label>
                                    <p className="text-sm mt-0.5">{finding.recommendation}</p>
                                  </div>
                                  {finding.componentType && (
                                    <div className="flex items-center gap-4">
                                      {finding.componentType && (
                                        <div>
                                          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Component Type</label>
                                          <p className="text-sm mt-0.5">{finding.componentType}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {finding.codeSnippet && (
                                    <div>
                                      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                        <Code2 className="h-3 w-3" /> Code Snippet
                                      </label>
                                      <pre className="mt-1 p-3 rounded-md bg-zinc-950 text-zinc-100 text-xs overflow-x-auto max-h-40 font-mono leading-relaxed">
                                        <code>{finding.codeSnippet}</code>
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <HeartPulse className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Org Health Assessment</h2>
        <p className="text-sm text-muted-foreground">
          Select a connected Salesforce org to run a health assessment. The engine checks 30+ rules covering security, performance, maintainability, and scalability.
        </p>
      </div>
    </div>
  );
}

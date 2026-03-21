import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Link } from "wouter";
import {
  FileText, Cloud, Rocket, CheckCircle, Clock, AlertTriangle,
  ArrowRight, Zap, TrendingUp, Bot, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentRun } from "@shared/schema";

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/stats"],
    queryFn: () => apiRequest("GET", "/api/stats").then((r) => r.json()),
  });

  const { data: reqs } = useQuery<any[]>({
    queryKey: ["/api/requirements"],
    queryFn: () => apiRequest("GET", "/api/requirements").then((r) => r.json()),
  });

  const { data: agentRuns = [] } = useQuery<AgentRun[]>({
    queryKey: ["/api/agent-runs"],
    queryFn: () => apiRequest("GET", "/api/agent-runs").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const recentReqs = (reqs || []).slice(-5).reverse();
  const activeRun = agentRuns.find((r) => r.status === "running");

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Autonomous Salesforce deployment overview
            </p>
          </div>
        </div>
        <Link href="/requirements">
          <Button data-testid="button-new-requirement" size="sm">
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            New Requirement
          </Button>
        </Link>
      </div>

      {/* Active Agent Banner */}
      {activeRun && (
        <Link href="/agent">
          <Card className="border-primary/30 bg-gradient-to-r from-primary/[0.05] to-transparent cursor-pointer hover:border-primary/50 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Bot className="h-5 w-5 text-primary animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      Agent Running
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requirement #{activeRun.requirementId} · Phase: {activeRun.phase} · Retry {activeRun.retryCount}/{activeRun.maxRetries}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  View Console
                </Button>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Requirements</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold" data-testid="text-total-requirements">
                    {stats?.totalRequirements || 0}
                  </p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Agent Runs</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold" data-testid="text-agent-runs">
                    {stats?.successfulAgentRuns || 0}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{stats?.totalAgentRuns || 0}
                    </span>
                  </p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Connected Orgs</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold" data-testid="text-connected-orgs">
                    {stats?.connectedOrgs || 0}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{stats?.totalOrgs || 0}
                    </span>
                  </p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Cloud className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Success Rate</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <p className="text-2xl font-bold" data-testid="text-success-rate">
                    {stats?.totalDeployments
                      ? Math.round((stats.successfulDeployments / stats.totalDeployments) * 100)
                      : 0}%
                  </p>
                )}
              </div>
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Status */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Draft", count: stats.byStatus?.draft || 0, color: "bg-slate-500" },
                { label: "Analyzing", count: stats.byStatus?.analyzing || 0, color: "bg-yellow-500" },
                { label: "Analyzed", count: stats.byStatus?.analyzed || 0, color: "bg-blue-500" },
                { label: "Generating", count: stats.byStatus?.generating || 0, color: "bg-purple-500" },
                { label: "Ready", count: stats.byStatus?.ready || 0, color: "bg-cyan-500" },
                { label: "Deploying", count: stats.byStatus?.deploying || 0, color: "bg-orange-500" },
                { label: "Deployed", count: stats.byStatus?.deployed || 0, color: "bg-green-500" },
                { label: "Failed", count: stats.byStatus?.failed || 0, color: "bg-red-500" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${s.color}`} />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* How It Works — Agent-first */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How the Agent Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            {[
              { step: 1, title: "Describe", desc: "Plain English requirement", icon: FileText },
              { step: 2, title: "Analyze", desc: "AI architects the solution", icon: Zap },
              { step: 3, title: "Generate", desc: "Metadata XML, Apex, LWC", icon: Bot },
              { step: 4, title: "Deploy", desc: "Push to sandbox via API", icon: Rocket },
              { step: 5, title: "Test", desc: "Run Apex tests automatically", icon: CheckCircle },
              { step: 6, title: "Fix & Retry", desc: "Auto-fix errors and redeploy", icon: AlertTriangle },
            ].map((item, i) => (
              <div key={item.step} className="flex flex-col items-center text-center relative">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <item.icon className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                {i < 5 && (
                  <ArrowRight className="hidden md:block h-4 w-4 text-muted-foreground/40 absolute -right-2 top-3" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Requirements */}
      {recentReqs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Requirements</CardTitle>
            <Link href="/requirements">
              <Button variant="ghost" size="sm">
                View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentReqs.map((r: any) => (
                <Link key={r.id} href={`/requirements/${r.id}`}>
                  <div
                    data-testid={`card-requirement-${r.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon status={r.status} />
                      <div>
                        <p className="text-sm font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {r.category?.replace("_", " ")}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "deployed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "analyzing":
    case "generating":
    case "deploying":
      return <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
      variants[status] || variants.draft
    }`}>
      {status}
    </span>
  );
}

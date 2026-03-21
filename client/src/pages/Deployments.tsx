import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Rocket, CheckCircle, XCircle, Clock, AlertTriangle,
} from "lucide-react";
import type { Deployment } from "@shared/schema";

export default function Deployments() {
  const { data: deployments = [], isLoading } = useQuery<Deployment[]>({
    queryKey: ["/api/deployments"],
    queryFn: () => apiRequest("GET", "/api/deployments").then((r) => r.json()),
  });

  const { data: orgs = [] } = useQuery<any[]>({
    queryKey: ["/api/orgs"],
    queryFn: () => apiRequest("GET", "/api/orgs").then((r) => r.json()),
  });

  const { data: requirements = [] } = useQuery<any[]>({
    queryKey: ["/api/requirements"],
    queryFn: () => apiRequest("GET", "/api/requirements").then((r) => r.json()),
  });

  const getOrgName = (id: number) => orgs.find((o) => o.id === id)?.name || "Unknown Org";
  const getReqTitle = (id: number) => requirements.find((r) => r.id === id)?.title || "Unknown Requirement";

  const sorted = [...deployments].reverse();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deployments</h1>
          <p className="text-sm text-muted-foreground">
            Deployment history and logs
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-20 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Rocket className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No deployments yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Analyze and approve requirements, then deploy to a connected org
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sorted.map((dep) => {
            const logs = JSON.parse(dep.logJson || "[]");
            const componentIds = JSON.parse(dep.componentsJson || "[]");

            return (
              <Card key={dep.id} data-testid={`card-deployment-${dep.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DeployStatusIcon status={dep.status} />
                      <div>
                        <CardTitle className="text-sm">
                          {getReqTitle(dep.requirementId)}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Deployed to {getOrgName(dep.orgId)} · {componentIds.length} components
                        </p>
                      </div>
                    </div>
                    <DeployStatusBadge status={dep.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <span>Started: {new Date(dep.startedAt).toLocaleString()}</span>
                    {dep.completedAt && (
                      <span>Completed: {new Date(dep.completedAt).toLocaleString()}</span>
                    )}
                  </div>
                  <ScrollArea className="h-[160px] w-full rounded-md border bg-slate-950 p-3">
                    <div className="space-y-1">
                      {logs.map((log: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs font-mono">
                          <span className="text-slate-500 shrink-0">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <LogIcon level={log.level} />
                          <span
                            className={
                              log.level === "error"
                                ? "text-red-400"
                                : log.level === "success"
                                ? "text-green-400"
                                : "text-slate-300"
                            }
                          >
                            {log.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DeployStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500" />;
    case "partial":
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case "in_progress":
      return <Clock className="h-5 w-5 text-blue-500 animate-pulse" />;
    default:
      return <Rocket className="h-5 w-5 text-muted-foreground" />;
  }
}

function DeployStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    pending: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    success: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    partial: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    rolled_back: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
        config[status] || config.pending
      }`}
    >
      {status?.replace("_", " ")}
    </span>
  );
}

function LogIcon({ level }: { level: string }) {
  switch (level) {
    case "success":
      return <span className="text-green-400 shrink-0">●</span>;
    case "error":
      return <span className="text-red-400 shrink-0">●</span>;
    case "warning":
      return <span className="text-yellow-400 shrink-0">●</span>;
    default:
      return <span className="text-blue-400 shrink-0">●</span>;
  }
}

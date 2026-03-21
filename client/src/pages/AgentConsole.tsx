import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Link } from "wouter";
import {
  Bot, Terminal, CheckCircle, XCircle, AlertTriangle, Loader2,
  Brain, Code, Rocket, TestTube, Wrench, ArrowRight, Clock,
  Activity, Zap,
} from "lucide-react";
import type { AgentRun, AgentStep } from "@shared/schema";

const API_BASE = "";

export default function AgentConsole() {
  const { data: runs = [], isLoading } = useQuery<AgentRun[]>({
    queryKey: ["/api/agent-runs"],
    queryFn: () => apiRequest("GET", "/api/agent-runs").then((r) => r.json()),
    refetchInterval: 5000,
  });

  const activeRun = runs.find((r) => r.status === "running");
  const completedRuns = runs.filter((r) => r.status !== "running" && r.status !== "pending");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Agent Console</h1>
            <p className="text-sm text-muted-foreground">
              Real-time view of autonomous deployment agents
            </p>
          </div>
        </div>
        {activeRun && (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 animate-pulse gap-1.5">
            <Activity className="h-3 w-3" />
            Agent Running
          </Badge>
        )}
      </div>

      {/* Active Run — Live Stream */}
      {activeRun && <LiveAgentStream run={activeRun} />}

      {/* No active run */}
      {!activeRun && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bot className="h-10 w-10 text-primary/30 mb-3" />
            <p className="text-sm font-medium">No active agent runs</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Start an agent from any requirement page. The agent will analyze, generate metadata,
              deploy to your org, run tests, and auto-fix any failures.
            </p>
            <Link href="/requirements">
              <Button size="sm" className="mt-4" data-testid="button-go-to-requirements">
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Go to Requirements
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Past Runs */}
      {completedRuns.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Past Runs</h2>
          {completedRuns.map((run) => (
            <PastRunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveAgentStream({ run }: { run: AgentRun }) {
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load existing steps
    const existing: AgentStep[] = JSON.parse(run.stepsJson || "[]");
    setSteps(existing);

    // Connect to SSE stream
    const url = `${API_BASE}/api/agent-runs/${run.id}/stream`;
    const evtSource = new EventSource(url);

    evtSource.onmessage = (event) => {
      try {
        const step = JSON.parse(event.data);
        if (step.type === "done") {
          evtSource.close();
          return;
        }
        setSteps((prev) => {
          // Deduplicate by id
          if (prev.some((s) => s.id === step.id)) return prev;
          return [...prev, step];
        });
      } catch {}
    };

    evtSource.onerror = () => {
      evtSource.close();
    };

    return () => evtSource.close();
  }, [run.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [steps]);

  const currentPhase = steps.length > 0 ? steps[steps.length - 1].phase : run.phase;

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Agent Run #{run.id}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Requirement #{run.requirementId} → Org #{run.orgId || "auto"}
              </p>
            </div>
          </div>
          <PhaseIndicator phase={currentPhase} />
        </div>

        {/* Phase Progress Bar */}
        <div className="flex items-center gap-1 mt-3">
          {["init", "analyzing", "generating", "deploying", "testing", "complete"].map((p, i) => {
            const phases = ["init", "analyzing", "generating", "deploying", "testing", "fixing", "complete"];
            const currentIdx = phases.indexOf(currentPhase);
            const thisIdx = phases.indexOf(p);
            const isActive = thisIdx <= currentIdx;
            const isCurrent = p === currentPhase;
            return (
              <div key={p} className="flex items-center gap-1 flex-1">
                <div
                  className={`h-1.5 w-full rounded-full transition-all duration-500 ${
                    isCurrent ? "bg-primary animate-pulse" : isActive ? "bg-primary" : "bg-muted"
                  }`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
          <span>Init</span>
          <span>Analyze</span>
          <span>Generate</span>
          <span>Deploy</span>
          <span>Test</span>
          <span>Done</span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div
          ref={scrollRef}
          className="h-[400px] overflow-y-auto bg-slate-950 rounded-b-lg p-4 font-mono text-xs space-y-1.5"
          data-testid="agent-console-output"
        >
          {steps.map((step) => (
            <StepLine key={step.id} step={step} />
          ))}
          {run.status === "running" && (
            <div className="flex items-center gap-2 text-slate-400 animate-pulse pt-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Agent working...</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StepLine({ step }: { step: AgentStep }) {
  const iconMap: Record<string, typeof CheckCircle> = {
    info: ArrowRight,
    success: CheckCircle,
    warning: AlertTriangle,
    error: XCircle,
    thinking: Brain,
  };
  const colorMap: Record<string, string> = {
    info: "text-slate-400",
    success: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-red-400",
    thinking: "text-blue-400",
  };
  const phaseIconMap: Record<string, typeof Bot> = {
    init: Terminal,
    analyzing: Brain,
    generating: Code,
    deploying: Rocket,
    testing: TestTube,
    fixing: Wrench,
    complete: CheckCircle,
  };

  const Icon = iconMap[step.status] || ArrowRight;
  const PhaseIcon = phaseIconMap[step.phase] || Terminal;
  const color = colorMap[step.status] || "text-slate-400";

  const time = new Date(step.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <div className={`flex items-start gap-2 ${color}`}>
      <span className="text-slate-600 shrink-0 w-[60px]">{time}</span>
      <PhaseIcon className="h-3 w-3 shrink-0 mt-0.5 opacity-50" />
      <Icon className="h-3 w-3 shrink-0 mt-0.5" />
      <span className="break-words">{step.detail}</span>
    </div>
  );
}

function PhaseIndicator({ phase }: { phase: string }) {
  const config: Record<string, { label: string; color: string; icon: typeof Bot }> = {
    init: { label: "Initializing", color: "bg-slate-500/10 text-slate-500 border-slate-500/20", icon: Terminal },
    analyzing: { label: "Analyzing", color: "bg-blue-500/10 text-blue-500 border-blue-500/20", icon: Brain },
    generating: { label: "Generating", color: "bg-purple-500/10 text-purple-500 border-purple-500/20", icon: Code },
    deploying: { label: "Deploying", color: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: Rocket },
    testing: { label: "Testing", color: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20", icon: TestTube },
    fixing: { label: "Fixing", color: "bg-amber-500/10 text-amber-500 border-amber-500/20", icon: Wrench },
    complete: { label: "Complete", color: "bg-green-500/10 text-green-500 border-green-500/20", icon: CheckCircle },
  };

  const c = config[phase] || config.init;
  const Icon = c.icon;

  return (
    <Badge variant="outline" className={`${c.color} gap-1`}>
      <Icon className="h-3 w-3" />
      {c.label}
    </Badge>
  );
}

function PastRunCard({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const steps: AgentStep[] = JSON.parse(run.stepsJson || "[]");
  const isSuccess = run.status === "success";

  return (
    <Card data-testid={`card-agent-run-${run.id}`}>
      <CardContent className="p-4">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              isSuccess ? "bg-green-500/10" : "bg-red-500/10"
            }`}>
              {isSuccess ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium">
                Run #{run.id} — Requirement #{run.requirementId}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
                {run.completedAt && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.round(
                        (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
                      )}s
                    </span>
                  </>
                )}
                {run.retryCount > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-amber-500">{run.retryCount} retries</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={isSuccess
              ? "bg-green-500/10 text-green-600 border-green-500/20"
              : "bg-red-500/10 text-red-600 border-red-500/20"
            }
          >
            {run.status}
          </Badge>
        </div>

        {expanded && steps.length > 0 && (
          <div className="mt-3 bg-slate-950 rounded-lg p-3 font-mono text-xs space-y-1 max-h-[300px] overflow-y-auto">
            {steps.map((step) => (
              <StepLine key={step.id} step={step} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

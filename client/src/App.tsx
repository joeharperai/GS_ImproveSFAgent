import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppSidebar } from "./components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AuthProvider, useAuth } from "./lib/auth";
import Dashboard from "./pages/Dashboard";
import Requirements from "./pages/Requirements";
import RequirementDetail from "./pages/RequirementDetail";
import OrgConnections from "./pages/OrgConnections";
import Deployments from "./pages/Deployments";
import AgentConsole from "./pages/AgentConsole";
import Customers from "./pages/Customers";
import OrgDiscovery from "./pages/OrgDiscovery";
import HealthReport from "./pages/HealthReport";
import ContextualUpdates from "./pages/ContextualUpdates";
import Auth from "./pages/Auth";
import NotFound from "./pages/not-found";

function AppRoutes() {
  return (
    <Router hook={useHashLocation}>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/customers" component={Customers} />
              <Route path="/requirements" component={Requirements} />
              <Route path="/requirements/:id" component={RequirementDetail} />
              <Route path="/discovery" component={OrgDiscovery} />
              <Route path="/health" component={HealthReport} />
              <Route path="/changes" component={ContextualUpdates} />
              <Route path="/changes/:id" component={ContextualUpdates} />
              <Route path="/orgs" component={OrgConnections} />
              <Route path="/deployments" component={Deployments} />
              <Route path="/agent" component={AgentConsole} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </SidebarProvider>
    </Router>
  );
}

function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return <AppRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

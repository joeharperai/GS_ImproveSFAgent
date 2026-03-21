import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AppSidebar } from "./components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import Dashboard from "./pages/Dashboard";
import Requirements from "./pages/Requirements";
import RequirementDetail from "./pages/RequirementDetail";
import OrgConnections from "./pages/OrgConnections";
import Deployments from "./pages/Deployments";
import NotFound from "./pages/not-found";

function AppRoutes() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto">
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/requirements" component={Requirements} />
              <Route path="/requirements/:id" component={RequirementDetail} />
              <Route path="/orgs" component={OrgConnections} />
              <Route path="/deployments" component={Deployments} />
              <Route component={NotFound} />
            </Switch>
          </Router>
        </main>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;

import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { LayoutDashboard, FileText, Cloud, Rocket, Bot, Terminal } from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Requirements", href: "/requirements", icon: FileText },
  { label: "Agent Console", href: "/agent", icon: Terminal },
  { label: "Org Connections", href: "/orgs", icon: Cloud },
  { label: "Deployments", href: "/deployments", icon: Rocket },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-border/50 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SFLogo />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">SF Deploy Agent</h1>
            <p className="text-[11px] text-muted-foreground">Autonomous Salesforce Builder</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? location === "/"
                    : location.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-border/50">
        <PerplexityAttribution />
      </SidebarFooter>
    </Sidebar>
  );
}

function SFLogo() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="SF Deploy Agent"
    >
      <path d="M12 2L4 7v10l8 5 8-5V7l-8-5Z" />
      <path d="M12 22V12" />
      <path d="M20 7l-8 5" />
      <path d="M4 7l8 5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

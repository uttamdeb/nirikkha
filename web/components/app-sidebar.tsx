"use client";

import {
  BookOpenIcon,
  ClipboardCheckIcon,
  FilePlus2Icon,
  InboxIcon,
  LayoutDashboardIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { usePrefs } from "@/lib/i18n";
import { useAuth } from "@/components/providers";

export function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { t } = usePrefs();
  const { session, isTeacher } = useAuth();
  const email = session?.user.email ?? "";
  const name =
    (session?.user.user_metadata?.full_name as string | undefined) ||
    email.split("@")[0] ||
    t("brand");

  const studentItems = [
    {
      title: t("navNew"),
      url: "/submit",
      icon: <FilePlus2Icon />,
      items: [] as { title: string; url: string }[],
    },
    {
      title: t("navMine"),
      url: "/inbox",
      icon: <InboxIcon />,
      items: [],
    },
  ];

  const teacherItems = [
    {
      title: t("navPanel"),
      url: "/",
      icon: <LayoutDashboardIcon />,
      items: [] as { title: string; url: string }[],
    },
    {
      title: t("navReview"),
      url: "/review",
      icon: <ClipboardCheckIcon />,
      items: [],
    },
    {
      title: t("navBatches"),
      url: "/batches",
      icon: <UsersIcon />,
      items: [],
    },
    {
      title: t("navExams"),
      url: "/exams",
      icon: <BookOpenIcon />,
      items: [
        { title: t("allExams"), url: "/exams" },
        { title: t("createExam"), url: "/exams/new" },
      ],
    },
    {
      title: t("navSettings"),
      url: "/settings",
      icon: <Settings2Icon />,
      items: [],
    },
    ...studentItems,
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={isTeacher ? "/" : "/submit"}>
                <BrandMark size="sm" className="rounded-lg" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-heading font-semibold">
                    {t("brand")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("hitlSubtitle")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={isTeacher ? teacherItems : studentItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name,
            email,
            avatar: "",
            isTeacher,
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

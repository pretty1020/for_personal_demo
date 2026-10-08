import { AppShell } from "@/components/app-shell";
import { DqAuthProvider } from "@/components/dq-auth-provider";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <DqAuthProvider>
      <AppShell>{children}</AppShell>
    </DqAuthProvider>
  );
}

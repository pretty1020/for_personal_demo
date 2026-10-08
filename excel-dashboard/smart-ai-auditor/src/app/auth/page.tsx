import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-navy-950 px-4 py-16 text-center text-sm text-cream-200">
          Loading…
        </div>
      }
    >
      <AuthForm />
    </Suspense>
  );
}

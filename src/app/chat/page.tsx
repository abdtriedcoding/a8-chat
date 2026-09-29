import { redirect } from "next/navigation";
import { ViewerCard } from "@/components/auth/viewer-card";
import { isAuthenticated } from "@/lib/auth-server";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/sign-in");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <ViewerCard />
    </main>
  );
}

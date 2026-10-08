import type { Metadata } from "next";
import { SignInDone } from "@/components/apps/sign-in-done";

export const metadata: Metadata = { title: "Connecting an app" };

/**
 * Where an app's sign-in ends (see convex/connections.ts). It has no
 * sidebar, because it usually opens in a popup.
 */
export default async function SignInCallbackPage(
  props: PageProps<"/apps/callback">,
) {
  const params = await props.searchParams;
  const param = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : null;
  };
  return (
    <SignInDone
      state={param("state")}
      result={param("result")}
      connector={param("connector")}
      returnPath={param("returnPath")}
    />
  );
}

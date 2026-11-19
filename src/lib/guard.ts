import { redirect } from "next/navigation";
import { getCurrentUser } from "./session-cookie";
import { getSettings } from "./settings";
import { userCount, type SessionUser } from "./auth";

type Need = "read" | "edit" | "admin" | "user" | "none";

/** Server-component gate. Every page declares what it needs; the checks can't be forgotten. */
export async function gate(need: Need, opts: { allowPending2fa?: boolean } = {}): Promise<SessionUser | null> {
  if ((await userCount()) === 0) redirect("/setup");
  const user = await getCurrentUser();
  if (user?.needs2faSetup && !opts.allowPending2fa) redirect("/account");
  if (need === "read" && !user && !(await getSettings()).public_read) redirect("/login");
  if (need !== "read" && need !== "none" && !user) redirect("/login");
  if (need === "edit" && user?.role === "viewer") redirect("/");
  if (need === "admin" && user?.role !== "admin") redirect("/");
  return user;
}

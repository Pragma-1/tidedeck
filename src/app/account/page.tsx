import { Shell } from "@/components/shell";
import { AccountPanel } from "@/components/account-panel";
import { gate } from "@/lib/guard";
import { getSettings } from "@/lib/settings";
import { listDevices, listSessions, recoveryCodesLeft, sessionHandle } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { ROLE_LABELS } from "@/lib/roles";
import { policyFromSettings } from "@/lib/password-policy";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Your account") };
}

export default async function Account() {
  const user = (await gate("user", { allowPending2fa: true }))!;
  const cfg = await getSettings();
  const t = await getT();
  // Only derived handles leave the server, never the stored session hashes.
  const sessions = (await listSessions(user.id)).map((s) => ({
    handle: sessionHandle(s.id_hash),
    current: s.id_hash === user.sessionHash,
    created_at: s.created_at,
    last_seen: s.last_seen,
    ip: s.ip,
    user_agent: s.user_agent,
  }));
  return (
    <Shell live={false} wide>
      <h1 style={{ marginTop: 0 }}>{user.username}</h1>
      <p className="meta" style={{ marginTop: "-.4rem" }}>
        {user.email} · <span className="badge">{t(ROLE_LABELS[user.role])}</span>
        {user.isOwner && (
          <>
            {" "}
            <span className="badge owner">{t("Owner")}</span>
          </>
        )}
      </p>
      <AccountPanel
        username={user.username}
        email={user.email}
        policy={policyFromSettings(cfg)}
        devices={await listDevices(user.id)}
        required={user.mfaRequired}
        codesLeft={await recoveryCodesLeft(user.id)}
        isOwner={user.isOwner}
        sessions={sessions}
      />
    </Shell>
  );
}

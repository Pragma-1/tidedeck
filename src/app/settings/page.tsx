import Link from "next/link";
import {
  ArrowLeftRight,
  DatabaseBackup,
  History,
  Images,
  Mail,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { SettingsPanel } from "@/components/settings-panel";
import { UsersPanel } from "@/components/users-panel";
import { AuditLog } from "@/components/audit-log";
import { LegalEditor } from "@/components/legal-editor";
import { MediaPanel } from "@/components/media-panel";
import { DataPanel } from "@/components/data-panel";
import { BackupsPanel } from "@/components/backups-panel";
import { backupRoots, DEFAULT_BACKUP_DIR, hasS3Secret, listBackups, localBackupDir } from "@/lib/backup";
import { HttpError } from "@/lib/validate";
import { DATA_DIR, LIMITS } from "@/lib/config";
import { getTree, type TreeNode } from "@/lib/pages";
import { formatDate } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { statSync } from "node:fs";
import { all, sql } from "@/lib/db";
import { enabledLegalKeys, missingOperatorFields } from "@/lib/legal";
import { listMedia, mediaUsage } from "@/lib/media";
import { gate } from "@/lib/guard";
import { getSettings, settingsForClient } from "@/lib/settings";
import { listUsers } from "@/lib/admin";
import { queryAudit } from "@/lib/audit";
import { hasSmtpPassword, isMailConfigured, mailSource } from "@/lib/mail";
import { MailPanel } from "@/components/mail-panel";
import { policyFromSettings } from "@/lib/password-policy";
import { canSetMfaFor, MFA_SETTING, ROLES } from "@/lib/roles";
import { getT } from "@/lib/i18n-server";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Settings") };
}

const TABS = ["general", "security", "mail", "people", "legal", "media", "data", "backups", "log"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await gate("admin"))!;
  const t = await getT();
  const raw = (await searchParams).tab;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "general";
  const cfg = settingsForClient(await getSettings(), user.isOwner);
  const users = await listUsers();
  const locked = users.filter((u) => u.locked_until).length;
  const tabs: { id: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { id: "general", label: t("General"), icon: SlidersHorizontal },
    { id: "security", label: t("Security"), icon: ShieldCheck },
    { id: "mail", label: t("E-mail"), icon: Mail },
    { id: "people", label: t("People"), icon: Users, badge: locked || undefined },
    { id: "legal", label: t("Legal"), icon: Scale },
    { id: "media", label: t("Media"), icon: Images },
    { id: "data", label: t("Import & export"), icon: ArrowLeftRight },
    { id: "backups", label: t("Backups"), icon: DatabaseBackup },
    { id: "log", label: t("Security log"), icon: History },
  ];
  return (
    <Shell live={false} wide>
      <h1 style={{ marginTop: 0 }}>{t("Settings")}</h1>
      <nav className="tabbar" aria-label={t("Settings sections")}>
        {tabs.map((x) => (
          <Link
            key={x.id}
            href={`/settings?tab=${x.id}`}
            aria-current={tab === x.id ? "page" : undefined}
            scroll={false}
          >
            <x.icon size={16} aria-hidden />
            {x.label}
            {x.badge ? (
              <span className="badge danger" title={t("locked accounts")}>
                {x.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      {tab === "general" && (
        <>
          {!(await isMailConfigured()) && (
            <div className="notice">
              <div>
                {t("E-mail isn’t configured, so password reset links can’t be sent.")}{" "}
                <Link href="/settings?tab=mail">{t("Set up e-mail")}</Link>.{" "}
                {t("Until then you can set new passwords for people under People.")}
              </div>
            </div>
          )}
          <SettingsPanel initial={cfg} />
        </>
      )}
      {tab === "security" && (
        <SettingsPanel
          initial={cfg}
          group="security"
          locked={ROLES.filter((r) => !canSetMfaFor(user, r)).map((r) => MFA_SETTING[r])}
        />
      )}
      {tab === "mail" && (
        <MailPanel
          adminEmail={user.email}
          siteName={cfg.site_name}
          envConfigured={!!process.env.SMTP_HOST}
          initial={{
            smtp_host: cfg.smtp_host,
            smtp_port: cfg.smtp_port,
            smtp_security: cfg.smtp_security,
            smtp_user: cfg.smtp_user,
            smtp_from: cfg.smtp_from,
            smtp_allow_self_signed: cfg.smtp_allow_self_signed,
            smtp_password_set: await hasSmtpPassword(),
            mail_source: await mailSource(),
          }}
        />
      )}
      {tab === "people" && (
        <UsersPanel users={users} me={{ id: user.id, isOwner: user.isOwner }} policy={policyFromSettings(cfg)} />
      )}
      {tab === "legal" &&
        (await (async () => {
          const rows = await all<{ key: string; lang: "de" | "en"; updated_at: number }>(
            sql`SELECT key, lang, updated_at FROM legal_pages`,
          );
          const pages = enabledLegalKeys(cfg).map((key) => ({
            key,
            custom: {
              de: rows.find((r) => r.key === key && r.lang === "de")?.updated_at ?? null,
              en: rows.find((r) => r.key === key && r.lang === "en")?.updated_at ?? null,
            },
          }));
          return (
            <>
              <SettingsPanel initial={cfg} group="legal" />
              <div style={{ marginTop: "1.25rem" }}>
                <LegalEditor pages={pages} missing={await missingOperatorFields()} />
              </div>
            </>
          );
        })())}
      {tab === "data" &&
        (await (async () => {
          // existing pages a part of an import can be put under, in tree order with their level
          const flat: { id: number; title: string; depth: number }[] = [];
          const walk = (ns: TreeNode[], d: number) => {
            for (const n of ns) {
              flat.push({ id: n.id, title: n.title, depth: d });
              walk(n.children, d + 1);
            }
          };
          walk(await getTree(), 1);
          return <DataPanel pages={flat} maxDepth={LIMITS.maxPageDepth} />;
        })())}
      {tab === "backups" &&
        (await (async () => {
          const lang = await getLang();
          const dev = (p: string) => {
            try {
              return statSync(p).dev;
            } catch {
              return null;
            }
          };
          let list: Awaited<ReturnType<typeof listBackups>> | null = null;
          let error: string | null = null;
          try {
            list = await listBackups();
          } catch (e) {
            // only our own, translatable messages reach the page; anything else is in the server log
            if (!(e instanceof HttpError)) console.error("[backup] list:", e instanceof Error ? e.message : e);
            error = e instanceof HttpError ? e.message : "";
          }
          const items = (list?.items ?? []).map((b) => ({
            id: b.id,
            when: formatDate(b.created_at, lang),
            original: b.original_created_at ? formatDate(b.original_created_at, lang) : undefined,
            reason: b.reason,
            size: b.data_size + b.media_bytes,
            media_count: b.media_count,
            counts: b.counts,
          }));
          const localDir = localBackupDir(cfg);
          const bd = dev(localDir);
          return (
            <>
              <SettingsPanel
                initial={cfg}
                group="backups"
                locked={user.isOwner ? [] : ["backup_enabled", "backup_interval_hours", "backup_keep"]}
              />
              <div style={{ marginTop: "1.25rem" }}>
                <BackupsPanel
                  items={items}
                  unreadable={list?.unreadable ?? 0}
                  listError={error}
                  isOwner={user.isOwner}
                  enabled={cfg.backup_enabled}
                  target={{
                    kind: cfg.backup_target,
                    where:
                      list?.where ??
                      (cfg.backup_target === "s3" ? `s3://${cfg.backup_s3_bucket}/${cfg.backup_s3_prefix}` : localDir),
                    localDir,
                    localDefault: DEFAULT_BACKUP_DIR(),
                    localCustom: cfg.backup_local_dir,
                    localRoots: backupRoots(),
                    sameVolume: cfg.backup_target === "local" && bd !== null && bd === dev(DATA_DIR),
                    // connection details only for the owner
                    s3: user.isOwner
                      ? {
                          endpoint: cfg.backup_s3_endpoint,
                          region: cfg.backup_s3_region,
                          bucket: cfg.backup_s3_bucket,
                          prefix: cfg.backup_s3_prefix,
                          access_key: cfg.backup_s3_access_key,
                          path_style: cfg.backup_s3_path_style,
                          secret_set: await hasS3Secret(),
                        }
                      : {
                          endpoint: "",
                          region: "",
                          bucket: "",
                          prefix: "",
                          access_key: "",
                          path_style: true,
                          secret_set: false,
                        },
                  }}
                />
              </div>
            </>
          );
        })())}
      {tab === "media" && <MediaPanel files={await listMedia()} {...await mediaUsage()} />}
      {tab === "log" && (
        <AuditLog
          initial={await queryAudit({ limit: 50 })}
          users={users.map((u) => ({ id: u.id, username: u.username }))}
        />
      )}
    </Shell>
  );
}

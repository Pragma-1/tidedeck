import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  FilePlus2,
  FileUp,
  History,
  ListChecks,
  LogIn,
  Settings,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/session-cookie";
import { getSettings } from "@/lib/settings";
import { getTree, type TreeNode } from "@/lib/pages";
import { trashCount } from "@/lib/trash";
import { getLang } from "@/lib/i18n-server";
import { makeT } from "@/lib/i18n";
import { LiveUpdates, LogoutButton, MenuButton, NavDrawer, ThemeToggle } from "./chrome";
import { EmbedActivator } from "./embeds";
import { HeaderSearch } from "./header-search";

const contains = (n: TreeNode, slug?: string): boolean =>
  !!slug && (n.slug === slug || n.children.some((c) => contains(c, slug)));

function Tree({ nodes, active }: { nodes: TreeNode[]; active?: string }) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.id}>
          {n.children.length ? (
            <details open={contains(n, active)}>
              <summary>
                <ChevronRight className="chev" size={16} aria-hidden />
                <Link href={`/w/${n.slug}`} aria-current={n.slug === active ? "page" : undefined}>
                  {n.title}
                </Link>
              </summary>
              <Tree nodes={n.children} active={active} />
            </details>
          ) : (
            <Link href={`/w/${n.slug}`} aria-current={n.slug === active ? "page" : undefined}>
              {n.title}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export async function Shell({
  children,
  active,
  live = true,
  rev,
  editing = false,
  wide = false,
}: {
  children: ReactNode;
  active?: string;
  live?: boolean;
  rev?: number;
  editing?: boolean;
  wide?: boolean;
}) {
  const [user, cfg, lang] = [await getCurrentUser(), await getSettings(), await getLang()];
  const t = makeT(lang);
  const canRead = !!user || cfg.public_read;
  const canEdit = !!user && user.role !== "viewer" && !user.needs2faSetup;
  const tree = canRead ? await getTree() : [];
  const trashed = canEdit ? await trashCount() : 0;
  return (
    <>
      <a className="skip" href="#main">
        {t("Skip to content")}
      </a>
      <header className="top">
        <div className="top-row">
          {canRead && <MenuButton />}
          <Link className="brand" href="/">
            <BookOpen size={22} aria-hidden />
            {cfg.site_name}
          </Link>
          {canRead && <HeaderSearch />}
          <div className="top-actions">
            <ThemeToggle />
            {user ? (
              <>
                {user.role === "admin" && (
                  <Link className="top-link" href="/settings">
                    <Settings size={18} aria-hidden />
                    <span>{t("Settings")}</span>
                  </Link>
                )}
                <Link className="top-link" href="/account">
                  <UserRound size={18} aria-hidden />
                  <span>{user.username}</span>
                </Link>
                <LogoutButton />
              </>
            ) : (
              <Link className="top-link" href="/login">
                <LogIn size={18} aria-hidden />
                <span>{t("Sign in")}</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className={`frame${wide ? " wide" : ""}`}>
        <NavDrawer>
          <h2>{t("Pages")}</h2>
          {tree.length ? (
            <Tree nodes={tree} active={active} />
          ) : (
            <p className="hint" style={{ margin: ".3rem" }}>
              {canRead ? t("No pages yet.") : t("Sign in to read.")}
            </p>
          )}
          {(canEdit || user) && (
            <div className="rail-actions">
              {canEdit && (
                <div className="new-split" role="group" aria-label={t("New page")}>
                  <Link className="btn sm" href="/new">
                    <FilePlus2 size={16} aria-hidden />
                    {t("New page")}
                  </Link>
                  <Link className="btn sm ghost" href="/new?import=1" title={t("Import a Markdown file as a new page")}>
                    <FileUp size={16} aria-hidden />
                    {t("Import .md")}
                  </Link>
                </div>
              )}
              {user && (
                <Link className="rail-link" href="/changes">
                  <History size={15} aria-hidden />
                  {t("Recent changes")}
                </Link>
              )}
              {canEdit && (
                <Link className="rail-link" href="/pages">
                  <ListChecks size={15} aria-hidden />
                  {t("Manage pages")}
                </Link>
              )}
              {canEdit && (
                <Link className="rail-link" href="/trash">
                  <Trash2 size={15} aria-hidden />
                  {t("Trash")}
                  {trashed > 0 && (
                    <span className="count" aria-label={t("{n} pages", { n: trashed })}>
                      {trashed}
                    </span>
                  )}
                </Link>
              )}
            </div>
          )}
        </NavDrawer>
        <main id="main" className="sheet">
          {children}
        </main>
      </div>
      <footer className="site-foot">
        <nav aria-label={t("Legal")}>
          {cfg.legal_privacy_enabled ? (
            <Link href="/privacy">{t("Privacy")}</Link>
          ) : (
            cfg.legal_privacy_url && (
              <a href={cfg.legal_privacy_url} rel="noopener noreferrer">
                {t("Privacy")}
              </a>
            )
          )}
          {cfg.legal_terms_enabled && <Link href="/terms">{t("Terms of use")}</Link>}
          {cfg.legal_imprint_enabled && <Link href="/imprint">{t("Imprint")}</Link>}
        </nav>
        <span>{cfg.site_name}</span>
      </footer>
      <EmbedActivator />
      {live && canRead && <LiveUpdates slug={active} rev={rev} editing={editing} />}
    </>
  );
}

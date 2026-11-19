import { msg } from "./msg";
export const ROLE_LABELS = { admin: msg("Administrator"), editor: msg("Editor"), viewer: msg("Viewer") } as const;

type RoleName = keyof typeof ROLE_LABELS;
export const ROLES: readonly RoleName[] = ["admin", "editor", "viewer"];
/** Higher number = more authority. The owner sits above every role. */
export const ROLE_RANK: Record<RoleName, number> = { viewer: 1, editor: 2, admin: 3 };
export const OWNER_RANK = 4;
export const MFA_SETTING = {
  admin: "require_2fa_admin",
  editor: "require_2fa_editor",
  viewer: "require_2fa_viewer",
} as const;

/**
 * Who may switch "two-factor required" for a role: only roles strictly below one's own highest role.
 * The owner may change it for every role, including their own.
 */
export const canSetMfaFor = (actor: { role: RoleName; isOwner: boolean }, target: RoleName) =>
  actor.isOwner || ROLE_RANK[target] < ROLE_RANK[actor.role];

export const mfaRequiredFor = (s: Record<(typeof MFA_SETTING)[RoleName], boolean>, role: RoleName) =>
  !!s[MFA_SETTING[role]];

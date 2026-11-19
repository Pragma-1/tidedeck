export type Cluster = { root: string; data: string; port: number; superPw: string; appPw: string; host: string };
export const APP_ROLE: string;
export function startCluster(): Promise<Cluster>;
export function stopCluster(c: Cluster): void;
export function createDatabase(c: Cluster, name?: string): Promise<string>;
export function withSuper<T>(c: Cluster, db: string, fn: (c: import("pg").Client) => Promise<T>): Promise<T>;
export function appEnv(c: Cluster, db: string): Record<string, string>;

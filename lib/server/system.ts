import os from "node:os"
import { promises as fs } from "node:fs"

export type SystemStats = {
  hostname: string
  platform: string
  cpu: { percent: number; cores: number; load: number[] }
  memory: { total: number; used: number; percent: number }
  disk: { path: string; total: number; used: number; percent: number } | { path: string; error: string }
  uptime: number
}

type CpuSample = { idle: number; total: number }

function sampleCpu(): CpuSample {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { idle, total }
}

const g = globalThis as unknown as { __tidedeckCpu?: { sample: CpuSample; at: number } }

async function cpuPercent(): Promise<number> {
  let prev = g.__tidedeckCpu
  if (!prev || Date.now() - prev.at > 60_000) {
    prev = { sample: sampleCpu(), at: Date.now() }
    await new Promise((r) => setTimeout(r, 250))
  }
  const now = sampleCpu()
  g.__tidedeckCpu = { sample: now, at: Date.now() }
  const total = now.total - prev.sample.total
  const idle = now.idle - prev.sample.idle
  return total > 0 ? Math.max(0, Math.min(100, ((total - idle) / total) * 100)) : 0
}

export async function getSystemStats(diskPath: string): Promise<SystemStats> {
  const total = os.totalmem()
  const used = total - os.freemem()
  let disk: SystemStats["disk"]
  try {
    const s = await fs.statfs(diskPath)
    const size = s.blocks * s.bsize
    const free = s.bavail * s.bsize
    disk = { path: diskPath, total: size, used: size - free, percent: size ? ((size - free) / size) * 100 : 0 }
  } catch {
    disk = { path: diskPath, error: "Path not found inside the container" }
  }
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpu: { percent: await cpuPercent(), cores: os.cpus().length, load: os.loadavg() },
    memory: { total, used, percent: (used / total) * 100 },
    disk,
    uptime: os.uptime(),
  }
}

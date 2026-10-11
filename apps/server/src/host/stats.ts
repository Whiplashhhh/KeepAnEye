import { execFile } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostInfo } from '@kae/shared';

type Container = HostInfo['container'];

export interface ContainerProbe {
  status(): Promise<Container>;
}

/** `docker compose -f <dir>/compose.yml ps --format json claude`, via execFile. */
export class DockerComposeProbe implements ContainerProbe {
  constructor(
    private readonly dockerBin: string,
    private readonly claudeBoxDir: string,
    private readonly service = 'claude',
  ) {}

  status(): Promise<Container> {
    return new Promise((resolve) => {
      execFile(
        this.dockerBin,
        ['compose', '-f', path.join(this.claudeBoxDir, 'compose.yml'), 'ps', '--all', '--format', 'json', this.service],
        { timeout: 8000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) return resolve({ state: 'unknown', detail: 'Docker indisponible' });
          resolve(parseComposePs(stdout));
        },
      );
    });
  }
}

/** Accepts both output styles: a JSON array (older compose) or one JSON object per line. */
export function parseComposePs(out: string): Container {
  const text = out.trim();
  if (!text) return { state: 'stopped', detail: 'Conteneur absent' };
  let items: unknown[] = [];
  try {
    const parsed = JSON.parse(text) as unknown;
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    for (const line of text.split('\n')) {
      try {
        items.push(JSON.parse(line));
      } catch {
        // ignore
      }
    }
  }
  const first = items[0] as { State?: unknown; Status?: unknown; Health?: unknown } | undefined;
  if (!first) return { state: 'unknown', detail: 'Réponse illisible' };
  const state = typeof first.State === 'string' ? first.State : '';
  const status = typeof first.Status === 'string' ? first.Status.slice(0, 80) : state;
  return { state: state === 'running' ? 'running' : 'stopped', detail: status };
}

export class HostStats {
  private prevCpu = cpuTimes();
  private container: Container = { state: 'unknown', detail: 'Vérification…' };
  private containerCheckedAt = 0;

  constructor(
    private readonly probe: ContainerProbe,
    private readonly diskPath: string = os.homedir(),
    private readonly label: string = os.hostname(),
  ) {}

  async read(): Promise<HostInfo> {
    const now = Date.now();
    const cur = cpuTimes();
    const idle = cur.idle - this.prevCpu.idle;
    const total = cur.total - this.prevCpu.total;
    this.prevCpu = cur;
    const cpu = total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : 0;

    if (now - this.containerCheckedAt > 15_000) {
      this.containerCheckedAt = now;
      this.container = await this.probe.status();
    }
    const mem = await memInfo();
    let diskUsed = 0;
    let diskTotal = 0;
    try {
      const s = await statfs(this.diskPath);
      diskTotal = s.blocks * s.bsize;
      diskUsed = (s.blocks - s.bavail) * s.bsize;
    } catch {
      // ignore
    }
    const [l1, l5, l15] = os.loadavg();
    return {
      hostname: this.label,
      cpu,
      load: [l1 ?? 0, l5 ?? 0, l15 ?? 0],
      memUsed: mem.used,
      memTotal: mem.total,
      diskUsed,
      diskTotal,
      uptime: os.uptime(),
      container: this.container,
      updatedAt: now,
    };
  }
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { idle, total };
}

/** MemAvailable is a better "used" measure than freemem() (which counts page cache as used). */
async function memInfo(): Promise<{ used: number; total: number }> {
  const total = os.totalmem();
  try {
    const txt = await readFile('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+) kB/.exec(txt);
    if (m) return { used: total - Number(m[1]) * 1024, total };
  } catch {
    // not Linux
  }
  return { used: total - os.freemem(), total };
}

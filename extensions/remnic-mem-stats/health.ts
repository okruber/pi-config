export interface HealthInfo {
  reachable: boolean;
  searchBackend?: string;
  qmdActive?: boolean;
  qmdDegraded?: boolean;
  embeddingFresh?: boolean | null;
  memoryDir?: string;
  raw?: any;
}

export async function getHealth(
  daemon: { url: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<HealthInfo> {
  try {
    const res = await fetchImpl(`${daemon.url}/engram/v1/health`, {
      headers: { Authorization: `Bearer ${daemon.token}` },
    });
    if (!res.ok) return { reachable: false };
    const raw: any = await res.json();
    return {
      reachable: true,
      searchBackend: raw.searchBackend,
      qmdActive: raw.qmd?.active,
      qmdDegraded: raw.qmd?.degraded,
      embeddingFresh: raw.qmd?.embeddingFresh ?? null,
      memoryDir: raw.memoryDir,
      raw,
    };
  } catch {
    return { reachable: false };
  }
}

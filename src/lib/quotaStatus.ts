import { useCallback, useEffect, useState } from 'react';
import { Quota, type LimitItem, type QuotaStatus } from './quotaPlugin';
import { useConfigVersion } from './nativeConfig';

export type { LimitItem, QuotaStatus };

/** Status semua batas, dihitung di sisi Kotlin (satu-satunya sumber, sama dengan yang dipakai notifikasi).
 *  `dep` boleh diisi data yang berubah saat ada sinkronisasi baru supaya status ikut dibaca ulang. */
export function useQuotaStatus(dep?: unknown) {
  const ver = useConfigVersion();
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setStatus(await Quota.getQuotaStatus()); setError(null); }
    catch (e) { setError(String((e as Error).message ?? e)); }
  }, []);
  useEffect(() => { load(); }, [load, ver, dep]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);
  return { status, error, reload: load };
}

export const findItem = (s: QuotaStatus | null, id: string): LimitItem | undefined => s?.items.find((i) => i.id === id);

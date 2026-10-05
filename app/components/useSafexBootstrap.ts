'use client';

import { useEffect, useState } from 'react';
import { selectableSites } from '@/lib/site-config';
import { DEMO_SITES } from '@/lib/demo-data';
import { MASTER_DIRECTORY, type EmployeeDirectory } from '@/lib/employee-directory';
import type { Site } from '@/lib/types';

type BootstrapResponse = {
  /** 'supabase' and 'sheet' both mean the lookup must go through the server. */
  directory?: 'supabase' | 'sheet' | 'unavailable';
  sites?: Site[];
  employeeCount?: number;
  dataIssueCount?: number;
  degraded?: boolean;
};

export type DirectoryMode = 'supabase' | 'sheet' | 'unavailable';

export type SafexBootstrap = {
  /** False until the server has answered, so site selection waits for the real site list. */
  ready: boolean;
  sites: Site[];
  directory: EmployeeDirectory;
  /** Which source answered. The admin console shows this; the worker app does not care. */
  directoryMode: DirectoryMode;
  employeeCount: number;
  /** The master could not be read. No sample records are substituted. */
  degraded: boolean;
};

const INITIAL: SafexBootstrap = {
  ready: false,
  sites: DEMO_SITES,
  directory: MASTER_DIRECTORY,
  directoryMode: 'unavailable',
  employeeCount: 0,
  degraded: false
};

export function useSafexBootstrap(): SafexBootstrap {
  const [state, setState] = useState<SafexBootstrap>(INITIAL);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch('/api/bootstrap', { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<BootstrapResponse> : null))
      .then((payload) => {
        if (!active) return;
        const sites = Array.isArray(payload?.sites) && payload.sites.length ? payload.sites : DEMO_SITES;
        setState({
          ready: true,
          sites: selectableSites(sites),
          directory: MASTER_DIRECTORY,
          directoryMode: payload?.directory ?? 'unavailable',
          employeeCount: payload?.employeeCount ?? 0,
          degraded: !payload || Boolean(payload.degraded)
        });
      })
      .catch(() => {
        // Offline or blocked: keep server lookups, which will report unavailable.
        if (active) setState({ ...INITIAL, ready: true, degraded: true });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return state;
}

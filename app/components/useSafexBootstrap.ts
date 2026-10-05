'use client';

import { useEffect, useState } from 'react';
import { DEMO_SITES } from '@/lib/demo-data';
import { DEMO_DIRECTORY, directoryFor, type EmployeeDirectory } from '@/lib/employee-directory';
import type { Site } from '@/lib/types';

type BootstrapResponse = {
  directory?: 'demo' | 'master';
  sites?: Site[];
  employeeCount?: number;
  dataIssueCount?: number;
  degraded?: boolean;
};

export type SafexBootstrap = {
  /** False until the server has answered, so site selection waits for the real site list. */
  ready: boolean;
  sites: Site[];
  directory: EmployeeDirectory;
  employeeCount: number;
  /** A master is configured but could not be read; the app fell back to demo records. */
  degraded: boolean;
};

const INITIAL: SafexBootstrap = {
  ready: false,
  sites: DEMO_SITES,
  directory: DEMO_DIRECTORY,
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
          sites,
          directory: directoryFor(payload?.directory === 'master' ? 'master' : 'demo'),
          employeeCount: payload?.employeeCount ?? 0,
          degraded: Boolean(payload?.degraded)
        });
      })
      .catch(() => {
        // Offline or blocked: keep the demo roster so the app still works on site.
        if (active) setState({ ...INITIAL, ready: true });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return state;
}

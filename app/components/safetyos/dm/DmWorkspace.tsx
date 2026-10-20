'use client';

import { useEffect, useState } from 'react';
import { emptyPlan, severityApplies, thankYouLine, type DmPlan } from '@/lib/dm/plan';
import { directoryFromApi, type DirectoryEmployee } from '@/lib/dm/employees';
import DmForm from './DmForm';
import DmRecords from './DmRecords';

/**
 * The console's DM screen: the plan form and its archive.
 *
 * The design ships this page as an empty placeholder, so the whole screen belongs to the
 * host. Tabs rather than two pages, because filing a plan and checking the filed one are
 * the same task at different moments.
 */

type Props = {
  siteId: string;
  siteName: string;
  officerName: string;
};

type Filed = { id: string; reference: string; supervisor: string };

export default function DmWorkspace({ siteId, siteName, officerName }: Props) {
  const [tab, setTab] = useState<'conduct' | 'records'>('conduct');
  const [plan, setPlan] = useState<DmPlan>(() => emptyPlan());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filed, setFiled] = useState<Filed | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /** The employee master, so a number or a name in the form resolves to the other. */
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [directoryNote, setDirectoryNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found: unknown[] = [];
        // The console's roster endpoint pages at 50; the DM form needs the whole master,
        // so it walks the pages once and keeps the three fields the pickers use.
        for (let page = 0; page < 8; page += 1) {
          const params = new URLSearchParams({ limit: '50', offset: String(page * 50) });
          if (siteId && siteId !== 'all') params.set('siteId', siteId);
          const response = await fetch(`/api/admin/employees?${params}`, {
            credentials: 'same-origin',
            cache: 'no-store'
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'Employee master is not reachable.');
          found.push(...(Array.isArray(data.employees) ? data.employees : []));
          if (!data.total || found.length >= Number(data.total)) break;
        }
        if (!cancelled) {
          setEmployees(directoryFromApi(found));
          setDirectoryNote('');
        }
      } catch (cause) {
        if (!cancelled) {
          setEmployees([]);
          setDirectoryNote(cause instanceof Error ? cause.message : 'Employee master is not reachable.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  // The officer's own name and the site are the two things every plan starts with.
  useEffect(() => {
    setPlan((current) => (current.supervisor ? current : { ...current, supervisor: officerName, location: siteName }));
  }, [officerName, siteName]);

  async function submit() {
    setError('');
    if (!plan.date) { setError('Pick the plan date.'); return; }
    if (!plan.supervisor.trim()) { setError('Supervisor name is required.'); return; }
    // The declaration and the signature are the officer's attestation. Checked here so the
    // message is in the form's own language, and again on the server, which is the real gate.
    if (!plan.signOff.declared) {
      setError('Declaration tick karein — "sab kuch sach hai" wala checkbox zaroori hai.');
      setTab('conduct');
      return;
    }
    if (!plan.signOff.signature) {
      setError('Signature banayein — bina haath se sign kiye DM file nahi hoga.');
      setTab('conduct');
      return;
    }
    // An unsafe observation without a severity cannot be triaged, so it is caught here
    // before the plan is filed and a numbered document is built around it.
    const unrated = plan.modules.walkthrough.findIndex((row) => severityApplies(row.type)
      && !row.severity && Boolean(row.area || row.details));
    if (unrated >= 0) {
      setError(`Site walk-through row ${unrated + 1}: unsafe observation hai — severity (1-5) chuniye.`);
      setTab('conduct');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/admin/dm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, plan })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error ?? 'The plan could not be filed.');
      }
      setFiled({ id: data.record.id, reference: data.record.reference, supervisor: plan.supervisor });
      setPlan(emptyPlan());
      setRefreshKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The plan could not be filed.');
    } finally {
      setSaving(false);
    }
  }

  const pdfHref = (id: string) => {
    const params = new URLSearchParams();
    if (siteId && siteId !== 'all') params.set('siteId', siteId);
    return `/api/admin/dm/${id}/pdf?${params.toString()}`;
  };

  return <div className="dm-workspace">
    <nav className="dm-tabs" aria-label="DM sections">
      <button type="button" className={tab === 'conduct' ? 'is-active' : undefined} onClick={() => setTab('conduct')}>
        Conduct DM
      </button>
      <button type="button" className={tab === 'records' ? 'is-active' : undefined} onClick={() => setTab('records')}>
        DM Records
      </button>
    </nav>

    {tab === 'conduct' && <>
      {directoryNote && <p className="dm-hint-note">
        Employee master load nahi hua ({directoryNote}). Employee number/naam se auto-fill band hai — naam type kar sakte hain.
      </p>}
      {filed && <div className="dm-banner dm-banner-thanks" role="status" aria-live="polite">
        <div>
          <strong>{thankYouLine(filed.supervisor)}</strong>
          <p>
            <b>{filed.reference}</b> signed, filed and locked. Signed PDF DM Records me archive hai.
          </p>
        </div>
        <div className="dm-banner-actions">
          <a className="dm-doc" href={pdfHref(filed.id)}>Download PDF ↓</a>
          <button type="button" className="dm-ghost" onClick={() => setTab('records')}>Open DM Records</button>
        </div>
      </div>}
      <DmForm
        plan={plan}
        siteName={siteName}
        employees={employees}
        saving={saving}
        error={error}
        onChange={setPlan}
        onSubmit={() => void submit()}
        onReset={() => { setPlan(emptyPlan()); setError(''); setFiled(null); }}
      />
    </>}

    {tab === 'records' && <DmRecords siteId={siteId} refreshKey={refreshKey} justFiled={filed?.reference ?? null} />}
  </div>;
}

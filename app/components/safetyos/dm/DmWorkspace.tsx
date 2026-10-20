'use client';

import { useEffect, useState } from 'react';
import { emptyPlan, type DmPlan } from '@/lib/dm/plan';
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

type Filed = { id: string; reference: string };

export default function DmWorkspace({ siteId, siteName, officerName }: Props) {
  const [tab, setTab] = useState<'conduct' | 'records'>('conduct');
  const [plan, setPlan] = useState<DmPlan>(() => emptyPlan());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filed, setFiled] = useState<Filed | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // The officer's own name and the site are the two things every plan starts with.
  useEffect(() => {
    setPlan((current) => (current.supervisor ? current : { ...current, supervisor: officerName, location: siteName }));
  }, [officerName, siteName]);

  async function submit() {
    setError('');
    if (!plan.date) { setError('Pick the plan date.'); return; }
    if (!plan.supervisor.trim()) { setError('Supervisor name is required.'); return; }

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
      setFiled({ id: data.record.id, reference: data.record.reference });
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
      {filed && <div className="dm-banner" role="status">
        <div>
          <strong>{filed.reference}</strong> filed. The plan is locked and its PDF is in DM Records.
        </div>
        <div className="dm-banner-actions">
          <a className="dm-doc" href={pdfHref(filed.id)}>Download PDF ↓</a>
          <button type="button" className="dm-ghost" onClick={() => setTab('records')}>Open DM Records</button>
        </div>
      </div>}
      <DmForm
        plan={plan}
        siteName={siteName}
        saving={saving}
        error={error}
        onChange={setPlan}
        onSubmit={() => void submit()}
        onReset={() => { setPlan(emptyPlan()); setError(''); }}
      />
    </>}

    {tab === 'records' && <DmRecords siteId={siteId} refreshKey={refreshKey} justFiled={filed?.reference ?? null} />}
  </div>;
}

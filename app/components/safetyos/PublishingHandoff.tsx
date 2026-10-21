'use client';

import { ArrowUpRight, FileText, Megaphone } from 'lucide-react';

/**
 * Stands in for the console's demo Documents / Communications editors.
 *
 * Those screens only changed a preview inside the design: nothing was written to Supabase,
 * so a document "published" there never reached the worker app. The real editor is the
 * Safex publishing panel, which writes the rows /api/content reads. This card points there
 * and leaves no demo controls behind.
 */
export default function PublishingHandoff({ section, siteName }: {
  section: 'documents' | 'communications';
  siteName: string;
}) {
  const documents = section === 'documents';
  const Icon = documents ? FileText : Megaphone;
  return <div className="publishing-handoff">
    <div className="publishing-handoff-card">
      <span className="publishing-handoff-icon" aria-hidden="true"><Icon size={26} /></span>
      <span className="publishing-handoff-eyebrow">{documents ? 'DOCUMENT VAULT' : 'COMMUNICATIONS'}</span>
      <h2>{documents ? 'Publish documents' : 'Publish circulars, notices and events'}</h2>
      <p>
        {documents
          ? `Documents shown in the worker app are published from the Safex publishing panel. A published file appears in the Document Vault / Library for ${siteName}.`
          : `Circulars, notices and events shown in the worker app are published from the Safex publishing panel. A published entry appears in the app for ${siteName}.`}
      </p>
      <a className="publishing-handoff-button" href="/admin/publish" target="_blank" rel="noreferrer">
        Open publishing panel <ArrowUpRight size={16} />
      </a>
      <small>Sign in with the admin password used for this console. Rewards are published there too.</small>
    </div>
  </div>;
}

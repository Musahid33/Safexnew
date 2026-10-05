type Props = {
  title: string;
  subtitle: string;
  icon: string;
  /**
   * True when the design file already specifies this page in full, so the only work left
   * is the port. False for the pages the design itself marks "Coming Soon".
   */
  designed: boolean;
};

export default function ComingSoonPage({ title, subtitle, icon, designed }: Props) {
  return (
    <main className="page">
      <section className="page-heading">
        <div className="heading-left">
          <div className="heading-icon"><svg className="icon"><use href={`#${icon}`} /></svg></div>
          <div>
            <h1>{title}</h1>
            <p className="page-subtitle">{subtitle}</p>
          </div>
        </div>
      </section>
      <div className="ep-source-note">
        <svg className="icon"><use href="#i-shield-alert" /></svg>
        <div>
          <strong>{designed ? 'Designed, not yet ported' : 'Not built yet'}</strong>
          <small>
            {designed
              ? 'This page exists in full in the design file. It is next in the port queue — the shell, styling and icons it needs are already in place.'
              : 'The design marks this page as Coming Soon, so there is nothing to port yet.'}
          </small>
        </div>
        <span className="case-demo-badge">{designed ? 'Port pending' : 'Coming soon'}</span>
      </div>
    </main>
  );
}

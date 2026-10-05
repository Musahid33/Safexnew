type Props = {
  title: string;
  parent: string;
  icon: string;
  /**
   * True when the design file already specifies this screen in full, so the only work
   * left is the port. False for the modules the design itself marks "Coming Soon".
   */
  designed: boolean;
};

export default function ComingSoonPage({ title, parent, icon, designed }: Props) {
  return (
    <main className="page">
      {parent && parent !== title && (
        <div className="sos-breadcrumb">
          <span>{parent}</span>
          <svg className="icon"><use href="#i-chevron-right" /></svg>
          <strong>{title}</strong>
        </div>
      )}
      <section className="page-heading">
        <div className="heading-left">
          <div className="heading-icon"><svg className="icon"><use href={`#${icon}`} /></svg></div>
          <div>
            <h1>{title}</h1>
            <p className="page-subtitle">
              {designed ? `${parent} · specified in the design, port pending` : 'Not specified yet'}
            </p>
          </div>
        </div>
      </section>
      <div className="ep-source-note">
        <svg className="icon"><use href="#i-shield-alert" /></svg>
        <div>
          <strong>{designed ? 'Designed, not yet ported' : 'Not built yet'}</strong>
          <small>
            {designed
              ? 'This sub-section exists in full in the design file. The shell, styling, icons and navigation it needs are already in place, so the port is the only remaining work.'
              : 'The design marks this module as Coming Soon, so there is nothing to port yet.'}
          </small>
        </div>
        <span className="case-demo-badge">{designed ? 'Port pending' : 'Coming soon'}</span>
      </div>
    </main>
  );
}

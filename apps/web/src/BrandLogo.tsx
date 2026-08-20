type BrandLogoProps = { compact?: boolean; context?: string; full?: boolean; inverse?: boolean };

export function BrandLogo({ compact = false, context, full = false, inverse = false }: BrandLogoProps) {
  if (full) return <img className="fideliza-full-logo" src="/fideliza-plus.svg" alt="Fideliza Plus — Mais relacionamento, mais resultados" />;
  return <div className={`fideliza-brand ${compact ? 'is-compact' : ''} ${inverse ? 'is-inverse' : ''}`}>
    <img src="/icons/fideliza-official.svg" alt="" aria-hidden="true" />
    {!compact && <div className="fideliza-brand-copy"><span><b>FIDELIZA</b><em>PLUS</em></span><small>{context || 'Mais relacionamento, mais resultados.'}</small></div>}
  </div>;
}

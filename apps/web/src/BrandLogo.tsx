type BrandLogoProps = { compact?: boolean; context?: string; full?: boolean; inverse?: boolean };

export function BrandLogo({ compact = false, context, full = false, inverse = false }: BrandLogoProps) {
  if (full) return <img className="fideliza-full-logo" src="/fidelizei.svg" alt="Fidelizei — Mais relacionamento, mais resultados" />;
  return <div className={`fideliza-brand ${compact ? 'is-compact' : ''} ${inverse ? 'is-inverse' : ''}`}>
    <img src={compact || inverse ? '/fidelizei-mark.svg' : '/fidelizei.svg'} alt="Fidelizei" />
    {!compact && <div className="fideliza-brand-copy">{inverse&&<b>FIDELIZEI</b>}<small>{context || 'Mais relacionamento, mais resultados.'}</small></div>}
  </div>;
}

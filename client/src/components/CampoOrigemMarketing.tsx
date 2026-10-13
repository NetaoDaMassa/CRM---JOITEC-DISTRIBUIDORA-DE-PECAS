// Checkbox "Cliente de Marketing" + sub-seletor de tipo (Lead Padrão/Lead
// Site), reaproveitado nos 4 lugares que capturam esse dado (cadastro novo,
// detalhe do cliente, e as 2 modais de "completar cadastro" no
// FunilBoard.tsx). Pedido do João, 2026-10-13: precisava diferenciar lead
// que veio do site próprio do resto dos canais de Marketing (ads, campanha
// etc. — isso continua sendo "Lead Padrão", o que já existia antes).
export type OrigemMarketingTipo = 'padrao' | 'site'

export default function CampoOrigemMarketing({
  checked,
  onCheckedChange,
  tipo,
  onTipoChange,
  name = 'origemMarketingTipo',
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  tipo: OrigemMarketingTipo
  onTipoChange: (v: OrigemMarketingTipo) => void
  name?: string
}) {
  return (
    <div className="bg-dark-900/50 border border-dark-700 rounded-xl px-3 py-2 space-y-2">
      <label className="flex items-center gap-2 text-sm text-dark-200">
        <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} className="accent-gold-500" />
        Cliente de Marketing
      </label>
      {checked && (
        <div className="flex gap-4 pl-6 text-xs text-dark-300">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={name} checked={tipo === 'padrao'} onChange={() => onTipoChange('padrao')} className="accent-gold-500" />
            Lead Padrão
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={name} checked={tipo === 'site'} onChange={() => onTipoChange('site')} className="accent-gold-500" />
            Lead Site
          </label>
        </div>
      )}
    </div>
  )
}

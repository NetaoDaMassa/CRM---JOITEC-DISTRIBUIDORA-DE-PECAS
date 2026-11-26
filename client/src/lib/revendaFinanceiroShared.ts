// Créditos Odin + Pagamentos Odin — rótulos e cores compartilhados.
// Mesma lista de etapas de server/src/lib/revendaFinanceiro.ts.

export const ETAPAS_PAGAMENTO = [
  { value: 'comissao_registrada', label: 'Comissão registrada', labelGarantia: 'Pagamento registrado', soComissao: false, cor: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  { value: 'aguardando_instalacao', label: 'Aguardando liberação da instalação', soComissao: true, cor: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { value: 'instalacao_liberada', label: 'Instalação liberada', soComissao: true, cor: 'bg-lime-500/15 text-lime-300 border-lime-500/30' },
  { value: 'nf_solicitada', label: 'NF de serviço solicitada', soComissao: false, cor: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { value: 'aguardando_nf', label: 'Aguardando recebimento da NF', soComissao: false, cor: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  { value: 'nf_conferencia', label: 'NF recebida / em conferência', soComissao: false, cor: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { value: 'pagamento_agendado', label: 'Pagamento agendado', soComissao: false, cor: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  { value: 'pagamento_realizado', label: 'Pagamento realizado', soComissao: false, cor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { value: 'concluido', label: 'Concluído', soComissao: false, cor: 'bg-green-600/20 text-green-300 border-green-600/40' },
] as const
export type EtapaPagamento = (typeof ETAPAS_PAGAMENTO)[number]['value']
export const ETAPAS_PAGAS: string[] = ['pagamento_realizado', 'concluido']

export function etapasDoTipo(tipo: 'comissao' | 'garantia') {
  return ETAPAS_PAGAMENTO.filter((e) => tipo === 'comissao' || !e.soComissao)
}

export function rotuloEtapaPagamento(stage: string, tipo: 'comissao' | 'garantia' = 'comissao') {
  const e = ETAPAS_PAGAMENTO.find((x) => x.value === stage)
  if (!e) return stage
  return tipo === 'garantia' && 'labelGarantia' in e ? e.labelGarantia : e.label
}

export function corEtapaPagamento(stage: string) {
  return ETAPAS_PAGAMENTO.find((x) => x.value === stage)?.cor ?? 'bg-dark-700 text-dark-300 border-dark-600'
}

export const ETAPAS_CREDITO = [
  { value: 'analise', label: 'Em análise', cor: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { value: 'aprovacao', label: 'Aguardando aprovação', cor: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { value: 'aprovado', label: 'Crédito liberado', cor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { value: 'recusado', label: 'Recusado', cor: 'bg-red-500/15 text-red-300 border-red-500/30' },
] as const

export function etapaCredito(stage: string) {
  return ETAPAS_CREDITO.find((e) => e.value === stage) ?? { value: stage, label: stage, cor: 'bg-dark-700 text-dark-300 border-dark-600' }
}

export function brl(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function dataBr(d: string | null | undefined) {
  if (!d) return '—'
  const [a, m, dd] = d.slice(0, 10).split('-')
  return `${dd}/${m}/${a}`
}

// "1.234,56" / "1234.56" / "1234" → número. Vazio → null.
export function lerValor(txt: string): number | null {
  const t = txt.trim().replace(/[R$\s]/g, '')
  if (!t) return null
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  return Number.isFinite(n) ? n : NaN
}

export async function enviarAnexo(file: File): Promise<{ nomeOriginal: string; nomeArmazenado: string; tipoArquivo: string; tamanhoBytes: number }> {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/revenda-financeiro-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json()
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload')
  return { nomeOriginal: json.nome, nomeArmazenado: String(json.path).replace('/uploads/', ''), tipoArquivo: json.tipo, tamanhoBytes: json.tamanho }
}

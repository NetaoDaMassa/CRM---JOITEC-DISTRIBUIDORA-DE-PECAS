import { useAuth } from '../contexts/AuthContext'
import { trpc } from './trpc'

// Setor de Compras — processo completo (pedido do João, 2026-11-04).
// Rótulos/cores das etapas usados em todas as telas do módulo.

export type EtapaCompra = 'solicitacao' | 'cotacao' | 'negociacao' | 'aprovacao' | 'pedido' | 'recebimento' | 'finalizado' | 'reprovado' | 'cancelado'

export const ETAPAS_FLUXO: EtapaCompra[] = ['solicitacao', 'cotacao', 'negociacao', 'aprovacao', 'pedido', 'recebimento', 'finalizado']

export const ETAPA_INFO: Record<EtapaCompra, { label: string; cor: string; ajuda: string }> = {
  solicitacao: { label: 'Solicitação', cor: '#64748b', ajuda: 'Pedido aberto, esperando o Compras começar a cotar' },
  cotacao: { label: 'Cotação', cor: '#0ea5e9', ajuda: 'Compras está pedindo preço aos fornecedores' },
  negociacao: { label: 'Negociação', cor: '#8b5cf6', ajuda: 'Negociando preço/prazo e escolhendo o fornecedor' },
  aprovacao: { label: 'Aprovação', cor: '#f59e0b', ajuda: 'Esperando o aprovador liberar a compra' },
  pedido: { label: 'Pedido de compra', cor: '#ec4899', ajuda: 'Aprovada — falta emitir o pedido pro fornecedor' },
  recebimento: { label: 'Recebimento', cor: '#14b8a6', ajuda: 'Pedido feito, esperando a mercadoria chegar' },
  finalizado: { label: 'Finalizado', cor: '#22a861', ajuda: 'Recebido e conferido' },
  reprovado: { label: 'Reprovado', cor: '#e5534b', ajuda: 'O aprovador não liberou' },
  cancelado: { label: 'Cancelado', cor: '#6b7280', ajuda: 'Compra cancelada' },
}

export const TIPO_INFO = {
  revenda: { label: 'Revenda', cor: '#0ea5e9' },
  uso_consumo: { label: 'Uso e Consumo', cor: '#f59e0b' },
} as const

export const PRIORIDADE_INFO = {
  baixa: { label: 'Baixa', classe: 'text-dark-400 border-dark-600' },
  normal: { label: 'Normal', classe: 'text-blue-300 border-blue-500/30' },
  urgente: { label: 'Urgente', classe: 'text-red-300 border-red-500/40 bg-red-500/10' },
} as const

export function dataBr(d: string | null | undefined) {
  if (!d) return '—'
  const [a, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${a}`
}

export function dataHoraBr(d: string | null | undefined) {
  if (!d) return '—'
  // Gravado em UTC ("YYYY-MM-DD HH:MM:SS") → mostra no horário de Brasília
  const dt = new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z'))
  return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export function rotuloMes(mes: string) {
  return `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`
}

// '/admin' ou '/vendedor' — as telas do módulo existem nos dois lados
// (vendedor também pode pedir compra ou até ser comprador, se liberado).
export function useBaseCompras() {
  const { user } = useAuth()
  return user?.role === 'admin' ? '/admin' : '/vendedor'
}

export function useAcessoCompras() {
  return trpc.comprasProcesso.meuAcesso.useQuery(undefined, { staleTime: 60_000 })
}

export async function uploadAnexoCompra(file: File): Promise<{ url: string; nome: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const token = localStorage.getItem('odin_token')
  const resp = await fetch('/upload/devolucao-anexo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json.error ?? 'Falha no upload (aceita imagem ou PDF até 15 MB)')
  return { url: json.path, nome: json.nome }
}

import * as XLSX from 'xlsx'
import { STATUS_LABELS, isTerminalStatus, type LeadStatus } from './status.js'
import { toUtcISO } from './businessHours.js'

export interface LeadExportRow {
  ID: number
  Nome: string
  Telefone: string
  DDD: number
  Email: string
  Empresa: string
  Segmento: string
  Status: string
  Vendedor: string
  Região: string
  Fonte: string
  'Próximo Contato': string
  'Criado em': string
  'Distribuído em': string
  'Finalizado em': string
  'Tempo de Atendimento (dias)': string
  'Atualizado em': string
}

const SEGMENT_LABELS: Record<string, string> = {
  assistente_tecnico: 'Assistente Técnico',
  instalador: 'Instalador',
  revendedor_lojista: 'Revendedor/Lojista',
  outros: 'Outros',
}

export function exportLeadsToExcel(leads: any[]): Buffer {
  const rows: LeadExportRow[] = leads.map((l) => {
    const finalizado = isTerminalStatus(l.status) ? (l.statusChangedAt ?? null) : null
    const distribuidoEm = l.assignedAt ? new Date(toUtcISO(l.assignedAt)) : null
    const tempoAtendimentoDias =
      distribuidoEm && finalizado
        ? ((new Date(toUtcISO(finalizado)).getTime() - distribuidoEm.getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)
        : ''

    return {
      ID: l.id,
      Nome: l.name,
      Telefone: l.phone,
      DDD: l.ddd,
      Email: l.email ?? '',
      Empresa: l.company ?? '',
      Segmento: SEGMENT_LABELS[l.segment ?? ''] ?? l.segment ?? '',
      Status: STATUS_LABELS[l.status as LeadStatus] ?? l.status,
      Vendedor: l.vendor?.name ?? 'Sem vendedor',
      Região: l.region?.name ?? 'Sem região',
      Fonte: l.source ?? '',
      'Próximo Contato': l.nextContactAt
        ? new Date(l.nextContactAt).toLocaleDateString('pt-BR')
        : '',
      'Criado em': new Date(toUtcISO(l.createdAt)).toLocaleDateString('pt-BR'),
      'Distribuído em': distribuidoEm ? distribuidoEm.toLocaleString('pt-BR') : '',
      'Finalizado em': finalizado ? new Date(toUtcISO(finalizado)).toLocaleString('pt-BR') : '',
      'Tempo de Atendimento (dias)': tempoAtendimentoDias,
      'Atualizado em': new Date(toUtcISO(l.updatedAt)).toLocaleDateString('pt-BR'),
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  // Column widths
  ws['!cols'] = [
    { wch: 6 }, { wch: 30 }, { wch: 18 }, { wch: 6 }, { wch: 30 },
    { wch: 30 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 14 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// Ligações que NÃO passam pela central telefônica (João, 2026-11-17):
//
// 1. "Ligação pelo WhatsApp" — o vendedor liga pelo WhatsApp, tira print da
//    tela da ligação (mostra a duração) e registra no card (lead, carteira
//    ou prospecção). Vira uma linha em pabx_ligacoes_processadas com
//    fonte='whatsapp' — é dessa tabela que saem o contador do topo, a meta
//    de efetivas, o relatório de Ligações e as TVs, então conta igual a uma
//    ligação do ramal (efetiva se passou do tempo mínimo).
//
// 2. "Não foi conversa" — a ligação contou como efetiva, mas era caixa
//    postal/desligaram: quem fez a ligação (ou o admin) tira das efetivas.
//    Fica registrado quem tirou e quando.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, funilMensal, leadAttachments, leadHistory, leads, pabxLigacoesProcessadas, registroContato } from '../db/schema.js'
import { getConfigNumero } from './configuracoes.js'
import { agoraSqlite, mesReferenciaAtual } from './dataBr.js'
import { registrarLigacaoEfetivaNoLead, telefoneLeadCompleto } from './pabxone360.js'
import { registrarLigacaoPabxNoProspect } from './prospeccaoNova.js'
import { contarTentativaSePendente } from '../router/contatos.js'

export async function segundosMinimosEfetiva(): Promise<number> {
  const v = await getConfigNumero('pabxone360_duracao_minima_segundos', 30)
  return v > 0 ? v : 30
}

function formatar(seg: number): string {
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return m ? `${m}min${s ? ` ${s}s` : ''}` : `${s}s`
}

export async function registrarLigacaoWhatsapp(p: {
  empresaId: number
  userId: number
  clienteId?: number
  leadId?: number
  duracaoSegundos: number
  // Nome do arquivo devolvido por /upload/lead-attachment.
  printArquivo: { filename: string; originalName: string; mimeType: string; size: number }
  observacao?: string
}): Promise<{ efetiva: boolean; minimo: number }> {
  const minimo = await segundosMinimosEfetiva()
  const efetiva = p.duracaoSegundos >= minimo
  const dataHora = agoraSqlite()
  const urlPrint = `/uploads/${p.printArquivo.filename}`
  const extra = p.observacao?.trim() ? `\n${p.observacao.trim()}` : ''
  const texto = efetiva
    ? `📱 Ligação pelo WhatsApp — ${formatar(p.duracaoSegundos)} (print da ligação anexado).${extra}`
    : `📱 Ligação pelo WhatsApp — ${formatar(p.duracaoSegundos)}, abaixo de ${minimo}s: não conta como efetiva.${extra}`

  let numero: string | null = null
  let clienteId: number | null = null
  let leadId: number | null = null
  let registroContatoId: number | null = null

  if (p.clienteId) {
    const c = await db.query.clientes.findFirst({ where: and(eq(clientes.id, p.clienteId), isNull(clientes.deletedAt)) })
    if (!c || c.empresaId !== p.empresaId) throw new Error('Cliente não encontrado nesta empresa')
    clienteId = c.id
    numero = c.telefoneWhatsapp
    const funil = await db.query.funilMensal.findFirst({
      where: and(eq(funilMensal.clienteId, c.id), eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt)),
    })
    if (funil) {
      const [r] = await db
        .insert(registroContato)
        .values({
          funilMensalId: funil.id,
          vendedorId: p.userId,
          tipo: 'ligacao',
          origem: 'manual',
          duracaoSegundos: p.duracaoSegundos,
          efetiva,
          resultado: efetiva ? 'respondeu' : 'nao_respondeu',
          observacao: texto,
          dataHora,
        })
        .returning({ id: registroContato.id })
      registroContatoId = r?.id ?? null
      if (efetiva) await contarTentativaSePendente(funil.id, 'ligacao')
    } else {
      const ok = await registrarLigacaoPabxNoProspect({ clienteId: c.id, userId: p.userId, efetiva, observacao: `${texto}\nPrint: ${urlPrint}`, dataHora })
      if (!ok) throw new Error('Este cliente não tem card neste mês nem está na Prospecção — abra o card dele primeiro.')
    }
  } else if (p.leadId) {
    const l = await db.query.leads.findFirst({ where: and(eq(leads.id, p.leadId), isNull(leads.deletedAt)) })
    if (!l || l.empresaId !== p.empresaId) throw new Error('Lead não encontrado nesta empresa')
    leadId = l.id
    numero = telefoneLeadCompleto(l.ddd, l.phone)
    // O print fica nos anexos do lead (é onde o lead mostra arquivos).
    await db.insert(leadAttachments).values({ leadId: l.id, userId: p.userId, ...p.printArquivo })
    if (efetiva) {
      await registrarLigacaoEfetivaNoLead(l.id, p.userId, dataHora, texto)
    } else {
      await db.insert(leadHistory).values({ empresaId: l.empresaId, leadId: l.id, userId: p.userId, action: 'ligacao_nao_atendida', details: texto, createdAt: dataHora })
    }
  } else {
    throw new Error('Diga pra quem foi a ligação')
  }

  await db.insert(pabxLigacoesProcessadas).values({
    chamadaId: `whatsapp:${p.userId}:${Date.now()}`,
    direcao: 'OUTBOUND',
    // O contador só soma ligação com número externo (tira "entre colegas").
    numeroExterno: numero?.replace(/\D/g, '') || 'whatsapp',
    duracaoSegundos: p.duracaoSegundos,
    clienteId,
    leadId,
    registroContatoId,
    empresaId: p.empresaId,
    userId: p.userId,
    dataHora,
    efetiva,
    statusChamada: efetiva ? 'atendida' : 'curta',
    fonte: 'whatsapp',
    anexoPrint: urlPrint,
  })
  return { efetiva, minimo }
}

// Tira (ou devolve, com desfazer=true) uma ligação das efetivas.
export async function marcarNaoEfetiva(p: { ligacaoId: number; porUserId: number; desfazer: boolean; podeQualquer: boolean; meusIds: number[] }) {
  const l = await db.query.pabxLigacoesProcessadas.findFirst({ where: eq(pabxLigacoesProcessadas.id, p.ligacaoId) })
  if (!l) throw new Error('Ligação não encontrada')
  if (!p.podeQualquer && !(l.userId && p.meusIds.includes(l.userId))) throw new Error('Só quem fez a ligação (ou o gestor) pode mudar isso')

  if (!p.desfazer) {
    if (!l.efetiva) throw new Error('Essa ligação já não conta como efetiva')
    await db
      .update(pabxLigacoesProcessadas)
      .set({ efetiva: false, statusChamada: 'caixa_postal', naoEfetivaPorId: p.porUserId, naoEfetivaEm: agoraSqlite() })
      .where(eq(pabxLigacoesProcessadas.id, l.id))
    if (l.registroContatoId) {
      await db.update(registroContato).set({ efetiva: false, resultado: 'caixa_postal' }).where(eq(registroContato.id, l.registroContatoId))
    }
    if (l.leadId) {
      const lead = await db.query.leads.findFirst({ where: eq(leads.id, l.leadId), columns: { empresaId: true } })
      if (lead)
        await db.insert(leadHistory).values({
          empresaId: lead.empresaId,
          leadId: l.leadId,
          userId: p.porUserId,
          action: 'ligacao_nao_atendida',
          details: 'Ligação marcada como "não foi conversa" (caixa postal/desligou) — saiu das efetivas.',
        })
    }
    return
  }

  // Desfazer: só o que foi tirado pelo botão (não muda ligação curta de verdade).
  if (!l.naoEfetivaPorId) throw new Error('Essa ligação não foi tirada pelo botão')
  await db
    .update(pabxLigacoesProcessadas)
    .set({ efetiva: true, statusChamada: 'atendida', naoEfetivaPorId: null, naoEfetivaEm: null })
    .where(eq(pabxLigacoesProcessadas.id, l.id))
  if (l.registroContatoId) {
    await db.update(registroContato).set({ efetiva: true, resultado: 'respondeu' }).where(eq(registroContato.id, l.registroContatoId))
  }
}

// 3. "Foi pelo WhatsApp" (João, 2026-11-18): a ligação saiu pela central mas
//    não completou (sem áudio — "PABXONE360 não devolveu o áudio") e a
//    conversa foi pelo WhatsApp. A MESMA linha vira ligação de WhatsApp, com
//    print e o tempo da ligação — não cria outra, pra não contar duas vezes.
export async function converterParaWhatsapp(p: {
  ligacaoId: number
  porUserId: number
  podeQualquer: boolean
  meusIds: number[]
  duracaoSegundos: number
  printArquivo: { filename: string; originalName: string; mimeType: string; size: number }
  observacao?: string
}): Promise<{ efetiva: boolean; minimo: number }> {
  const l = await db.query.pabxLigacoesProcessadas.findFirst({ where: eq(pabxLigacoesProcessadas.id, p.ligacaoId) })
  if (!l) throw new Error('Ligação não encontrada')
  if (!p.podeQualquer && !(l.userId && p.meusIds.includes(l.userId))) throw new Error('Só quem fez a ligação (ou o gestor) pode mudar isso')
  if (l.fonte === 'whatsapp') throw new Error('Essa ligação já está como WhatsApp')
  const minimo = await segundosMinimosEfetiva()
  const efetiva = p.duracaoSegundos >= minimo
  const urlPrint = `/uploads/${p.printArquivo.filename}`
  const extra = p.observacao?.trim() ? `\n${p.observacao.trim()}` : ''
  const texto = `📱 Ligação pelo WhatsApp — ${formatar(p.duracaoSegundos)}${efetiva ? ' (print da ligação anexado)' : `, abaixo de ${minimo}s: não conta como efetiva`}. A central não completou a ligação.${extra}`

  await db
    .update(pabxLigacoesProcessadas)
    .set({
      fonte: 'whatsapp',
      anexoPrint: urlPrint,
      duracaoSegundos: p.duracaoSegundos,
      efetiva,
      statusChamada: efetiva ? 'atendida' : 'curta',
      linkGravacao: null,
      naoEfetivaPorId: null,
      naoEfetivaEm: null,
    })
    .where(eq(pabxLigacoesProcessadas.id, l.id))
  if (l.registroContatoId) {
    await db
      .update(registroContato)
      .set({ duracaoSegundos: p.duracaoSegundos, efetiva, resultado: efetiva ? 'respondeu' : 'nao_respondeu', observacao: texto })
      .where(eq(registroContato.id, l.registroContatoId))
  }
  if (l.leadId) {
    const lead = await db.query.leads.findFirst({ where: and(eq(leads.id, l.leadId), isNull(leads.deletedAt)) })
    if (lead) {
      await db.insert(leadAttachments).values({ leadId: lead.id, userId: p.porUserId, ...p.printArquivo })
      if (efetiva && !l.efetiva) await registrarLigacaoEfetivaNoLead(lead.id, l.userId ?? p.porUserId, l.dataHora ?? agoraSqlite(), texto)
      else await db.insert(leadHistory).values({ empresaId: lead.empresaId, leadId: lead.id, userId: p.porUserId, action: efetiva ? 'tentativa_contato' : 'ligacao_nao_atendida', details: texto })
    }
  }
  return { efetiva, minimo }
}

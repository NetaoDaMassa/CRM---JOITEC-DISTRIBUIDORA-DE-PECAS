import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, emailMarketingEventos } from '../db/schema.js'

// Integração com Brevo (e-mail marketing) — pedido do João, 2026-09-21.
// Chamada por server/src/routes/brevo.ts (rota pública, um webhook por
// empresa: /api/brevo/webhook/:empresaSlug/:token). Duas origens possíveis
// no MESMO payload de webhook, que a Brevo manda em formatos bem diferentes:
//
// 1) Webhook de automação de marketing (não precisa mexer em DNS) — um
//    evento por envio: abriu, clicou, entregue, rejeitado, spam,
//    descadastrado, bloqueado. Corpo é um objeto (ou array de objetos) com
//    campo `event`.
// 2) Webhook de "Inbound Parsing" (resposta de verdade — exige apontar um
//    subdomínio pro MX da Brevo, ainda não configurado) — corpo tem
//    `items: [...]`, cada item é um e-mail recebido de verdade. Campos
//    exatos aqui foram montados a partir da documentação da Brevo, não
//    testados contra um payload real ainda — `payloadBruto` fica salvo
//    inteiro em cada evento pra ajustar o parser sem precisar mudar o
//    contrato da rota, se algum campo vier diferente na prática.

type TipoEvento =
  | 'entregue'
  | 'aberto'
  | 'clicado'
  | 'resposta'
  | 'rejeitado'
  | 'spam'
  | 'descadastrado'
  | 'bloqueado'

// "aberto" nunca cria lead sozinho (sinal fraco demais — muitas vezes é só o
// cliente de e-mail pré-carregando a imagem). "clicado" e "resposta" criam.
const TIPOS_QUE_CRIAM_LEAD: TipoEvento[] = ['clicado', 'resposta']

const MAPA_EVENTO_BREVO: Record<string, TipoEvento> = {
  delivered: 'entregue',
  opened: 'aberto',
  unique_opened: 'aberto',
  click: 'clicado',
  clicked: 'clicado',
  hardbounce: 'rejeitado',
  hard_bounce: 'rejeitado',
  softbounce: 'rejeitado',
  soft_bounce: 'rejeitado',
  invalid: 'rejeitado',
  spam: 'spam',
  unsubscribed: 'descadastrado',
  unsubscribe: 'descadastrado',
  blocked: 'bloqueado',
}

type EventoNormalizado = {
  tipo: TipoEvento
  email: string
  nomeCampanha: string | null
  assunto: string | null
  url: string | null
  motivo: string | null
  conteudo: string | null
  nomeContato: string | null
  payloadBruto: unknown
}

// Nome legível a partir do e-mail ("joao.silva@x.com" → "Joao Silva") — é o
// melhor palpite disponível: webhook de engajamento da Brevo não manda nome
// de contato, só e-mail. Editável depois na ficha do lead.
function nomeAPartirDoEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const partes = local
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  return partes.length ? partes.join(' ') : email
}

function normalizarPayload(rawBody: unknown): EventoNormalizado[] {
  const body = rawBody as Record<string, unknown> | null | undefined
  if (!body || typeof body !== 'object') return []

  // Formato 2: Inbound Parsing (resposta de verdade).
  if (Array.isArray((body as { items?: unknown }).items)) {
    const items = (body as { items: unknown[] }).items
    const resultado: EventoNormalizado[] = []
    for (const raw of items) {
      const item = raw as Record<string, unknown>
      const from = item.From as Record<string, unknown> | undefined
      const email = String(from?.Address ?? '').toLowerCase().trim()
      if (!email) continue
      const textoBruto =
        (item.RawTextBody as string | undefined) ?? (item.ExtractedMarkdownMessage as string | undefined) ?? ''
      resultado.push({
        tipo: 'resposta',
        email,
        nomeCampanha: null,
        assunto: (item.Subject as string | undefined) ?? null,
        url: null,
        motivo: null,
        conteudo: textoBruto ? textoBruto.slice(0, 8000) : null,
        nomeContato: (from?.Name as string | undefined) ?? null,
        payloadBruto: item,
      })
    }
    return resultado
  }

  // Formato 1: evento de automação de marketing — a Brevo manda um objeto
  // por POST, mas alguns painéis permitem agrupar vários num array.
  const eventos = Array.isArray(body) ? body : [body]
  const resultado: EventoNormalizado[] = []
  for (const raw of eventos) {
    if (!raw || typeof raw !== 'object') continue
    const ev = raw as Record<string, unknown>
    const eventoRaw = String(ev.event ?? ev.Event ?? '').toLowerCase()
    const tipo = MAPA_EVENTO_BREVO[eventoRaw]
    const email = String(ev.email ?? ev.Email ?? '').toLowerCase().trim()
    if (!tipo || !email) continue
    resultado.push({
      tipo,
      email,
      nomeCampanha: (ev.tag as string | undefined) ?? null,
      assunto: (ev.subject as string | undefined) ?? null,
      url: (ev.url as string | undefined) ?? (ev.link as string | undefined) ?? null,
      motivo: (ev.reason as string | undefined) ?? null,
      conteudo: null,
      nomeContato: null,
      payloadBruto: ev,
    })
  }
  return resultado
}

const HISTORICO_LABEL: Record<TipoEvento, string> = {
  entregue: 'E-mail de marketing entregue',
  aberto: 'Abriu e-mail de marketing',
  clicado: 'Clicou em e-mail de marketing',
  resposta: 'Respondeu e-mail de marketing',
  rejeitado: 'E-mail de marketing rejeitado',
  spam: 'Marcou e-mail de marketing como spam',
  descadastrado: 'Descadastrou-se do e-mail marketing',
  bloqueado: 'E-mail de marketing bloqueado',
}

// Processa (e persiste) todos os eventos vindos num único POST do webhook.
// Sempre grava em `emailMarketingEventos`, casado ou não com um lead — é o
// registro bruto que sustenta o relatório e serve de log pra depurar o
// formato do payload real da Brevo.
export async function processarEventoBrevo(empresaId: number, rawBody: unknown): Promise<{ processados: number }> {
  const eventos = normalizarPayload(rawBody)
  let processados = 0

  for (const evento of eventos) {
    const leadExistente = await db.query.leads.findFirst({
      where: and(eq(leads.empresaId, empresaId), sql`lower(${leads.email}) = ${evento.email}`, isNull(leads.deletedAt)),
    })

    let leadId: number | null = leadExistente?.id ?? null
    let leadCriado = false

    if (!leadExistente && TIPOS_QUE_CRIAM_LEAD.includes(evento.tipo)) {
      const nome = evento.nomeContato?.trim() || nomeAPartirDoEmail(evento.email)
      const result = await db.insert(leads).values({
        empresaId,
        name: nome,
        // Sem telefone — e-mail marketing só traz o e-mail. Lead nasce sem
        // vendedor (rodízio por DDD não roda sem DDD) até alguém completar.
        phone: null,
        ddd: null,
        email: evento.email,
        source: `brevo_${evento.tipo}`,
        statusChangedAt: new Date().toISOString(),
      })
      leadId = Number(result.lastInsertRowid)
      leadCriado = true

      await db.insert(leadHistory).values({
        empresaId,
        leadId,
        action: 'criado',
        toStatus: 'novo',
        details: `Lead criado a partir de ${evento.tipo === 'resposta' ? 'resposta' : 'clique'} de e-mail marketing (Brevo) — sem telefone, sem vendedor até completar.`,
      })
      // "entregue" fica de fora do histórico do lead de propósito — dispara
      // em TODO envio de campanha (não é sinal de interesse, é só
      // confirmação técnica) e ia poluir a ficha com uma linha por
      // newsletter mandada. Continua salvo em emailMarketingEventos, só não
      // aparece na timeline.
    } else if (leadExistente && evento.tipo !== 'entregue') {
      await db.insert(leadHistory).values({
        empresaId,
        leadId: leadExistente.id,
        action: 'email_marketing',
        details: HISTORICO_LABEL[evento.tipo] + (evento.assunto ? ` — "${evento.assunto}"` : ''),
      })
    }

    await db.insert(emailMarketingEventos).values({
      empresaId,
      origem: 'brevo',
      tipo: evento.tipo,
      email: evento.email,
      nomeCampanha: evento.nomeCampanha,
      assunto: evento.assunto,
      url: evento.url,
      motivo: evento.motivo,
      conteudo: evento.conteudo,
      leadId,
      leadCriadoAutomaticamente: leadCriado,
      payloadBruto: JSON.stringify(evento.payloadBruto ?? {}),
    })

    processados++
  }

  return { processados }
}

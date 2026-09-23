import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { leads, leadHistory, emailMarketingEventos } from '../db/schema.js'
import { parseTelefone } from './leadsTrackingService.js'
import { getVendorByDDD, getRegionIdByDDD } from './leadsRoundRobin.js'
import { buscarContatoBrevo } from './brevoApi.js'

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

  // Formato 1: evento de automação de marketing (webhook clássico) — a
  // Brevo manda um objeto por POST, mas alguns painéis permitem agrupar
  // vários num array.
  const eventos = Array.isArray(body) ? body : [body]
  const resultado: EventoNormalizado[] = []
  for (const raw of eventos) {
    if (!raw || typeof raw !== 'object') continue
    const ev = raw as Record<string, unknown>
    const eventoRaw = String(ev.event ?? ev.Event ?? '').toLowerCase()
    let tipo = MAPA_EVENTO_BREVO[eventoRaw]
    const email = String(ev.email ?? ev.Email ?? '').toLowerCase().trim()
    let nomeCampanha = (ev.tag as string | undefined) ?? null
    let url = (ev.url as string | undefined) ?? (ev.link as string | undefined) ?? null
    let nomeContato: string | null = null

    // Formato 3: etapa "Chamar um webhook" de DENTRO do editor de
    // automação (mais novo, diferente do webhook clássico acima) — usado
    // pra rotear por empresa quando várias empresas compartilham a mesma
    // conta Brevo (pedido do João, 2026-09-23: separar Joitec Distribuidora
    // de Joitec Automação). Não tem campo `event` nenhum — o próprio
    // gatilho da automação (ex: "Link clicado em um e-mail") já diz qual é
    // o evento, então cada automação corresponde a 1 tipo fixo. Hoje só
    // temos automação de clique montada, então fica fixo 'clicado' — se um
    // dia tiver uma pra "abriu e-mail" etc., precisa diferenciar aqui
    // (não dá pra saber pelo payload em si, só pelo automação que a gerou).
    // Formato real (confirmado no log de produção):
    // { appName: 'workflow-action-processor', attributes: { NOME, SOBRENOME,
    //   COMPANY_NAME, CITY, WHATSAPP, SMS, LANDLINE_NUMBER, ... }, contact_id,
    //   email, params: { campaign_id, clicked_link, email_type }, step_id, workflow_id }
    if (!tipo && typeof ev.workflow_id !== 'undefined' && email) {
      const params = (ev.params as Record<string, unknown> | undefined) ?? {}
      const attrs = (ev.attributes as Record<string, unknown> | undefined) ?? {}
      tipo = 'clicado'
      url = (params.clicked_link as string | undefined) ?? url
      nomeCampanha = params.campaign_id != null ? `Campanha #${params.campaign_id}` : nomeCampanha
      const nomeCompleto = [attrs.NOME, attrs.SOBRENOME].filter(Boolean).join(' ').trim()
      nomeContato = nomeCompleto || null
    }

    if (!tipo || !email) continue
    resultado.push({
      tipo,
      email,
      nomeCampanha,
      assunto: (ev.subject as string | undefined) ?? null,
      url,
      motivo: (ev.reason as string | undefined) ?? null,
      conteudo: null,
      nomeContato,
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
export async function processarEventoBrevo(
  empresaId: number,
  apiKey: string | null,
  rawBody: unknown
): Promise<{ processados: number }> {
  const eventos = normalizarPayload(rawBody)
  let processados = 0

  for (const evento of eventos) {
    const leadExistente = await db.query.leads.findFirst({
      where: and(eq(leads.empresaId, empresaId), sql`lower(${leads.email}) = ${evento.email}`, isNull(leads.deletedAt)),
    })

    let leadId: number | null = leadExistente?.id ?? null
    let leadCriado = false

    if (!leadExistente && TIPOS_QUE_CRIAM_LEAD.includes(evento.tipo)) {
      // Com chave de API configurada, tenta buscar o cadastro completo do
      // contato no Brevo (nome/telefone/empresa/cidade) antes de criar o
      // lead — se achar telefone, o lead já nasce completo (com vendedor,
      // via rodízio por DDD), em vez de parado esperando alguém completar.
      const enriquecido = apiKey ? await buscarContatoBrevo(apiKey, evento.email) : null
      const nome = enriquecido?.nome || evento.nomeContato?.trim() || nomeAPartirDoEmail(evento.email)
      const telefoneParsed = enriquecido?.telefone ? parseTelefone(enriquecido.telefone) : null

      const vendorId = telefoneParsed ? await getVendorByDDD(telefoneParsed.ddd, empresaId) : null
      const regionId = telefoneParsed ? await getRegionIdByDDD(telefoneParsed.ddd, empresaId) : null

      const result = await db.insert(leads).values({
        empresaId,
        name: nome,
        phone: telefoneParsed?.phone ?? null,
        ddd: telefoneParsed?.ddd ?? null,
        email: evento.email,
        company: enriquecido?.empresa ?? null,
        city: enriquecido?.cidade ?? null,
        source: `brevo_${evento.tipo}`,
        vendorId,
        regionId,
        assignedAt: vendorId ? new Date().toISOString() : null,
        statusChangedAt: new Date().toISOString(),
      })
      leadId = Number(result.lastInsertRowid)
      leadCriado = true

      await db.insert(leadHistory).values({
        empresaId,
        leadId,
        action: 'criado',
        toStatus: 'novo',
        details: telefoneParsed
          ? `Lead criado a partir de ${evento.tipo === 'resposta' ? 'resposta' : 'clique'} de e-mail marketing (Brevo) — telefone encontrado no cadastro do Brevo${vendorId ? ' e atribuído ao vendedor' : ''}.`
          : `Lead criado a partir de ${evento.tipo === 'resposta' ? 'resposta' : 'clique'} de e-mail marketing (Brevo) — sem telefone, sem vendedor até completar.`,
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

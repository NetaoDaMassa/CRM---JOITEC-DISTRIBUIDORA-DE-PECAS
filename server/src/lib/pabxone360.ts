// Integração com a API da PABXONE360 — telefonia das 3 empresas Odin
// (Odin Compressores, Odin Tubos e Conexões, Odin Automação), UMA conta só
// na PABXONE360 pras três. Sistema totalmente separado da integração GoTo
// Connect em goto.ts, não misturar. Só REST + polling (a API não tem
// webhook), autenticação por header "usuario"/"token" fixos da conta.
//
// Histórico: nasceu 2026-08 como teste só da Odin Tubos, com ramais
// compartilhados (casava a ligação só pelo telefone do cliente). Desligada
// 2026-10-21. Refeita 2026-10-30 (pedido do João): 1 ramal por vendedor
// (pabx_ramais), então dá pra saber QUEM ligou; registra em cliente da
// carteira E em lead; guarda toda chamada (casando ou não) pro relatório
// de ligações, separando tentativa de ligação efetiva; resumo/transcrição e
// link da gravação quando a PABXONE360 devolve; botão Ligar pelo CRM
// (Click2Call, discar_numero).
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  clientes,
  contasVinculadas,
  empresas,
  funilMensal,
  leadContactAttempts,
  leadHistory,
  leads,
  pabxLigacoesProcessadas,
  pabxRamais,
  registroContato,
  users,
} from '../db/schema.js'
import { agoraSqlite, mesReferenciaAtual } from './dataBr.js'
import { getConfigBool, getConfigNumero, getConfigTexto } from './configuracoes.js'
import { TERMINAL_STATUSES, type LeadStatus } from './leadsStatus.js'
import { contarTentativaSePendente } from '../router/contatos.js'

const BASE_URL = 'https://pabxone360.com.br/suite/api'
export const SLUGS_EMPRESAS_PABX = ['odin-compressores', 'odin-tubos', 'joitec-automacao']

export interface CredenciaisPabx {
  usuario: string
  token: string
}

export async function lerCredenciaisPabx(): Promise<CredenciaisPabx | null> {
  const [usuario, token] = await Promise.all([getConfigTexto('pabxone360_usuario'), getConfigTexto('pabxone360_token')])
  if (!usuario || !token) return null
  return { usuario, token }
}

export type StatusChamada = 'atendida' | 'curta' | 'nao_atendida' | 'ocupado' | 'falha'

export interface ChamadaPabx {
  chamadaId: string
  dataHora: string
  ramal: string | null
  origem: string
  destino: string
  sipCode: string
  duracaoSegundos: number
  efetiva: boolean
  status: StatusChamada
  linkGravacao: string | null
  resumo: string | null
  transcricao: string | null
}

// A PABXONE360 espera data/hora em horário de Brasília (BRT, UTC-3) nos
// parâmetros da busca — mas o servidor roda em UTC (bug real, encontrado
// 2026-08-24: usar data.getDate()/getHours() direto pegava o horário LOCAL
// do processo, que é UTC no container, não BRT). Isso fazia a janela de
// busca ficar sempre 3h adiantada em relação ao "agora" de verdade, então a
// sincronização nunca encontrava as ligações mais recentes — e não dava
// erro, só lista vazia. Sempre calcula BRT por aritmética de offset.
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000

function paraDataBr(data: Date): string {
  const brt = new Date(data.getTime() - TZ_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()}`
}

function paraHoraBr(data: Date): string {
  const brt = new Date(data.getTime() - TZ_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`
}

// "00:01:06" -> 66. Formato sempre HH:MM:SS (sem casas decimais) no campo
// "duracao" — "duracao_real" tem vírgula com milissegundos, não usamos.
function duracaoParaSegundos(duracao: string): number {
  const partes = String(duracao ?? '').split(':').map(Number)
  if (partes.length !== 3 || partes.some(Number.isNaN)) return 0
  const [h, m, s] = partes
  return h * 3600 + m * 60 + s
}

// "odin-202" (ramal de origem OU destino, dependendo se é ligação feita ou
// recebida) -> "202". Ligação em fila sem operador (ex: "DID -> FILA") não
// tem ramal nenhum nos dois campos — não dá pra saber quem atenderia.
function extrairRamal(...campos: string[]): string | null {
  for (const campo of campos) {
    const m = String(campo ?? '').match(/-(\d+)$/)
    if (m) return m[1]
  }
  return null
}

// SIP 200 = conectou de verdade; o resto nunca virou conversa. 486/600 =
// ocupado/recusou; 4xx de número (404/484) e 5xx = falha da chamada;
// qualquer outro (487 cancelado, 480 indisponível, 408 timeout...) = não
// atendeu.
function classificar(sipCode: string, duracaoSegundos: number, duracaoMinima: number): StatusChamada {
  if (sipCode === '200') return duracaoSegundos >= duracaoMinima ? 'atendida' : 'curta'
  if (sipCode === '486' || sipCode === '600') return 'ocupado'
  if (sipCode === '404' || sipCode === '484' || sipCode === '403' || /^5\d\d$/.test(sipCode)) return 'falha'
  return 'nao_atendida'
}

interface CdrBruto {
  chamada_id: string
  data: string
  origem: string
  destino: string
  duracao: string
  sip_code: string
  // Vem como LISTA de links ("[\"https://…/download_audio.php?t=…\"]"), não
  // texto — antes só aceitava texto e descartava todas (João, 2026-11-04).
  link_gravacao?: string | string[]
  [campo: string]: unknown
}

// O nome exato dos campos de resumo/transcrição não está no modelo "CDR" da
// documentação (só aparecem com retorna_resumo/retorna_transcricao=sim) —
// procura qualquer campo de texto cujo nome contenha "resumo"/"transcri".
function campoTexto(c: CdrBruto, trecho: string): string | null {
  for (const [k, v] of Object.entries(c)) {
    if (!k.toLowerCase().includes(trecho)) continue
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v && typeof v === 'object') {
      const texto = JSON.stringify(v)
      if (texto.length > 2) return texto
    }
  }
  return null
}

// Guarda os links um por linha (normalmente 1; ligação transferida pode ter mais).
function linksGravacao(v: unknown): string | null {
  const lista = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x))
  return lista.length ? lista.join('\n') : null
}

async function chamarApi(cred: CredenciaisPabx, caminho: string, init?: { metodo?: 'GET' | 'POST'; query?: Record<string, string>; corpo?: unknown }) {
  const url = `${BASE_URL}/${caminho}${init?.query ? `?${new URLSearchParams(init.query)}` : ''}`
  const resposta = await fetch(url, {
    method: init?.metodo ?? 'GET',
    headers: {
      usuario: cred.usuario,
      token: cred.token,
      Accept: 'application/json',
      ...(init?.corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.corpo ? JSON.stringify(init.corpo) : undefined,
  })
  if (resposta.status === 401) throw new Error('PABXONE360: usuário/token recusados (401) — confira em Telefonia → Configuração')
  const texto = await resposta.text()
  let corpo: { http_response_code?: number; mensagem?: string; [k: string]: unknown }
  try {
    corpo = JSON.parse(texto)
  } catch {
    throw new Error(`PABXONE360: resposta inesperada (${resposta.status})`)
  }
  // Alguns erros vêm como lista de ApiResponse
  if (Array.isArray(corpo)) corpo = corpo[0] ?? {}
  return { status: resposta.status, corpo }
}

async function buscarPagina(
  cred: CredenciaisPabx,
  dataInicio: Date,
  dataFim: Date,
  posInicial: number,
  comResumo: boolean
): Promise<{ dados: CdrBruto[]; total: number }> {
  const query: Record<string, string> = {
    data_inicial: paraDataBr(dataInicio),
    hora_inicial: paraHoraBr(dataInicio),
    data_final: paraDataBr(dataFim),
    hora_final: paraHoraBr(dataFim),
    quantidade: '1000',
    pos_registro_inicial: String(posInicial),
  }
  if (comResumo) {
    query.retorna_resumo = 'sim'
    query.retorna_transcricao = 'sim'
  }
  const { status, corpo } = await chamarApi(cred, 'listar_historico_chamada', { query })
  const codigo = Number(corpo.http_response_code ?? status)
  if (codigo === 404) return { dados: [], total: 0 }
  if (codigo !== 200) throw new Error(`PABXONE360: ${corpo.mensagem || `erro ${codigo}`}`)
  return { dados: (corpo.dados as CdrBruto[]) ?? [], total: Number(corpo.qtd_total_resultados ?? 0) }
}

// Período máximo de 2 meses por chamada (limite da própria API) e no
// máximo 1000 resultados por página — pagina com pos_registro_inicial até
// esgotar.
export async function buscarChamadasPabxone360(
  cred: CredenciaisPabx,
  dataInicio: Date,
  dataFim: Date,
  duracaoMinimaSegundos: number,
  comResumo = false
): Promise<ChamadaPabx[]> {
  const todas: CdrBruto[] = []
  let pos = 0
  while (true) {
    const { dados, total } = await buscarPagina(cred, dataInicio, dataFim, pos, comResumo)
    todas.push(...dados)
    pos += dados.length
    if (dados.length === 0 || pos >= total) break
  }

  return todas.map((c) => {
    const duracaoSegundos = duracaoParaSegundos(c.duracao)
    const sipCode = String(c.sip_code ?? '')
    const status = classificar(sipCode, duracaoSegundos, duracaoMinimaSegundos)
    return {
      chamadaId: String(c.chamada_id),
      dataHora: c.data,
      ramal: extrairRamal(c.origem, c.destino),
      origem: c.origem,
      destino: c.destino,
      sipCode,
      duracaoSegundos,
      efetiva: status === 'atendida',
      status,
      linkGravacao: linksGravacao(c.link_gravacao),
      resumo: campoTexto(c, 'resumo'),
      transcricao: campoTexto(c, 'transcri'),
    }
  })
}

// Ramais cadastrados na conta (só número e nome — a API também devolve
// senha SIP/web do ramal, que nunca sai daqui).
export async function listarRamaisPabx(cred: CredenciaisPabx): Promise<{ numero: string; nome: string }[]> {
  const ramais: { numero: string; nome: string }[] = []
  let pos = 0
  while (true) {
    const { status, corpo } = await chamarApi(cred, 'listar_ramais', { query: { pos_registro_inicial: String(pos) } })
    const codigo = Number(corpo.http_response_code ?? status)
    if (codigo === 404) break
    if (codigo !== 200) throw new Error(`PABXONE360: ${corpo.mensagem || `erro ${codigo}`}`)
    const dados = (corpo.dados as { numero?: string; nome?: string }[]) ?? []
    for (const r of dados) if (r.numero) ramais.push({ numero: String(r.numero), nome: String(r.nome ?? '') })
    pos += dados.length
    if (!dados.length || pos >= Number(corpo.qtd_total_resultados ?? 0)) break
  }
  return ramais.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }))
}

// Click2Call: o PABX chama primeiro o ramal do vendedor e, quando ele
// atende, liga pro número do cliente. Só funciona se o módulo Click2Call
// estiver contratado na PABXONE360.
export async function discarPabx(cred: CredenciaisPabx, ramal: string, numeroDestino: string): Promise<{ chamadaId: string | null }> {
  const { status, corpo } = await chamarApi(cred, 'discar_numero', {
    metodo: 'POST',
    corpo: { dados: { numero_ramal_origem: Number(ramal), numero_destino: numeroDestino } },
  })
  const codigo = Number(corpo.http_response_code ?? status)
  if (codigo !== 200) {
    if (codigo === 486) throw new Error('O PABX não conseguiu completar a ligação (ramal ocupado ou fora do ar?)')
    throw new Error(`PABXONE360: ${corpo.mensagem || `erro ${codigo}`}`)
  }
  return { chamadaId: corpo.chamada_id ? String(corpo.chamada_id) : null }
}

function soDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// Número BR "limpo" pra comparar: tira DDI 55 e zero de operadora/longa
// distância da frente, fica com DDD+número (10 ou 11 dígitos).
function normalizarBr(v: string): string {
  let d = soDigitos(v)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  while (d.length > 11 && d.startsWith('0')) d = d.slice(1)
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  return d
}

// Chave de comparação: últimos 10 dígitos sem o 9 extra de celular — assim
// "47 99700-8385" e "47 9700-8385" (cadastro antigo sem o 9) batem.
function chaveTelefone(v: string): string | null {
  const d = normalizarBr(v)
  if (d.length < 10) return null
  if (d.length === 11 && d[2] === '9') return d.slice(0, 2) + d.slice(3)
  return d.slice(-10)
}

// "21/08/2026 13:28:27" (formato BR que a PABXONE360 devolve, hora de
// Brasília) -> "2026-08-21 16:28:27" (UTC, formato do resto do banco; a tela
// converte de volta pra local). Sem somar as 3h, o horário aparecia 3h
// atrasado no histórico de contatos (bug real, 2026-08-21).
function paraDataHoraSqlite(dataBr: string): string | null {
  const m = String(dataBr ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, dia, mes, ano, hh, mm, ss] = m
  const utcMs = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hh), Number(mm), Number(ss)) + TZ_OFFSET_MS
  return new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19)
}

// Ligação feita (ramal na origem) x recebida (ramal no destino) — só
// interessa quando exatamente um lado tem ramal e o outro é telefone
// externo; ramal-para-ramal (interna) não tem cliente envolvido.
function extrairNumeroExterno(chamada: { origem: string; destino: string }): string | null {
  const origemTemRamal = /-\d+$/.test(chamada.origem)
  const destinoTemRamal = /-\d+$/.test(chamada.destino)
  if (origemTemRamal === destinoTemRamal) return null
  const bruto = origemTemRamal ? chamada.destino : chamada.origem
  // Ligação recebida vem como "47997008385 (DID: 4835124536)" — só os
  // dígitos antes do parênteses interessam.
  return String(bruto ?? '').split('(')[0].trim()
}

function formatarDuracao(seg: number): string {
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return m ? `${m}min ${String(s).padStart(2, '0')}s` : `${s}s`
}

const ROTULO_STATUS: Record<StatusChamada, string> = {
  atendida: 'atendida',
  curta: 'atendida mas muito curta',
  nao_atendida: 'não atendida',
  ocupado: 'ocupado/recusada',
  falha: 'não completou (número com problema?)',
}

// Contas da mesma pessoa (ela + contas_vinculadas), com a empresa de cada.
async function contasDaPessoa(userId: number): Promise<{ id: number; empresaId: number }[]> {
  const vinculos = await db.query.contasVinculadas.findMany({ where: eq(contasVinculadas.userId, userId) })
  const ids = [userId, ...vinculos.map((v) => v.contaVinculadaId)]
  return db.query.users.findMany({ where: inArray(users.id, ids), columns: { id: true, empresaId: true } })
}

type ClienteIdx = { id: number; empresaId: number; vendedorAtualId: number | null }
type LeadIdx = { id: number; empresaId: number; vendorId: number | null; status: LeadStatus; createdAt: string }

// Índice telefone → clientes/leads das 3 empresas Odin, montado 1x por
// rodada (antes carregava a carteira inteira de novo a cada ligação).
async function montarIndiceTelefones(empresaIds: number[]) {
  const porTelCliente = new Map<string, ClienteIdx[]>()
  const porTelLead = new Map<string, LeadIdx[]>()
  const add = <T extends { id: number }>(mapa: Map<string, T[]>, tel: string | null | undefined, item: T) => {
    if (!tel) return
    const chave = chaveTelefone(tel)
    if (!chave) return
    const lista = mapa.get(chave) ?? []
    if (!lista.some((x) => x.id === item.id)) lista.push(item)
    mapa.set(chave, lista)
  }
  const cs = await db.query.clientes.findMany({
    where: and(isNull(clientes.deletedAt), inArray(clientes.empresaId, empresaIds)),
    columns: { id: true, empresaId: true, telefoneWhatsapp: true, vendedorAtualId: true },
    with: { telefonesExtras: { columns: { numero: true } } },
  })
  for (const c of cs) {
    const item = { id: c.id, empresaId: c.empresaId, vendedorAtualId: c.vendedorAtualId }
    add(porTelCliente, c.telefoneWhatsapp, item)
    for (const t of c.telefonesExtras) add(porTelCliente, t.numero, item)
  }
  const ls = await db.query.leads.findMany({
    where: and(isNull(leads.deletedAt), inArray(leads.empresaId, empresaIds)),
    columns: { id: true, empresaId: true, phone: true, vendorId: true, status: true, createdAt: true },
  })
  for (const l of ls) add(porTelLead, l.phone, { id: l.id, empresaId: l.empresaId, vendorId: l.vendorId, status: l.status, createdAt: l.createdAt })
  return { porTelCliente, porTelLead }
}

interface ResultadoRegistroPabx {
  chamadaId: string
  clienteId?: number
  leadId?: number
  registroContatoId?: number
  motivoNaoRegistrado?: string
}

// Roda a cada minuto (scheduler.ts): busca ligações recentes, descobre o
// vendedor pelo ramal (pabx_ramais) e o cliente/lead pelo telefone, e
// registra o contato sozinho — igual o vendedor clicando "Registrar
// contato". Idempotente via pabx_ligacoes_processadas (chamada_id único):
// rodar de novo sobre o mesmo período não duplica nada.
export async function registrarLigacoesAutomaticasPabxone360(
  cred: CredenciaisPabx,
  dataInicio: Date,
  dataFim: Date,
  duracaoMinimaSegundos: number,
  comResumo = false
): Promise<ResultadoRegistroPabx[]> {
  const empresasOdin = await db.query.empresas.findMany({ where: inArray(empresas.slug, SLUGS_EMPRESAS_PABX), columns: { id: true } })
  if (!empresasOdin.length) throw new Error('Empresas Odin não encontradas')
  const idsOdin = empresasOdin.map((e) => e.id)

  const chamadas = await buscarChamadasPabxone360(cred, dataInicio, dataFim, duracaoMinimaSegundos, comResumo)
  if (!chamadas.length) return []

  // Só processa o que ainda não foi visto — evita montar o índice à toa.
  const jaVistas = new Set(
    (
      await db
        .select({ chamadaId: pabxLigacoesProcessadas.chamadaId })
        .from(pabxLigacoesProcessadas)
        .where(inArray(pabxLigacoesProcessadas.chamadaId, chamadas.map((c) => c.chamadaId)))
    ).map((r) => r.chamadaId)
  )
  const novas = chamadas.filter((c) => !jaVistas.has(c.chamadaId))
  if (!novas.length) return []

  const ramais = new Map((await db.query.pabxRamais.findMany()).map((r) => [r.ramal, r.userId]))
  const { porTelCliente, porTelLead } = await montarIndiceTelefones(idsOdin)
  const resultados: ResultadoRegistroPabx[] = []

  for (const chamada of novas) {
    // Reserva o chamadaId ANTES de processar — se outra rodada já pegou
    // (janelas se sobrepõem de propósito), rowsAffected vem 0 e pula.
    const claim = await db.insert(pabxLigacoesProcessadas).values({ chamadaId: chamada.chamadaId }).onConflictDoNothing()
    if (claim.rowsAffected === 0) continue

    const dataHora = paraDataHoraSqlite(chamada.dataHora) ?? agoraSqlite()
    const userIdRamal = chamada.ramal ? (ramais.get(chamada.ramal) ?? null) : null
    const contas = userIdRamal ? await contasDaPessoa(userIdRamal) : []
    const empresasDaPessoa = new Set(contas.map((c) => c.empresaId))
    const contaNaEmpresa = (empresaId: number) => contas.find((c) => c.empresaId === empresaId)?.id ?? null

    const numeroExterno = extrairNumeroExterno(chamada)
    const direcao = /-\d+$/.test(chamada.origem) ? ('OUTBOUND' as const) : ('INBOUND' as const)

    async function finalizar(campos: { empresaId?: number | null; clienteId?: number; leadId?: number; registroContatoId?: number; motivoNaoRegistrado?: string }) {
      await db
        .update(pabxLigacoesProcessadas)
        .set({
          direcao: numeroExterno ? direcao : undefined,
          numeroExterno,
          duracaoSegundos: chamada.duracaoSegundos,
          sipCode: chamada.sipCode,
          clienteId: campos.clienteId,
          leadId: campos.leadId,
          registroContatoId: campos.registroContatoId,
          motivoNaoRegistrado: campos.motivoNaoRegistrado,
          empresaId: campos.empresaId ?? contas.find((c) => c.id === userIdRamal)?.empresaId ?? null,
          userId: userIdRamal,
          ramal: chamada.ramal,
          dataHora,
          efetiva: chamada.efetiva,
          statusChamada: chamada.status,
          linkGravacao: chamada.linkGravacao,
          resumo: chamada.resumo,
          transcricao: chamada.transcricao,
        })
        .where(eq(pabxLigacoesProcessadas.chamadaId, chamada.chamadaId))
      resultados.push({ chamadaId: chamada.chamadaId, ...campos })
    }

    if (!numeroExterno) {
      await finalizar({ motivoNaoRegistrado: 'sem_numero_externo_identificavel' })
      continue
    }
    const chave = chaveTelefone(numeroExterno)
    if (!chave) {
      await finalizar({ motivoNaoRegistrado: 'numero_invalido' })
      continue
    }

    // Prioridade: cliente da(s) empresa(s) do vendedor > lead da(s)
    // empresa(s) dele > cliente de outra empresa Odin > lead de outra.
    // Sem ramal cadastrado, todas as empresas Odin valem igual.
    const daPessoa = (empresaId: number) => !contas.length || empresasDaPessoa.has(empresaId)
    const clientesTel = porTelCliente.get(chave) ?? []
    const leadsTel = porTelLead.get(chave) ?? []
    const escolherCliente = (lista: ClienteIdx[]): ClienteIdx | 'ambiguo' | null => {
      if (!lista.length) return null
      if (lista.length === 1) return lista[0]
      const doVendedor = lista.filter((c) => c.vendedorAtualId && contas.some((x) => x.id === c.vendedorAtualId))
      return doVendedor.length === 1 ? doVendedor[0] : 'ambiguo'
    }
    const escolherLead = (lista: LeadIdx[]): LeadIdx | null => {
      if (!lista.length) return null
      // Lead em aberto primeiro, e o mais recente.
      const ordenada = [...lista].sort(
        (a, b) => Number(TERMINAL_STATUSES.includes(a.status)) - Number(TERMINAL_STATUSES.includes(b.status)) || (a.createdAt < b.createdAt ? 1 : -1)
      )
      return ordenada[0]
    }

    let cliente = escolherCliente(clientesTel.filter((c) => daPessoa(c.empresaId)))
    let lead: LeadIdx | null = null
    if (!cliente) lead = escolherLead(leadsTel.filter((l) => daPessoa(l.empresaId)))
    if (!cliente && !lead && contas.length) {
      cliente = escolherCliente(clientesTel.filter((c) => !daPessoa(c.empresaId)))
      if (!cliente) lead = escolherLead(leadsTel.filter((l) => !daPessoa(l.empresaId)))
    }

    if (cliente === 'ambiguo') {
      await finalizar({ motivoNaoRegistrado: 'numero_ambiguo' })
      continue
    }

    const detalhe = `${direcao === 'OUTBOUND' ? 'feita' : 'recebida'}, ramal ${chamada.ramal ?? '?'}`

    if (cliente) {
      const funil = await db.query.funilMensal.findFirst({
        where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt)),
      })
      if (!funil) {
        await finalizar({ empresaId: cliente.empresaId, clienteId: cliente.id, motivoNaoRegistrado: 'sem_funil_mes_atual' })
        continue
      }
      const observacao = chamada.efetiva
        ? `Ligação ${detalhe} — captada pela PABXONE360, duração ${formatarDuracao(chamada.duracaoSegundos)}.${chamada.resumo ? `\nResumo: ${chamada.resumo}` : ''}`
        : `Ligação ${detalhe} — ${ROTULO_STATUS[chamada.status]} (PABXONE360, ${formatarDuracao(chamada.duracaoSegundos)}).`
      const [registro] = await db
        .insert(registroContato)
        .values({
          funilMensalId: funil.id,
          // Quem ligou (conta dele nesta empresa); se ligou pra cliente de
          // empresa onde não tem conta, fica com o dono do card.
          vendedorId: contaNaEmpresa(cliente.empresaId) ?? funil.vendedorId,
          tipo: 'ligacao',
          origem: 'ligacao_automatica',
          duracaoSegundos: chamada.duracaoSegundos,
          efetiva: chamada.efetiva,
          resultado: chamada.efetiva ? 'respondeu' : 'nao_respondeu',
          observacao,
          dataHora,
        })
        .returning({ id: registroContato.id })

      // Ligação não atendida/curta fica no histórico do card, mas não conta
      // como tentativa de contato de verdade — senão uma ligação perdida
      // sozinha já destrava sair de "Novo" e infla a Cobertura sem ninguém
      // ter conversado com o cliente (achado do João, 2026-08-28).
      // Mesma contagem do "Confirmar" do card (também fecha o "Atrasado").
      if (chamada.efetiva) await contarTentativaSePendente(funil.id)
      await finalizar({ empresaId: cliente.empresaId, clienteId: cliente.id, registroContatoId: registro?.id })
      continue
    }

    if (lead) {
      const quem = contaNaEmpresa(lead.empresaId) ?? lead.vendorId
      if (chamada.efetiva) {
        await registrarLigacaoEfetivaNoLead(lead.id, quem, dataHora, `Ligação ${detalhe} atendida — PABXONE360, ${formatarDuracao(chamada.duracaoSegundos)}`)
      } else {
        await db.insert(leadHistory).values({
          empresaId: lead.empresaId,
          leadId: lead.id,
          userId: quem,
          action: 'ligacao_nao_atendida',
          details: `Ligação ${detalhe} — ${ROTULO_STATUS[chamada.status]} (PABXONE360). Não conta como contato.`,
          createdAt: dataHora,
        })
      }
      await finalizar({ empresaId: lead.empresaId, leadId: lead.id })
      continue
    }

    await finalizar({ motivoNaoRegistrado: 'cliente_nao_encontrado' })
  }

  return resultados
}

// Ligação atendida pra um lead = contato confirmado, mesmas regras do botão
// "Confirmar" (leads.confirmarContato): soma tentativa, limpa alertas de
// SLA e o "Atrasado", e lead em "Novo" vai pra "Abordagem". Se o vendedor
// tinha clicado Ligar (tentativa pendente) nas últimas 2h, confirma aquela
// em vez de criar outra.
async function registrarLigacaoEfetivaNoLead(leadId: number, userId: number | null, dataHora: string, detalhe: string) {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) })
  if (!lead) return
  const duasHorasAntes = new Date(new Date(dataHora.replace(' ', 'T') + 'Z').getTime() - 2 * 3600e3).toISOString().replace('T', ' ').slice(0, 19)
  const pendente = await db.query.leadContactAttempts.findFirst({
    where: and(
      eq(leadContactAttempts.leadId, leadId),
      eq(leadContactAttempts.channel, 'ligacao'),
      isNull(leadContactAttempts.result),
      gte(leadContactAttempts.createdAt, duasHorasAntes)
    ),
    orderBy: desc(leadContactAttempts.id),
  })
  if (pendente) {
    await db.update(leadContactAttempts).set({ result: 'confirmado' }).where(eq(leadContactAttempts.id, pendente.id))
  } else if (userId) {
    await db.insert(leadContactAttempts).values({ leadId, userId, channel: 'ligacao', result: 'confirmado', createdAt: dataHora })
  }

  const agoraIso = new Date(dataHora.replace(' ', 'T') + 'Z').toISOString()
  const proximoVencido = (() => {
    if (!lead.nextContactAt) return false
    const d = new Date(lead.nextContactAt.replace(' ', 'T'))
    d.setHours(0, 0, 0, 0)
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    return d.getTime() < hoje.getTime()
  })()
  const vaiPraAbordagem = lead.status === 'novo'
  await db
    .update(leads)
    .set({
      lastContactAt: agoraIso,
      updatedAt: sql`(datetime('now'))`,
      attemptCount: (lead.attemptCount ?? 0) + 1,
      idleAlertSentAt: null,
      slaStatus: null,
      abordagem4hAlertSentAt: null,
      lastContactStaleAlertSentAt: null,
      nextContactAt: proximoVencido ? null : lead.nextContactAt,
      ...(vaiPraAbordagem ? { status: 'abordagem' as const, statusChangedAt: agoraIso } : {}),
    })
    .where(eq(leads.id, leadId))
  await db.insert(leadHistory).values({ empresaId: lead.empresaId, leadId, userId, action: 'tentativa_contato', details: detalhe })
  if (vaiPraAbordagem) {
    await db.insert(leadHistory).values({
      empresaId: lead.empresaId,
      leadId,
      userId,
      action: 'status_alterado',
      fromStatus: 'novo',
      toStatus: 'abordagem',
      details: 'Movido automaticamente para Abordagem — ligação atendida (PABXONE360)',
    })
  }
}

// O resumo/transcrição costuma ficar pronto só alguns minutos depois de a
// ligação acabar. Esta passada (a cada 15min) busca de novo as últimas
// horas pedindo resumo e completa o que faltou — sem mexer em contato
// nenhum, só nos campos de texto.
export async function completarResumosPabxone360(cred: CredenciaisPabx, dataInicio: Date, dataFim: Date, duracaoMinima: number): Promise<number> {
  const chamadas = (await buscarChamadasPabxone360(cred, dataInicio, dataFim, duracaoMinima, true)).filter(
    (c) => c.resumo || c.transcricao || c.linkGravacao
  )
  let atualizadas = 0
  for (const c of chamadas) {
    const r = await db
      .update(pabxLigacoesProcessadas)
      .set({
        resumo: sql`coalesce(${pabxLigacoesProcessadas.resumo}, ${c.resumo})`,
        transcricao: sql`coalesce(${pabxLigacoesProcessadas.transcricao}, ${c.transcricao})`,
        linkGravacao: sql`coalesce(${pabxLigacoesProcessadas.linkGravacao}, ${c.linkGravacao})`,
      })
      .where(
        and(
          eq(pabxLigacoesProcessadas.chamadaId, c.chamadaId),
          or(isNull(pabxLigacoesProcessadas.resumo), isNull(pabxLigacoesProcessadas.transcricao), isNull(pabxLigacoesProcessadas.linkGravacao))
        )
      )
    atualizadas += r.rowsAffected
  }
  return atualizadas
}

export async function pabxLigada(): Promise<boolean> {
  return getConfigBool('pabxone360_ligada', false)
}

export async function duracaoMinimaPabx(): Promise<number> {
  return getConfigNumero('pabxone360_duracao_minima_segundos', 15)
}

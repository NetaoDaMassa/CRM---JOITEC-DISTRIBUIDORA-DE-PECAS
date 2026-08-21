// Integração de teste com a API da PABXONE360 (telefonia da Odin Tubos e
// Conexões — empresa/sistema totalmente separado da integração GoTo Connect
// em goto.ts, não misturar). Pedido do João: ver tentativas de ligação x
// ligações efetivas, e registrar automaticamente no CRM mesmo quando o
// vendedor liga direto pelo MicroSIP (sem passar pelo botão do CRM). Só
// REST + polling (a API não tem webhook), autenticação por header
// "usuario"/"token" fixos por conta, não OAuth.
//
// Os ramais (201/202) hoje são compartilhados entre várias vendedoras, não
// dá pra atribuir a ligação a uma pessoa pelo ramal. Contorna isso do mesmo
// jeito que goto.ts já faz: casa pelo NÚMERO DE TELEFONE do cliente (últimos
// 10-11 dígitos), não pelo ramal — o cliente já tem um vendedor dono da
// carteira, é esse quem recebe o registro, não importa qual ramal atendeu.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, empresas, funilMensal, registroContato, pabxLigacoesProcessadas } from '../db/schema.js'
import { agoraSqlite, mesReferenciaAtual } from './dataBr.js'

const BASE_URL = 'https://pabxone360.com.br/suite/api'
const SLUG_ODIN_TUBOS = 'odin-tubos'

export interface ChamadaPabx {
  chamadaId: string
  dataHora: string
  ramal: string | null
  origem: string
  destino: string
  sipCode: string
  duracaoSegundos: number
  efetiva: boolean
}

function paraDataBr(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(data.getDate())}/${pad(data.getMonth() + 1)}/${data.getFullYear()}`
}

function paraHoraBr(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(data.getHours())}:${pad(data.getMinutes())}`
}

// "00:01:06" -> 66. Formato sempre HH:MM:SS (sem casas decimais) no campo
// "duracao" — "duracao_real" tem vírgula com milissegundos, não usamos.
function duracaoParaSegundos(duracao: string): number {
  const partes = duracao.split(':').map(Number)
  if (partes.length !== 3 || partes.some(Number.isNaN)) return 0
  const [h, m, s] = partes
  return h * 3600 + m * 60 + s
}

// "odin-202" (ramal de origem OU destino, dependendo se é ligação feita ou
// recebida) -> "202". Ligação em fila sem operador (ex: "DID -> FILA") não
// tem ramal nenhum nos dois campos — não dá pra saber quem atenderia.
function extrairRamal(...campos: string[]): string | null {
  for (const campo of campos) {
    const m = campo.match(/-(\d+)$/)
    if (m) return m[1]
  }
  return null
}

interface CdrBruto {
  chamada_id: string
  data: string
  origem: string
  destino: string
  duracao: string
  sip_code: string
}

async function buscarPagina(
  usuario: string,
  token: string,
  dataInicio: Date,
  dataFim: Date,
  posInicial: number
): Promise<{ dados: CdrBruto[]; total: number }> {
  const params = new URLSearchParams({
    data_inicial: paraDataBr(dataInicio),
    hora_inicial: paraHoraBr(dataInicio),
    data_final: paraDataBr(dataFim),
    hora_final: paraHoraBr(dataFim),
    quantidade: '1000',
    pos_registro_inicial: String(posInicial),
  })
  const resposta = await fetch(`${BASE_URL}/listar_historico_chamada?${params}`, {
    headers: { usuario, token, Accept: 'application/json' },
  })
  if (!resposta.ok) throw new Error(`PABXONE360: falha na API (${resposta.status})`)
  const corpo = await resposta.json()
  if (corpo.http_response_code === 404) return { dados: [], total: 0 }
  if (corpo.http_response_code !== 200) throw new Error(`PABXONE360: ${corpo.mensagem || 'erro desconhecido'}`)
  return { dados: corpo.dados ?? [], total: Number(corpo.qtd_total_resultados ?? 0) }
}

// Período máximo de 2 meses por chamada (limite da própria API) e no
// máximo 1000 resultados por página — pagina com pos_registro_inicial até
// esgotar. Duração mínima pra contar como "efetiva" é a mesma ideia (e
// mesmo padrão de nome de config) já usada em goto.ts pra GoTo Connect.
export async function buscarChamadasPabxone360(
  usuario: string,
  token: string,
  dataInicio: Date,
  dataFim: Date,
  duracaoMinimaSegundos: number
): Promise<ChamadaPabx[]> {
  const todas: CdrBruto[] = []
  let pos = 0
  while (true) {
    const { dados, total } = await buscarPagina(usuario, token, dataInicio, dataFim, pos)
    todas.push(...dados)
    pos += dados.length
    if (dados.length === 0 || pos >= total) break
  }

  return todas.map((c) => {
    const duracaoSegundos = duracaoParaSegundos(c.duracao)
    return {
      chamadaId: c.chamada_id,
      dataHora: c.data,
      ramal: extrairRamal(c.origem, c.destino),
      origem: c.origem,
      destino: c.destino,
      sipCode: c.sip_code,
      duracaoSegundos,
      // SIP 200 = chamada conectada de verdade (487/404/486 etc. são
      // "não atendeu"/"não existe"/"ocupado" — nunca viram conversa real).
      efetiva: c.sip_code === '200' && duracaoSegundos >= duracaoMinimaSegundos,
    }
  })
}

function soDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// "21/08/2026 13:28:27" (formato BR que a PABXONE360 devolve) ->
// "2026-08-21 13:28:27" (formato que o resto do banco usa) — os dois têm
// 19 caracteres, então um length check sozinho não pegaria a troca de
// ordem dia/mês/ano; sem essa conversão, dataHora ficaria fora de ordem
// em qualquer filtro de período que compare como texto.
function paraDataHoraSqlite(dataBr: string): string | null {
  const m = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, dia, mes, ano, hh, mm, ss] = m
  // A API devolve hora LOCAL do Brasil (BRT, UTC-3) — mas o banco guarda
  // tudo em UTC (mesma convenção do datetime('now') do SQLite e da própria
  // agoraSqlite(), que usa toISOString()); a tela é quem converte de volta
  // pra local na hora de mostrar. Sem somar as 3h aqui, o horário aparecia
  // 3h atrasado no histórico de contatos (bug real, reportado 2026-08-21).
  const TZ_OFFSET_MS = 3 * 60 * 60 * 1000
  const utcMs = Date.UTC(Number(ano), Number(mes) - 1, Number(dia), Number(hh), Number(mm), Number(ss)) + TZ_OFFSET_MS
  return new Date(utcMs).toISOString().replace('T', ' ').slice(0, 19)
}

// Compara pelos últimos 10-11 dígitos, igual goto.ts — evita casar errado
// por coincidência de final de número quando o DDD é diferente.
function numeroBate(numeroCliente: string, sufixo10: string, sufixo11: string | null): boolean {
  const d = soDigitos(numeroCliente)
  if (d.length < 10) return false
  if (sufixo11 && d.length >= 11 && d.slice(-11) === sufixo11) return true
  return d.slice(-10) === sufixo10
}

// Ligação feita (ramal na origem) x recebida (ramal no destino) — só
// interessa quando exatamente um lado tem ramal e o outro é telefone
// externo de verdade; ramal-para-ramal (ligação interna) não tem cliente
// nenhum envolvido, ignora.
function extrairNumeroExterno(chamada: { origem: string; destino: string; ramal: string | null }): string | null {
  const origemTemRamal = /-\d+$/.test(chamada.origem)
  const destinoTemRamal = /-\d+$/.test(chamada.destino)
  if (origemTemRamal === destinoTemRamal) return null // interno ou sem ramal nenhum
  const bruto = origemTemRamal ? chamada.destino : chamada.origem
  // Ligação recebida vem como "47997008385 (DID: 4835124536)" — só os
  // dígitos antes do parênteses interessam pro casamento.
  return bruto.split('(')[0].trim()
}

interface ResultadoRegistroPabx {
  chamadaId: string
  clienteId?: number
  registroContatoId?: number
  motivoNaoRegistrado?: string
}

// Roda a cada X minutos (scheduler.ts): busca ligações recentes da
// PABXONE360, casa pelo telefone do cliente (não pelo ramal — ver
// cabeçalho do arquivo) e grava registro_contato automaticamente, exatamente
// como se o vendedor tivesse clicado "Registrar contato" — só que sem
// precisar abrir o card. Idempotente via pabxLigacoesProcessadas (chamadaId
// único), então rodar de novo sobre o mesmo período não duplica nada.
export async function registrarLigacoesAutomaticasPabxone360(
  usuario: string,
  token: string,
  dataInicio: Date,
  dataFim: Date,
  duracaoMinimaSegundos: number
): Promise<ResultadoRegistroPabx[]> {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, SLUG_ODIN_TUBOS) })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada')

  const chamadas = await buscarChamadasPabxone360(usuario, token, dataInicio, dataFim, duracaoMinimaSegundos)
  const resultados: ResultadoRegistroPabx[] = []

  for (const chamada of chamadas) {
    // Reserva o chamadaId ANTES de processar — se outra rodada já pegou
    // essa mesma chamada (períodos de busca se sobrepõem de propósito, pra
    // não perder ligação se uma rodada falhar), rowsAffected vem 0 e pula.
    const claim = await db.insert(pabxLigacoesProcessadas).values({ chamadaId: chamada.chamadaId }).onConflictDoNothing()
    if (claim.rowsAffected === 0) continue

    async function finalizar(campos: {
      direcao?: 'INBOUND' | 'OUTBOUND'
      numeroExterno?: string | null
      clienteId?: number
      registroContatoId?: number
      motivoNaoRegistrado?: string
    }) {
      await db
        .update(pabxLigacoesProcessadas)
        .set({
          direcao: campos.direcao,
          numeroExterno: campos.numeroExterno,
          duracaoSegundos: chamada.duracaoSegundos,
          sipCode: chamada.sipCode,
          clienteId: campos.clienteId,
          registroContatoId: campos.registroContatoId,
          motivoNaoRegistrado: campos.motivoNaoRegistrado,
        })
        .where(eq(pabxLigacoesProcessadas.chamadaId, chamada.chamadaId))
      resultados.push({
        chamadaId: chamada.chamadaId,
        clienteId: campos.clienteId,
        registroContatoId: campos.registroContatoId,
        motivoNaoRegistrado: campos.motivoNaoRegistrado,
      })
    }

    const numeroExterno = extrairNumeroExterno(chamada)
    if (!numeroExterno) {
      await finalizar({ motivoNaoRegistrado: 'sem_numero_externo_identificavel' })
      continue
    }
    const direcao = /-\d+$/.test(chamada.origem) ? 'OUTBOUND' : 'INBOUND'

    const digitos = soDigitos(numeroExterno)
    if (digitos.length < 10) {
      await finalizar({ direcao, numeroExterno, motivoNaoRegistrado: 'numero_invalido' })
      continue
    }
    const sufixo11 = digitos.length >= 11 ? digitos.slice(-11) : null
    const sufixo10 = digitos.slice(-10)

    const todosClientes = await db.query.clientes.findMany({
      where: and(isNull(clientes.deletedAt), eq(clientes.empresaId, empresa.id)),
      columns: { id: true, telefoneWhatsapp: true, vendedorAtualId: true },
      with: { telefonesExtras: { columns: { numero: true } } },
    })
    const clientesQueBatem = todosClientes.filter(
      (c) =>
        (c.telefoneWhatsapp && numeroBate(c.telefoneWhatsapp, sufixo10, sufixo11)) ||
        c.telefonesExtras.some((t) => numeroBate(t.numero, sufixo10, sufixo11))
    )

    if (clientesQueBatem.length === 0) {
      await finalizar({ direcao, numeroExterno, motivoNaoRegistrado: 'cliente_nao_encontrado' })
      continue
    }
    if (clientesQueBatem.length > 1) {
      await finalizar({ direcao, numeroExterno, motivoNaoRegistrado: 'numero_ambiguo' })
      continue
    }

    const cliente = clientesQueBatem[0]
    if (!cliente.vendedorAtualId) {
      await finalizar({ direcao, numeroExterno, clienteId: cliente.id, motivoNaoRegistrado: 'cliente_sem_vendedor' })
      continue
    }

    const funil = await db.query.funilMensal.findFirst({
      where: and(eq(funilMensal.clienteId, cliente.id), eq(funilMensal.mesReferencia, mesReferenciaAtual()), isNull(funilMensal.deletedAt)),
    })
    if (!funil) {
      await finalizar({ direcao, numeroExterno, clienteId: cliente.id, motivoNaoRegistrado: 'sem_funil_mes_atual' })
      continue
    }

    const observacao = chamada.efetiva
      ? `Ligação captada automaticamente pela integração PABXONE360 (${direcao === 'OUTBOUND' ? 'feita' : 'recebida'}, ramal ${chamada.ramal ?? '?'}) — duração ${chamada.duracaoSegundos}s.`
      : `Ligação captada automaticamente pela integração PABXONE360 — não atendida ou muito curta (SIP ${chamada.sipCode}, ${chamada.duracaoSegundos}s).`

    const [registro] = await db
      .insert(registroContato)
      .values({
        funilMensalId: funil.id,
        vendedorId: funil.vendedorId,
        tipo: 'ligacao',
        origem: 'ligacao_automatica',
        duracaoSegundos: chamada.duracaoSegundos,
        efetiva: chamada.efetiva,
        resultado: chamada.efetiva ? undefined : 'nao_respondeu',
        observacao,
        dataHora: paraDataHoraSqlite(chamada.dataHora) ?? agoraSqlite(),
      })
      .returning({ id: registroContato.id })

    await db
      .update(funilMensal)
      .set({ qtdTentativasContato: funil.qtdTentativasContato + 1, dataUltimoContato: agoraSqlite() })
      .where(eq(funilMensal.id, funil.id))

    await finalizar({ direcao, numeroExterno, clienteId: cliente.id, registroContatoId: registro?.id })
  }

  return resultados
}

// IA do Módulo Marketing — revisar roteiros, criar/reescrever roteiro,
// analisar Instagram, ler directs, gerar ideias e sugerir persona/SWOT.
// Pedido do João, 2026-11-20: "quero dos 2 jeitos" — cada pedido funciona
// (1) pela chave da Anthropic do CRM ou (2) copiando o pedido, colando no
// Claude e colando a resposta de volta. Os dois usam o MESMO texto de pedido
// (montarPedido) e a MESMA leitura da resposta (aplicarResposta).
import Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { mktPecas, mktPlanos, mktPerfis, mktIgMidias, mktIgConversas, mktIgSeguidores, mktConcorrentesFotos, mktAnalises, mktIdeias } from '../db/schema.js'
import { blocoConhecimento } from './marketingParte3.js'
import { getConfigTexto } from './configuracoes.js'

export const MARCAS = [
  { empresaId: 4, nome: 'Odin Compressores', desc: 'compressores de ar industriais (parafuso e pistão, 10 a 200 HP), venda para indústrias e revendas' },
  { empresaId: 2, nome: 'Odin Tubos e Conexões', desc: 'tubos e conexões PPR (linha azul para ar comprimido, linha verde para água quente e fria), venda para revendas e instaladores' },
  { empresaId: 3, nome: 'Odin Automação Pneumática', desc: 'componentes de automação pneumática para indústrias' },
  { empresaId: 1, nome: 'Joitec Distribuidora', desc: 'distribuidora de peças para compressores e ferramentas, atende assistências técnicas e revendas' },
  { empresaId: 6, nome: 'Compretec', desc: 'loja de compressores e ferramentas, balcão e e-commerce, público final e pequenos profissionais' },
] as const
export function marca(empresaId: number) {
  return MARCAS.find((m) => m.empresaId === empresaId)
}

export const STATUS_PECA = ['Ideia', 'Roteiro', 'Aprovação do roteiro', 'Produção', 'Aprovação final', 'Agendado na mLabs'] as const
export const MODELO_V = 'GANCHO (0–3 s)\nFala: \nNa tela: \n\nDESENVOLVIMENTO\n1. Fala:  | Cena: \n2. Fala:  | Cena: \n3. Fala:  | Cena: \n\nTEXTO NA TELA\n- \n\nCTA FINAL\n\n\nDURAÇÃO ALVO: 30 s\nÁUDIO SUGERIDO: '
export const MODELO_P = 'TEXTO DA ARTE / LÂMINAS\n1. \n2. \n3. \n\nOBSERVAÇÕES DE DESIGN\n'

const CRITERIOS = `Critérios:
1. Gancho: prende nos 2–3 primeiros segundos com dor, pergunta ou cena concreta. Nada de logo, vinheta ou "olá pessoal".
2. Clareza: uma ideia só, linguagem do cliente (dono de oficina, indústria, revenda, instalador).
3. Produto e benefício: mostra o produto/serviço certo e o ganho prático.
4. CTA: uma chamada clara e única (WhatsApp, orçamento, visita).
5. Formato: vídeo de 20–45 s com cenas que a equipe consegue gravar; post com texto curto por lâmina.
6. Risco: números, prazos, preços ou dados técnicos que podem estar errados e precisam ser confirmados.
7. Coerência com o objetivo do mês, com o pilar e com a persona.`

export type TipoPedido = 'revisao' | 'criar' | 'reescrever' | 'instagram' | 'mes' | 'directs' | 'ideias' | 'persona' | 'legenda' | 'adaptar'
export type ParamsPedido = { pecaIds?: string[]; pecaId?: string; empresaId?: number; mes?: string; ideiaId?: number }
const FORMATO: Record<TipoPedido, 'json' | 'texto'> = { revisao: 'json', criar: 'texto', reescrever: 'texto', instagram: 'texto', mes: 'texto', directs: 'texto', ideias: 'json', persona: 'json', legenda: 'texto', adaptar: 'texto' }

function j<T>(s: string | null | undefined, padrao: T): T {
  try { return s ? (JSON.parse(s) as T) : padrao } catch { return padrao }
}
export function rotHash(p: { roteiro?: string | null; gancho?: string | null; titulo?: string | null }) {
  const s = `${p.roteiro || ''}|${p.gancho || ''}|${p.titulo || ''}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

const CAMPOS_PERSONA: [string, string][] = [['nome', 'Nome'], ['quem', 'Quem é'], ['dores', 'Dores'], ['desejos', 'O que quer'], ['objecoes', 'Objeções'], ['onde', 'Onde se informa'], ['tom', 'Como falar']]
export async function personaTexto(empresaId: number): Promise<string> {
  const p = await db.query.mktPerfis.findFirst({ where: eq(mktPerfis.empresaId, empresaId) })
  if (!p) return ''
  const ps = j<any[]>(p.personas, []).filter((x) => Object.values(x || {}).some((v) => String(v || '').trim()))
  const sw = j<any>(p.swot, {})
  const l = (t: string, a?: string[]) => (a && a.filter(Boolean).length ? `${t}: ${a.filter(Boolean).join('; ')}` : '')
  const partes: string[] = []
  if (ps.length) partes.push('PERSONAS:\n' + ps.map((x) => CAMPOS_PERSONA.map(([k, lab]) => (x[k] ? `${lab}: ${x[k]}` : '')).filter(Boolean).join(' | ')).join('\n'))
  const s = [l('Forças', sw.forcas), l('Fraquezas', sw.fraquezas), l('Oportunidades', sw.oportunidades), l('Ameaças', sw.ameacas)].filter(Boolean)
  if (s.length) partes.push('SWOT:\n' + s.join('\n'))
  return partes.join('\n').slice(0, 3000)
}

async function contextoPeca(id: string): Promise<{ texto: string; peca: typeof mktPecas.$inferSelect }> {
  const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, id) })
  if (!p) throw new Error('Peça não encontrada.')
  const pl = await db.query.mktPlanos.findFirst({ where: eq(mktPlanos.id, p.planoId) })
  const d = j<any>(pl?.dados, {})
  const pi = (d.pilares || []).find((x: any) => x.id === p.pilar)
  const pers = await personaTexto(p.empresaId)
  const texto = `ID: ${p.id}\nEmpresa: ${marca(p.empresaId)?.nome || p.empresaId}\nObjetivo do mês: ${d.objetivo || '-'}\nMensagem central: ${d.mensagem || '-'}\nPilar: ${pi ? `${pi.nome} (${pi.desc || ''})` : '-'}\nTipo: ${p.tipo} | Data: ${p.data || '-'}\nPauta: ${p.titulo || '-'}\nGancho: ${p.gancho || '-'}\nCTA: ${p.cta || '-'}\nObservações: ${(p.obs || '-').slice(0, 300)}\nROTEIRO:\n${(p.roteiro || '').slice(0, 3500)}\nLEGENDA:\n${(p.legenda || '').slice(0, 600)}${pers ? `\nPERSONA E SWOT DA EMPRESA (use para acertar o tom e a dor):\n${pers}` : ''}`
  return { texto, peca: p }
}

function mesLongo(m: string) {
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const [y, mm] = m.split('-')
  return `${nomes[Number(mm) - 1]} de ${y}`
}
function fimMes(m: string) {
  const [y, mm] = m.split('-').map(Number)
  return `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`
}

async function resumoInstagram(empresaId: number, de: string, ate: string): Promise<string> {
  const midias = await db.select().from(mktIgMidias).where(and(eq(mktIgMidias.empresaId, empresaId), gte(mktIgMidias.data, de), lte(mktIgMidias.data, ate)))
  const seg = await db.select().from(mktIgSeguidores).where(and(eq(mktIgSeguidores.empresaId, empresaId), gte(mktIgSeguidores.data, de), lte(mktIgSeguidores.data, ate))).orderBy(mktIgSeguidores.data)
  if (!midias.length) return 'Sem dados do Instagram no período.'
  const ord = [...midias].sort((a, b) => (b.views || b.alcance) - (a.views || a.alcance))
  const eng = (m: typeof midias[number]) => (m.alcance ? ((m.curtidas + m.comentarios + m.compartilhamentos + m.salvos) / m.alcance) * 100 : 0)
  const segTxt = seg.length ? `${seg[0].seguidores} → ${seg[seg.length - 1].seguidores}` : 'sem dado'
  return `Período: ${de} a ${ate}\nSeguidores: ${segTxt}\nConteúdos (do melhor para o pior):\n` + ord.map((m) => `- ${m.data} | ${m.tipo} | views ${m.views} | alcance ${m.alcance} | curtidas ${m.curtidas} | coment ${m.comentarios} | compart ${m.compartilhamentos} | salvos ${m.salvos} | eng ${eng(m).toFixed(1)}% | "${m.legenda.replace(/\s+/g, ' ').slice(0, 160)}"`).join('\n').slice(0, 20000)
}

export async function montarPedido(tipo: TipoPedido, params: ParamsPedido): Promise<{ prompt: string; formato: 'json' | 'texto' }> {
  const formato = FORMATO[tipo]
  if (tipo === 'revisao') {
    const ids = (params.pecaIds || []).slice(0, 8)
    if (!ids.length) throw new Error('Nenhuma peça para revisar.')
    const blocos = []
    const empresas = new Set<number>()
    for (let i = 0; i < ids.length; i++) { const c = await contextoPeca(ids[i]); empresas.add(c.peca.empresaId); blocos.push(`=== PEÇA ${i + 1} ===\n${c.texto}`) }
    let base = ''
    for (const e of empresas) { const b = await blocoConhecimento(e, Math.floor(12000 / empresas.size)); if (b) base += `\n[${marca(e)?.nome}]${b}` }
    const prompt = `${base ? base + '\n' : ''}Você é o editor-chefe de conteúdo do Grupo Odin (compressores de ar, tubos e conexões PPR, automação pneumática, distribuidora de peças, loja de compressores e ferramentas — público B2B e balcão). Revise cada roteiro como um diretor exigente faria antes de liberar para gravação. Seja direto e prático.\n\n${CRITERIOS}\n\nRegras do veredito: "aprovar" = nota 8 a 10 e nada grave para confirmar; "ajustar" = nota 5 a 7; "refazer" = nota 0 a 4.\n\nResponda SOMENTE com um JSON array, um objeto por peça, na mesma ordem, assim:\n[{"id":"<ID>","nota":7,"veredito":"ajustar","resumo":"uma frase","problemas":["até 3 itens curtos"],"gancho":"gancho melhor, ou \\"\\" se o atual está bom","confirmar":["dado a confirmar antes de gravar"]}]\nTexto em português do Brasil.\n\n${blocos.join('\n\n')}`
    return { prompt, formato }
  }
  if (tipo === 'criar' || tipo === 'reescrever' || tipo === 'legenda') {
    const ctx = await contextoPeca(params.pecaId || '')
    const peca = ctx.peca
    const texto = ctx.texto + (await blocoConhecimento(peca.empresaId))
    const modelo = peca.tipo === 'Post' ? MODELO_P : MODELO_V
    if (tipo === 'legenda') {
      return { formato, prompt: `Escreva a legenda (copy) desta peça para Instagram e Facebook do Grupo Odin. ${peca.tipo === 'Post' ? 'É um post de imagem/carrossel.' : 'É um vídeo curto (Reels/TikTok/Shorts).'}\nRegras: a primeira linha precisa prender (é o que aparece antes do "... mais"); depois 2 a 4 linhas curtas com o benefício prático; uma chamada única no fim (WhatsApp, orçamento ou visita); por último 3 a 5 hashtags. Linguagem do cliente, sem exagero e sem emoji demais. Não invente números, preços ou dados técnicos: se precisar, escreva [CONFIRMAR: ...].\nResponda só com a legenda pronta, sem comentários.\n\n${texto}` }
    }
    if (tipo === 'criar') {
      return { formato, prompt: `Escreva o roteiro desta peça para as redes sociais do Grupo Odin. ${peca.tipo === 'Post' ? 'É um post de imagem/carrossel.' : 'É um vídeo curto (Reels/TikTok/Shorts) de 20 a 45 segundos, gravável pela equipe com celular.'}\nNão invente números, preços ou dados técnicos: se precisar, escreva [CONFIRMAR: ...].\n${CRITERIOS}\n\nUse exatamente este modelo:\n${modelo}\n\nDepois do roteiro, escreva uma linha "LEGENDA:" com a legenda pronta (até 4 linhas + 3 a 5 hashtags).\nResponda só com o roteiro e a legenda.\n\n${texto}` }
    }
    const a = j<any>(peca.analise, null)
    return { formato, prompt: `Reescreva o roteiro abaixo corrigindo os problemas apontados. Mantenha o produto, a pauta e o CTA, a menos que estejam errados. Não invente números, preços ou dados técnicos: se precisar de um dado, escreva [CONFIRMAR: ...].\n${CRITERIOS}\n\nProblemas apontados: ${a ? (a.problemas || []).join('; ') : 'nenhum'}\nGancho sugerido: ${a?.gancho || '-'}\n\nUse exatamente este modelo:\n${modelo}\n\nResponda só com o roteiro novo, sem comentários.\n\n${texto}` }
  }
  if (tipo === 'adaptar') {
    const ideia = await db.query.mktIdeias.findFirst({ where: eq(mktIdeias.id, Number(params.ideiaId)) })
    if (!ideia) throw new Error('Ideia não encontrada.')
    const mi = marca(ideia.empresaId)
    const plA = await db.select().from(mktPlanos).where(eq(mktPlanos.empresaId, ideia.empresaId)).orderBy(desc(mktPlanos.mes)).limit(1)
    const dA = j<any>(plA[0]?.dados, {})
    const persA = await personaTexto(ideia.empresaId)
    return { formato, prompt: `Você é estrategista de conteúdo desta empresa. A equipe guardou a ideia abaixo (de outra marca ou de outro nicho). Traga ela para a realidade desta empresa: produto certo, cliente certo, cenário que a equipe consegue gravar aqui.\nEmpresa: ${mi?.nome} (Grupo Odin, Santa Catarina) — ${mi?.desc}.\n${persA ? persA + '\n' : ''}${plA[0] ? `Plano do mês: objetivo "${dA.objetivo || ''}", pilares ${(dA.pilares || []).map((p: any) => p.nome).join(', ')}\n` : ''}${await blocoConhecimento(ideia.empresaId, 12000)}\nIDEIA GUARDADA:\nTítulo: ${ideia.titulo || '-'}\nLink: ${ideia.url || '-'} (você não consegue abrir o link; use a descrição)\nPor que inspira: ${ideia.nota || '-'}\nMais informações: ${ideia.detalhes || '-'}\n\nResponda em português do Brasil, simples, neste formato:\nTÍTULO:\nFORMATO: (Vídeo ou Post/carrossel, e a duração)\nPILAR:\nGANCHO (3 primeiros segundos):\nROTEIRO RESUMIDO: 3 a 6 passos (fala + cena)\nLEGENDA SUGERIDA:\nO QUE PRECISA PARA GRAVAR: produto, pessoa, lugar\nPOR QUE FUNCIONA AQUI: 1 frase\nNão invente números, preços ou dados técnicos: se precisar, escreva [CONFIRMAR: ...].` }
  }
  const empresaId = Number(params.empresaId)
  const m = marca(empresaId)
  if (!m) throw new Error('Marca inválida.')
  const pers = (await personaTexto(empresaId)) + (await blocoConhecimento(empresaId, 10000))
  const intro = `Empresa: ${m.nome} (Grupo Odin, Santa Catarina) — ${m.desc}.`
  if (tipo === 'instagram') {
    const ate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const de = new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    return { formato, prompt: `Você é um estrategista de conteúdo sênior para marcas industriais B2B no Brasil. Faça uma análise completa do Instagram desta empresa com os dados reais abaixo, para um gestor que não é da área.\n${intro}\n\n${pers ? `O QUE JÁ SABEMOS DA EMPRESA:\n${pers}\n\n` : ''}DADOS DO INSTAGRAM:\n${await resumoInstagram(empresaId, de, ate)}\n\nResponda em português do Brasil, simples e direto, neste formato:\nDIAGNÓSTICO: 3 frases com números.\nPADRÕES DO QUE FUNCIONA: 3 a 5 itens (tema, formato, gancho, horário) citando os posts entre aspas.\nO QUE PARAR DE FAZER: 3 itens.\nPÚBLICO: o que os dados sugerem sobre quem está assistindo.\n5 IDEIAS DE VÍDEO PARA AS PRÓXIMAS 2 SEMANAS: título + gancho dos 3 primeiros segundos.\nMETA REALISTA PARA 30 DIAS: seguidores, views por reel e engajamento.\nNão invente números que não estão nos dados.` }
  }
  const mes = params.mes || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
  if (tipo === 'mes') {
    const pl = await db.query.mktPlanos.findFirst({ where: and(eq(mktPlanos.empresaId, empresaId), eq(mktPlanos.mes, mes)) })
    const d = j<any>(pl?.dados, {})
    return { formato, prompt: `Você é o diretor de marketing desta empresa. Analise os conteúdos publicados no Instagram em ${mesLongo(mes)}.\n${intro}\nObjetivo do mês: ${d.objetivo || 'não informado'}.\n${pers ? pers + '\n' : ''}\nConteúdos:\n${await resumoInstagram(empresaId, `${mes}-01`, fimMes(mes))}\n\nResponda em português do Brasil, simples, para um gestor que não é da área, neste formato exato:\nRESUMO: 2 frases com o que aconteceu no mês (cite números).\nO QUE FUNCIONOU:\n1. ...\n2. ...\n3. ...\nO QUE NÃO FUNCIONOU:\n1. ...\n2. ...\nFAZER NA PRÓXIMA SEMANA:\n1. ...\n2. ...\n3. ...\nCite os posts pelo começo do texto entre aspas. Não invente números.` }
  }
  if (tipo === 'directs') {
    const convs = await db.select().from(mktIgConversas).where(and(eq(mktIgConversas.empresaId, empresaId), gte(mktIgConversas.ultimaEm, `${mes}-01`), lte(mktIgConversas.ultimaEm, `${fimMes(mes)} 23:59:59`))).orderBy(desc(mktIgConversas.ultimaEm)).limit(40)
    if (!convs.length) throw new Error('Nenhum direct neste mês para analisar.')
    const textos = convs.map((c) => '--- conversa ---\n' + j<any[]>(c.mensagens, []).map((x) => `${x.de === 'marca' ? 'EMPRESA' : 'CLIENTE'}: ${String(x.texto || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n'))
    return { formato, prompt: `Você é gestor de social media desta empresa (B2B industrial). Abaixo estão as conversas de direct do Instagram de ${mesLongo(mes)}.\n${intro}\nNÃO escreva nomes, usernames, telefones ou e-mails de clientes na resposta.\n${pers ? pers + '\n' : ''}\n${textos.join('\n\n').slice(0, 80000)}\n\nResponda em português do Brasil neste formato:\nRESUMO: quantas conversas, de que tipo (orçamento, dúvida técnica, reclamação, parceria, spam).\nPERGUNTAS MAIS FREQUENTES: até 5, com quantas vezes apareceram.\nOPORTUNIDADES DE VENDA: o que parece lead quente (sem nomes).\nPROBLEMAS NO ATENDIMENTO: demora, falta de resposta, resposta automática ruim.\n5 PAUTAS DE CONTEÚDO tiradas dessas dúvidas: título + gancho dos 3 primeiros segundos.` }
  }
  if (tipo === 'ideias') {
    const pl = await db.query.mktPlanos.findFirst({ where: and(eq(mktPlanos.empresaId, empresaId), eq(mktPlanos.mes, mes)) })
    const d = j<any>(pl?.dados, {})
    const dir = await db.query.mktAnalises.findFirst({ where: eq(mktAnalises.chave, `directs-${empresaId}-${mes}`) })
    const igA = await db.query.mktAnalises.findFirst({ where: eq(mktAnalises.chave, `ig-${empresaId}`) })
    const fotos = await db.select().from(mktConcorrentesFotos).where(eq(mktConcorrentesFotos.empresaId, empresaId)).orderBy(desc(mktConcorrentesFotos.data)).limit(20)
    const vistos = new Set<string>()
    const conc = fotos.filter((f) => !vistos.has(f.handle) && vistos.add(f.handle)).map((f) => {
      const top = j<any[]>(f.midias, []).sort((a, b) => b.curtidas + b.comentarios - (a.curtidas + a.comentarios)).slice(0, 3)
      return `@${f.handle} (${f.seguidores ?? '?'} seguidores): ` + top.map((x) => `"${String(x.legenda).slice(0, 90)}" (${x.curtidas} curtidas)`).join('; ')
    }).join('\n')
    return { formato, prompt: `Você é estrategista de social media desta empresa. Gere 10 ideias de conteúdo para a próxima semana, específicas desta empresa, variadas em formato e pilar.\n${intro}\n${pers}\n\nPlano do mês: ${pl ? `objetivo "${d.objetivo || ''}", pilares ${(d.pilares || []).map((p: any) => p.nome).join(', ')}` : 'sem plano'}\nInstagram do mês:\n${(await resumoInstagram(empresaId, `${mes}-01`, fimMes(mes))).slice(0, 6000)}\n${dir ? 'Leitura dos directs:\n' + dir.texto.slice(0, 3000) : ''}\n${igA ? 'Análise do Instagram:\n' + igA.texto.slice(0, 3000) : ''}\n${conc ? 'Concorrentes (o que mais deu certo neles):\n' + conc : ''}\n\nResponda SOMENTE com JSON array de 10 objetos: [{"titulo":"","tipo":"Vídeo","pilar":"","gancho":"frase dos 3 primeiros segundos","porque":"1 frase: em que dado se baseia"}] (tipo é "Vídeo" ou "Post"). Português do Brasil. Não invente números.` }
  }
  // persona
  const pl = await db.select().from(mktPlanos).where(eq(mktPlanos.empresaId, empresaId)).orderBy(desc(mktPlanos.mes)).limit(1)
  const d = j<any>(pl[0]?.dados, {})
  const ate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const de = new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  return { formato, prompt: `Você é estrategista de marketing B2B. Com base nos dados abaixo, proponha 2 personas e uma análise SWOT para esta empresa.\n${intro}\nOutras empresas do grupo: ${MARCAS.filter((x) => x.empresaId !== empresaId).map((x) => `${x.nome} (${x.desc})`).join('; ')}.\n\n${pl[0] ? `Objetivo do mês: ${d.objetivo || '-'}\nPilares: ${(d.pilares || []).map((p: any) => `${p.nome} (${p.desc || ''})`).join('; ')}\nO que funcionou: ${(d.funcionou || []).join('; ')}\nO que travou: ${(d.travou || []).join('; ')}\n` : ''}INSTAGRAM:\n${(await resumoInstagram(empresaId, de, ate)).slice(0, 20000)}\n${pers ? 'JÁ CADASTRADO:\n' + pers : ''}\n\nResponda SOMENTE com JSON neste formato:\n{"personas":[{"nome":"","quem":"","dores":"","desejos":"","objecoes":"","onde":"","tom":""}],"swot":{"forcas":["..."],"fraquezas":["..."],"oportunidades":["..."],"ameacas":["..."]}}\nCada campo de persona com 1 a 2 frases. 3 a 5 itens por quadrante da SWOT, curtos e específicos para esta empresa. Português do Brasil. Marque com "(confirmar)" o que for suposição sua.` }
}

// ---------- chamada à API ----------
let cliente: Anthropic | null = null
function obterCliente(): Anthropic {
  if (!cliente) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('A chave da Anthropic não está configurada no CRM. Use o modo "Copiar pedido".')
    cliente = new Anthropic({ apiKey })
  }
  return cliente
}
function erroAmigavel(e: unknown): Error {
  const status = (e as { status?: number })?.status
  const msg = String((e as Error)?.message || '')
  console.error('[marketing-ia] falha ao chamar Anthropic:', e)
  if (status === 401) return new Error('A chave da Anthropic do CRM é inválida. Use o modo "Copiar pedido" enquanto isso.')
  if (status === 400 && /credit|balance/i.test(msg)) return new Error('A conta da Anthropic está sem crédito. Coloque crédito em console.anthropic.com → Billing, ou use o modo "Copiar pedido".')
  if (status === 429 || (status && status >= 500)) return new Error('O Claude está ocupado agora. Tente de novo em 1 minuto, ou use o modo "Copiar pedido".')
  return new Error('Não foi possível falar com o Claude agora. Use o modo "Copiar pedido".')
}
export const MODELO_IA = process.env.MARKETING_IA_MODELO || 'claude-sonnet-5-5'

// OpenRouter (João, 2026-11-22): conta da Anthropic sem crédito, a IA do
// marketing passa pelo OpenRouter. 2026-11-23 ("deixar os botões de IA mais
// rápidos"): o modelo grátis (Nemotron Ultra) levava 1–3 min e só aceitava 50
// pedidos/dia. Agora usa Claude Haiku 5.5 (pago, ~3 s, centavos por pedido).
// Trocar só pela configuração mkt_ia_modelo — a variável de ambiente antiga
// OPENROUTER_MODEL_MARKETING (que apontava para o grátis) é ignorada de propósito.
// Se o modelo principal falhar (ocupado/sem crédito/demora), tenta 1x num grátis.
const MODELO_RAPIDO = 'anthropic/claude-haiku-5.5'
const MODELO_RESERVA = 'nvidia/nemotron-3.5-lightning:free'
class ErroIa extends Error { constructor(msg: string, public tentarOutro: boolean) { super(msg) } }

async function chamarModelo(modelo: string, prompt: string, segundos: number): Promise<string> {
  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'CRM - Marketing' },
      body: JSON.stringify({ model: modelo, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(segundos * 1000),
    })
  } catch (e) {
    console.error(`[marketing-ia] falha de rede/tempo no OpenRouter (${modelo}):`, (e as Error)?.message)
    throw new ErroIa('A IA demorou demais para responder. Tente de novo em 1 minuto, ou use o modo "Copiar pedido".', true)
  }
  if (!res.ok) {
    console.error('[marketing-ia] OpenRouter respondeu', modelo, res.status, (await res.text().catch(() => '')).slice(0, 500))
    if (res.status === 401) throw new ErroIa('A chave do OpenRouter do CRM é inválida. Use o modo "Copiar pedido" enquanto isso.', false)
    if (res.status === 402) throw new ErroIa('O OpenRouter está sem crédito. Coloque crédito em openrouter.ai → Credits, ou use o modo "Copiar pedido".', true)
    if (res.status === 429 || res.status >= 500 || res.status === 404) throw new ErroIa('A IA está ocupada agora. Tente de novo em 1 minuto, ou use o modo "Copiar pedido".', true)
    throw new ErroIa('Não foi possível falar com a IA agora. Use o modo "Copiar pedido".', false)
  }
  const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null
  const texto = String(json?.choices?.[0]?.message?.content ?? '').trim()
  if (!texto) throw new ErroIa('A IA não devolveu texto. Tente de novo.', true)
  return texto
}

async function chamarOpenRouter(prompt: string): Promise<string> {
  const modelo = (await getConfigTexto('mkt_ia_modelo'))?.trim() || MODELO_RAPIDO
  const t0 = Date.now()
  try {
    const r = await chamarModelo(modelo, prompt, 90)
    console.log(`[marketing-ia] ${modelo} respondeu em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return r
  } catch (e) {
    if (!(e instanceof ErroIa) || !e.tentarOutro || modelo === MODELO_RESERVA) throw e
    console.warn(`[marketing-ia] ${modelo} falhou (${e.message}); tentando ${MODELO_RESERVA}`)
    return chamarModelo(MODELO_RESERVA, prompt, 90)
  }
}

export async function chamarClaude(prompt: string): Promise<string> {
  if (process.env.OPENROUTER_API_KEY) return chamarOpenRouter(prompt)
  try {
    const r = await obterCliente().messages.create({ model: MODELO_IA, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] })
    const texto = r.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim()
    if (!texto) throw new Error('O Claude não devolveu texto.')
    return texto
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('O Claude não devolveu')) throw e
    throw erroAmigavel(e)
  }
}

export function lerJson(texto: string): any {
  let t = texto.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try { return JSON.parse(t) } catch { /* segue */ }
  const ini = t.search(/[[{]/)
  const fim = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'))
  if (ini >= 0 && fim > ini) {
    try { return JSON.parse(t.slice(ini, fim + 1)) } catch { /* segue */ }
  }
  throw new Error('A resposta não está no formato esperado. Copie a resposta inteira do Claude (incluindo os colchetes [ ] ou chaves { }) e cole de novo.')
}

export function separarLegenda(t: string) {
  const i = t.search(/\n\s*LEGENDA:/i)
  if (i < 0) return { roteiro: t.trim(), legenda: '' }
  return { roteiro: t.slice(0, i).trim(), legenda: t.slice(i).replace(/^\s*LEGENDA:\s*/i, '').trim() }
}

// Lê a resposta (da API ou colada) e grava o que for o caso.
export async function aplicarResposta(tipo: TipoPedido, params: ParamsPedido, texto: string, userId: number | null): Promise<any> {
  const limpo = String(texto || '').trim()
  if (!limpo) throw new Error('Cole a resposta do Claude.')
  if (tipo === 'revisao') {
    const arr = lerJson(limpo)
    if (!Array.isArray(arr)) throw new Error('A revisão precisa ser uma lista [ ... ].')
    const ids = params.pecaIds || []
    let n = 0
    for (let i = 0; i < ids.length; i++) {
      const a = arr.find((r: any) => r && String(r.id) === ids[i]) || arr[i]
      if (!a) continue
      const p = await db.query.mktPecas.findFirst({ where: eq(mktPecas.id, ids[i]) })
      if (!p) continue
      const an = {
        nota: Math.max(0, Math.min(10, Math.round(Number(a.nota) || 0))),
        veredito: ['aprovar', 'ajustar', 'refazer'].includes(a.veredito) ? a.veredito : 'ajustar',
        resumo: String(a.resumo || '').slice(0, 400),
        problemas: (Array.isArray(a.problemas) ? a.problemas : []).map(String).slice(0, 4),
        gancho: String(a.gancho || '').slice(0, 300),
        confirmar: (Array.isArray(a.confirmar) ? a.confirmar : []).map(String).slice(0, 4),
        hash: rotHash(p),
        em: new Date().toISOString(),
      }
      await db.update(mktPecas).set({ analise: JSON.stringify(an) }).where(eq(mktPecas.id, p.id))
      n++
    }
    return { revisadas: n }
  }
  if (tipo === 'criar') return separarLegenda(limpo)
  if (tipo === 'legenda') return { legenda: limpo.replace(/^\s*LEGENDA:\s*/i, '') }
  if (tipo === 'adaptar') {
    await db.update(mktIdeias).set({ adaptacao: limpo.slice(0, 8000) }).where(eq(mktIdeias.id, Number(params.ideiaId)))
    return { adaptacao: limpo }
  }
  if (tipo === 'reescrever') return { roteiro: limpo }
  const empresaId = Number(params.empresaId)
  const mes = params.mes || null
  const salvar = async (chave: string, t: string, textoSalvo: string, dados?: unknown) => {
    const v = { empresaId, tipo: t, mes, texto: textoSalvo, dados: dados ? JSON.stringify(dados) : null, autorId: userId, createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ') }
    await db.insert(mktAnalises).values({ chave, ...v }).onConflictDoUpdate({ target: mktAnalises.chave, set: v })
  }
  if (tipo === 'instagram') { await salvar(`ig-${empresaId}`, 'instagram', limpo); return { texto: limpo } }
  if (tipo === 'mes') { await salvar(`mes-${empresaId}-${mes}`, 'mes', limpo); return { texto: limpo } }
  if (tipo === 'directs') { await salvar(`directs-${empresaId}-${mes}`, 'directs', limpo); return { texto: limpo } }
  if (tipo === 'ideias') {
    const arr = lerJson(limpo)
    if (!Array.isArray(arr)) throw new Error('As ideias precisam ser uma lista [ ... ].')
    const ideias = arr.slice(0, 12).map((x: any) => ({ titulo: String(x.titulo || ''), tipo: x.tipo === 'Post' ? 'Post' : 'Vídeo', pilar: String(x.pilar || ''), gancho: String(x.gancho || ''), porque: String(x.porque || '') }))
    await salvar(`ideias-${empresaId}-${mes}`, 'ideias', '', ideias)
    return { ideias }
  }
  // persona — devolve para conferência; quem grava é o perfil.salvar depois do OK
  const r = lerJson(limpo)
  const personas = (Array.isArray(r.personas) ? r.personas : []).map((p: any) => Object.fromEntries(CAMPOS_PERSONA.map(([k]) => [k, String(p?.[k] || '')])))
  const sw = r.swot || {}
  const swot = Object.fromEntries(['forcas', 'fraquezas', 'oportunidades', 'ameacas'].map((k) => [k, (Array.isArray(sw[k]) ? sw[k] : []).map(String)]))
  return { personas, swot }
}

export async function pecasDoPedido(ids: string[]) {
  return ids.length ? db.select().from(mktPecas).where(inArray(mktPecas.id, ids)) : []
}

// "Colar roteiro completo" (João, 2026-11-23): separa um texto colado em pauta,
// gancho, roteiro, legenda e CTA. Usado quando a IA do CRM está ligada; sem
// ela a tela separa pelos títulos (GANCHO:, LEGENDA:…).
export async function separarRoteiroIa(texto: string, tipo: string) {
  const prompt = `Separe o texto abaixo (roteiro de ${tipo === 'Post' ? 'post/carrossel' : 'vídeo curto'} para redes sociais) nos campos pedidos. NÃO reescreva, NÃO corrija e NÃO invente: copie os trechos exatamente como estão. Se um campo não existir no texto, deixe "".\n- titulo: a pauta/título (1 linha)\n- gancho: a frase de abertura (primeiros 3 segundos)\n- roteiro: o roteiro inteiro (falas, cenas, texto na tela, lâminas), sem a legenda\n- legenda: a legenda/copy do post com as hashtags\n- cta: a chamada final (1 linha)\nResponda SOMENTE com JSON: {"titulo":"","gancho":"","roteiro":"","legenda":"","cta":""}\n\nTEXTO:\n${texto.slice(0, 15000)}`
  const r = lerJson(await chamarClaude(prompt))
  const s = (k: string) => String(r?.[k] ?? '').trim()
  return { titulo: s('titulo'), gancho: s('gancho'), roteiro: s('roteiro') || texto.trim(), legenda: s('legenda'), cta: s('cta') }
}

// Sincroniza pedido de arte aprovado (solicitacoesDesign) com uma base do
// Notion — pedido do João, 2026-09-14: quando aprova uma arte pro
// marketing, quer que ela já apareça lá, sem digitar de novo.
//
// Opcional (mesmo padrão de marketingCrm.ts/goto.ts): sem as duas env vars,
// não faz nada — a aprovação no CRM nunca depende do Notion estar no ar.
// Chamado sempre depois que a aprovação já foi salva no banco, então uma
// falha aqui (Notion fora do ar, token revogado etc.) nunca derruba a
// aprovação em si — só fica sem sincronizar, e sobe no log do servidor.
const NOTION_VERSION = '2022-06-28'

const TIPO_LABEL: Record<string, string> = { comunicado: 'Comunicado', oferta: 'Oferta', banner: 'Banner', video: 'Vídeo' }

export interface SolicitacaoDesignParaNotion {
  tipo: string
  descricao: string
  preco: string | null
  produto: string | null
  quantidade: string | null
  dataLimiteEntrega: string | null
  dataLimiteValidade: string | null
  observacoes: string | null
  vendedorNome: string
  empresaNome: string
  empresaSlug: string
  decididoEm: string
}

function textoRico(conteudo: string) {
  return [{ type: 'text' as const, text: { content: conteudo.slice(0, 2000) } }]
}

// Um parágrafo "Rótulo: valor" — só entra na página se o valor existir,
// pra não poluir o corpo com "Preço: —" pra todo campo opcional vazio.
function blocoCampo(rotulo: string, valor: string | null) {
  if (!valor) return null
  return {
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [
        { type: 'text' as const, text: { content: `${rotulo}: ` }, annotations: { bold: true } },
        { type: 'text' as const, text: { content: valor.slice(0, 2000) } },
      ],
    },
  }
}

// `YYYY-MM-DD HH:MM:SS` (agoraSqlite) ou `YYYY-MM-DD` (input type="date") —
// o Notion aceita os dois formatos ISO, só precisa do "T" no lugar do
// espaço quando tem hora.
function paraDataIso(valor: string): string {
  return valor.includes(' ') ? valor.replace(' ', 'T') + 'Z' : valor
}

// Vídeo cai numa base (e workspace!) diferente da de comunicado/oferta/
// banner — é outro time (Compretec Publicidade) com sua própria
// integração/token no Notion, não só outra base do mesmo workspace.
// Reaproveitado tanto na criação da página quanto no polling de status.
function credenciaisPara(tipo: string): { token: string; databaseId: string } | null {
  const ehVideo = tipo === 'video'
  const token = ehVideo ? process.env.NOTION_API_KEY_VIDEO : process.env.NOTION_API_KEY
  const databaseId = ehVideo ? process.env.NOTION_DATABASE_ID_DESIGN_VIDEO : process.env.NOTION_DATABASE_ID_DESIGN
  if (!token || !databaseId) return null
  return { token, databaseId }
}

// A base de vídeo ("CONTROLE DE DEMANDAS", time da Compretec Publicidade) já
// existia com sua própria estrutura antes de ligarmos nela — colunas em
// CAIXA ALTA e EMPRESA é tipo "status" (opções fixas, cadastradas na mão no
// Notion; diferente do "select" da base de Design, a API não pode criar uma
// opção nova ali). Mapeamento por slug (não pelo nome de exibição, que pode
// mudar) — pedido do João, 2026-09-15: empresa fora do mapa fica sem essa
// coluna preenchida (o nome completo continua no título da página), sem
// travar a sincronização. Ajustar aqui se entrar empresa nova ou o time
// criar mais opções na coluna.
function empresaStatusVideo(empresaSlug: string): string | null {
  if (empresaSlug.startsWith('compretec')) return 'COMPRETEC'
  if (empresaSlug.startsWith('odin-tubos')) return 'ODINTC'
  if (empresaSlug.startsWith('odin-compressores')) return 'ODIN COMPRESSORES'
  if (empresaSlug.startsWith('joitec')) return 'JOITEC'
  return null
}

// Devolve o id da página criada (pra guardar em solicitacoesDesign.notionPageId
// e depois conseguir consultar o status de volta) — null se não sincronizou
// (env vars ausentes ou erro na chamada).
export async function sincronizarDesignAprovadoNoNotion(solicitacao: SolicitacaoDesignParaNotion): Promise<string | null> {
  const creds = credenciaisPara(solicitacao.tipo)
  if (!creds) return null
  const { token, databaseId } = creds

  const tipoLabel = TIPO_LABEL[solicitacao.tipo] ?? solicitacao.tipo
  // Empresa no título também (não só na coluna) — pedido do João,
  // 2026-09-14: o CRM é multi-empresa e a mesma base do Notion recebe
  // pedido de vendedor de qualquer uma delas, então dá pra reconhecer de
  // qual empresa é o pedido batendo o olho, sem abrir a página.
  const nome = `[${solicitacao.empresaNome}] ${tipoLabel} — ${solicitacao.produto || solicitacao.descricao.slice(0, 60)}`
  const ehVideo = solicitacao.tipo === 'video'

  // Base de vídeo já existia com estrutura própria (ver empresaStatusVideo
  // acima) — sem coluna Vendedor/Prazo de entrega e Status/Empresa em CAIXA
  // ALTA. Vendedor e prazo viram parágrafo no corpo da página nesse caso,
  // em vez de coluna.
  const properties: Record<string, unknown> = ehVideo
    ? {
        Nome: { title: textoRico(nome) },
        STATUS: { status: { name: 'Não iniciada' } },
        Data: { date: { start: paraDataIso(solicitacao.decididoEm) } },
      }
    : {
        Nome: { title: textoRico(nome) },
        Status: { status: { name: 'Não iniciada' } },
        Data: { date: { start: paraDataIso(solicitacao.decididoEm) } },
        Vendedor: { rich_text: textoRico(solicitacao.vendedorNome) },
        // `select` — o Notion cria a opção sozinho na primeira vez que vir
        // um nome de empresa novo; dá pra agrupar/filtrar a view por ela.
        Empresa: { select: { name: solicitacao.empresaNome } },
      }

  if (ehVideo) {
    const empresaStatus = empresaStatusVideo(solicitacao.empresaSlug)
    if (empresaStatus) properties['EMPRESA'] = { status: { name: empresaStatus } }
  } else if (solicitacao.dataLimiteEntrega) {
    properties['Prazo de entrega'] = { date: { start: solicitacao.dataLimiteEntrega } }
  }

  const children = [
    blocoCampo('Tipo', tipoLabel),
    blocoCampo('Descrição', solicitacao.descricao),
    blocoCampo('Produto', solicitacao.produto),
    blocoCampo('Preço', solicitacao.preco),
    blocoCampo('Quantidade', solicitacao.quantidade),
    blocoCampo('Validade da arte', solicitacao.dataLimiteValidade),
    blocoCampo('Observações', solicitacao.observacoes),
    ...(ehVideo ? [blocoCampo('Vendedor', solicitacao.vendedorNome), blocoCampo('Prazo de entrega', solicitacao.dataLimiteEntrega)] : []),
  ].filter((b): b is NonNullable<typeof b> => b !== null)

  try {
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties, children }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error('[notion] falha ao criar página do pedido de arte:', res.status, await res.text())
      return null
    }
    const pagina = (await res.json()) as { id: string }
    return pagina.id
  } catch (err) {
    console.error('[notion] falha ao criar página do pedido de arte:', err)
    return null
  }
}

// Lê o valor atual da propriedade Status de uma página já criada — usado
// pelo polling (pollNotionStatus.ts) que traz o andamento de volta pro CRM,
// já que o Notion não avisa o CRM sozinho quando alguém muda a coluna lá.
// null tanto pra "não configurado" quanto pra qualquer erro (página
// apagada/despublicada no Notion etc.) — quem chama só pula essa linha.
export async function buscarStatusNotion(pageId: string, tipo: string): Promise<string | null> {
  const creds = credenciaisPara(tipo)
  if (!creds) return null
  // Base de vídeo usa a coluna "STATUS" (caixa alta) — ver empresaStatusVideo.
  const statusProperty = tipo === 'video' ? 'STATUS' : 'Status'

  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: { Authorization: `Bearer ${creds.token}`, 'Notion-Version': NOTION_VERSION },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const pagina = (await res.json()) as { properties?: Record<string, { status?: { name?: string } }> }
    return pagina.properties?.[statusProperty]?.status?.name ?? null
  } catch (err) {
    console.error('[notion] falha ao consultar status:', err)
    return null
  }
}

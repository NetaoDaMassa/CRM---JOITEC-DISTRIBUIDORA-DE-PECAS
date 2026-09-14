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

export async function sincronizarDesignAprovadoNoNotion(solicitacao: SolicitacaoDesignParaNotion): Promise<void> {
  const token = process.env.NOTION_API_KEY
  // Vídeo cai numa base diferente da de comunicado/oferta/banner (times
  // diferentes de marketing acompanham cada uma) — pedido do João,
  // 2026-09-14. Sem NOTION_DATABASE_ID_DESIGN_VIDEO configurada, um pedido
  // de vídeo simplesmente não sincroniza (não cai por engano na base
  // errada) até a base ser criada/configurada.
  const databaseId = solicitacao.tipo === 'video' ? process.env.NOTION_DATABASE_ID_DESIGN_VIDEO : process.env.NOTION_DATABASE_ID_DESIGN
  if (!token || !databaseId) return

  const tipoLabel = TIPO_LABEL[solicitacao.tipo] ?? solicitacao.tipo
  const nome = `${tipoLabel} — ${solicitacao.produto || solicitacao.descricao.slice(0, 60)}`

  const properties: Record<string, unknown> = {
    Nome: { title: textoRico(nome) },
    Status: { status: { name: 'Não iniciada' } },
    Data: { date: { start: paraDataIso(solicitacao.decididoEm) } },
    Vendedor: { rich_text: textoRico(solicitacao.vendedorNome) },
  }
  if (solicitacao.dataLimiteEntrega) {
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
    }
  } catch (err) {
    console.error('[notion] falha ao criar página do pedido de arte:', err)
  }
}

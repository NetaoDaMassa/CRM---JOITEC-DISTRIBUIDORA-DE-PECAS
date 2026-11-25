// Mesma regra do server (server/src/lib/motivosPerda.ts) — mude os dois.
// Motivo de perda do Kanban de clientes, refeito em 2026-11-25.

export const CATEGORIAS_PERDA = [
  'preco_concorrente',
  'falta_peca',
  'restricao_credito',
  'prazo_entrega',
  'sem_retorno',
  'cliente_final',
  'adiou',
  'cadastro_errado',
] as const
export type CategoriaPerda = (typeof CATEGORIAS_PERDA)[number]

// Rótulo de todas, inclusive as 3 antigas (perdidos de antes de 25/11).
export const ROTULO_CATEGORIA_PERDA: Record<string, string> = {
  preco_concorrente: 'Preço / concorrente',
  falta_peca: 'Falta de peça / não temos o item',
  restricao_credito: 'Restrição / crédito',
  prazo_entrega: 'Prazo de entrega',
  sem_retorno: 'Cliente sumiu / sem retorno',
  cliente_final: 'Cliente final não aprovou',
  adiou: 'Adiou a compra',
  cadastro_errado: 'Cadastro errado / duplicado (não é perda)',
  estoque: 'Estoque (antigo)',
  financeiro: 'Financeiro (antigo)',
  compras: 'Compras (antigo)',
}

export const DICA_CATEGORIA_PERDA: Record<CategoriaPerda, string> = {
  preco_concorrente: 'Achou mais barato em outro lugar (concorrente, Mercado Livre, site, fábrica). Diga com quem fechou e a diferença, se souber.',
  falta_peca: 'Não tínhamos a peça (ou não tínhamos todas). Diga qual item faltou — vai pro setor de Compras.',
  restricao_credito: 'Restrição no Serasa, só à vista, entrada, parcelamento não liberado, boleto em atraso. Vai pro Financeiro.',
  prazo_entrega: 'O prazo de chegada/despacho não atendeu. Diga o prazo que o cliente precisava — vai pro setor de Compras.',
  sem_retorno: 'Parou de responder. Conte quantas vezes e por onde tentou (ligação, WhatsApp) e desde quando.',
  cliente_final: 'O cliente do seu cliente não aprovou. Conte o que ele alegou (preço, prazo, outro fornecedor).',
  adiou: 'Vai comprar mais pra frente. Diga quando e por quê.',
  cadastro_errado: 'Card duplicado, aberto errado, teste, número errado. Não conta como perda de venda.',
}

export type SetorPerda = 'financeiro' | 'compras'
export const SETOR_DA_CATEGORIA: Record<string, SetorPerda | null> = {
  restricao_credito: 'financeiro',
  financeiro: 'financeiro',
  falta_peca: 'compras',
  prazo_entrega: 'compras',
  estoque: 'compras',
  compras: 'compras',
}

export const OPCOES_CATEGORIA_PERDA = CATEGORIAS_PERDA.map((c) => ({ value: c, label: ROTULO_CATEGORIA_PERDA[c] }))

export const MIN_CARACTERES_MOTIVO = 40
const MIN_PALAVRAS_MOTIVO = 6

// Frases que sozinhas não explicam nada. Tirando elas do texto, precisa
// sobrar conteúdo de verdade.
const FRASES_VAZIAS = [
  'cliente nao fechou', 'nao fechou', 'sem retorno', 'nao retornou', 'nao deu retorno', 'sem resposta', 'nao responde',
  'orcamento', 'erro de sistema', 'sem interesse', 'nao tem interesse', 'sem motivo aparente', 'sem motivo', 'nao quis',
  'desistiu', 'cliente desistiu', 'perdido', 'cliente', 'motivo', 'nao comprou', 'nao vai comprar', 'nesse momento', 'no momento',
]

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Devolve a mensagem de erro, ou null se o motivo está bom.
export function erroMotivoPerda(categoria: string | null | undefined, observacao: string | null | undefined, concorrente?: string | null, item?: string | null): string | null {
  if (!categoria || !(CATEGORIAS_PERDA as readonly string[]).includes(categoria)) return 'Escolha a categoria do motivo de perda.'
  const obs = (observacao ?? '').trim()
  if (categoria === 'preco_concorrente' && (concorrente ?? '').trim().length < 2) {
    return 'Preço/Concorrente: informe pra quem perdeu (nome do concorrente, Mercado Livre, site...).'
  }
  if ((categoria === 'falta_peca' || categoria === 'prazo_entrega') && (item ?? '').trim().length < 2) {
    return 'Informe qual peça/item faltou (ou atrasou) — é isso que o setor de Compras precisa saber.'
  }
  // Card duplicado/aberto errado não é perda de venda — basta dizer o que houve.
  if (categoria === 'cadastro_errado') {
    return obs.length >= 15 ? null : 'Explique o que houve com o cadastro (ex: "card duplicado do mesmo cliente").'
  }
  if (obs.length < MIN_CARACTERES_MOTIVO) {
    return `Escreva o motivo detalhado — mínimo ${MIN_CARACTERES_MOTIVO} caracteres (faltam ${MIN_CARACTERES_MOTIVO - obs.length}). Conte o que o cliente disse, com quem fechou, qual item faltou...`
  }
  const norm = normalizar(obs)
  if (norm.split(' ').filter((p) => p.length > 1).length < MIN_PALAVRAS_MOTIVO) {
    return 'Escreva uma frase explicando o motivo, não só palavras soltas.'
  }
  let resto = ` ${norm} `
  for (const f of [...FRASES_VAZIAS].sort((a, b) => b.length - a.length)) resto = resto.split(` ${f} `).join(' ')
  if (resto.replace(/\s+/g, '').length < 25) {
    return 'Só "sem retorno", "não fechou", "orçamento" não explica o motivo. Conte o que aconteceu: o que o cliente disse, quantas vezes tentou contato, com quem fechou...'
  }
  return null
}

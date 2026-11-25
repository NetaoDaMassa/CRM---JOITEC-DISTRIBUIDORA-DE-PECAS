// Motivo de perda do Kanban de clientes (funil_mensal) — refeito com o João
// em 2026-11-25. Antes eram só 3 categorias (Estoque/Financeiro/Compras) e a
// observação aceitava qualquer coisa: o vendedor marcava a "menos errada" e o
// relatório dizia "Financeiro 24" quando só ~8 eram crédito de verdade (o
// resto era preço, cliente sumiu, cliente final...). Agora:
//   - categorias que dizem o motivo real, cada uma com o setor que precisa
//     saber (Financeiro / Compras) — vai pra tela Motivos de perda;
//   - texto obrigatório de verdade (40+ caracteres, 6+ palavras e não pode
//     ser só "sem retorno", "não fechou", "orçamento"...);
//   - Preço/Concorrente pede pra quem perdeu.
// Mesma regra no client (client/src/lib/motivosPerda.ts) — mude os dois.

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

// As 3 antigas continuam válidas no banco (perdidos de antes de 25/11).
export const CATEGORIAS_PERDA_ANTIGAS = ['estoque', 'financeiro', 'compras'] as const

export type SetorPerda = 'financeiro' | 'compras'
export const SETOR_DA_CATEGORIA: Record<string, SetorPerda | null> = {
  restricao_credito: 'financeiro',
  financeiro: 'financeiro',
  falta_peca: 'compras',
  prazo_entrega: 'compras',
  estoque: 'compras',
  compras: 'compras',
}
export function categoriasDoSetor(setor: SetorPerda): string[] {
  return Object.entries(SETOR_DA_CATEGORIA)
    .filter(([, s]) => s === setor)
    .map(([c]) => c)
}

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

// "O que significa cada número" — pedido do João, 2026-10-20: todo
// relatório com métrica precisa explicar, em português simples, o que o
// número conta de verdade. Um texto só por métrica, aqui, pra a explicação
// não divergir entre telas. As regras foram tiradas do cálculo no servidor
// (reports.ts, leadsRelatorios.ts, relatoriosOdin.ts) — se mudar a conta lá,
// atualize aqui também.

export type Explicacao = {
  termo: string
  texto: string
  // Exemplo curto pra fixar a ideia (opcional).
  exemplo?: string
  cor?: string
}

// ── Carteira (positivação / atividade) ─────────────────────────────────
const CARTEIRA: Explicacao[] = [
  {
    termo: 'Clientes na carteira',
    texto: 'Todos os clientes que estão hoje na carteira de um vendedor ativo. Não entram clientes do Banco de Clientes (sem vendedor), de vendedor desativado nem em prospecção.',
  },
  {
    termo: 'Ativos',
    cor: '#4cb860',
    texto: 'Compraram nos últimos 90 dias (contando até a data final do filtro).',
  },
  {
    termo: 'Novos',
    cor: '#7cc4f2',
    texto: 'Fizeram a PRIMEIRA compra da vida dentro do período escolhido.',
  },
  {
    termo: 'Recuperados',
    cor: '#3a86d6',
    texto: 'Estavam parados há mais de 180 dias e voltaram a comprar dentro do período. É o cliente "resgatado".',
    exemplo: 'Última compra em janeiro, comprou de novo em outubro → recuperado.',
  },
  {
    termo: 'Quase inativos',
    cor: '#e8c440',
    texto: 'A última compra foi entre 91 e 180 dias atrás. Ainda não estão perdidos, mas estão esfriando: são os que mais vale ligar agora.',
  },
  {
    termo: 'Inativos',
    cor: '#e5534b',
    texto: 'A última compra foi há mais de 180 dias (6 meses).',
  },
  {
    termo: 'Nunca compraram',
    cor: '#9aa5b1',
    texto: 'Estão na carteira, mas não têm nenhuma compra registrada (nem no CRM, nem nos Pedidos, nem no histórico do SAP). Atenção: o registro de compras só começa em abril/2026 (início do histórico do SAP importado). Cliente que comprou antes disso e não voltou a comprar aparece aqui como "nunca comprou" — não quer dizer que nunca foi cliente.',
  },
  {
    termo: 'Clientes ativados / Taxa de ativação',
    texto: 'Ativados = todo cliente que NÃO está inativo e NÃO "nunca comprou", ou seja, ativos + novos + recuperados + quase inativos (comprou nos últimos 180 dias). A taxa de ativação é ativados ÷ clientes na carteira.',
    exemplo: '617 ativados de 3.200 na carteira = 19%.',
  },
  {
    termo: 'Positivação no período',
    texto: 'Quantos clientes da carteira compraram DENTRO do período escolhido (ex.: este mês), dividido pelo total da carteira. CNPJs vinculados (mesmo grupo) contam como um cliente só. É diferente de "ativados", que olha os últimos 180 dias.',
    exemplo: '135 clientes compraram este mês ÷ carteira = 4,3%.',
  },
  {
    termo: 'Tempo médio desde a última compra',
    texto: 'Média de dias desde a última compra, só entre os clientes que já compraram alguma vez.',
  },
  {
    termo: 'Valor médio por cliente (LTV)',
    texto: 'Tudo o que os clientes já compraram (histórico inteiro) dividido pelo número de clientes que já compraram. Mostra quanto vale, em média, um cliente da carteira.',
  },
]

// ── Vendas ─────────────────────────────────────────────────────────────
const FATURAMENTO: Explicacao = {
  termo: 'Faturamento',
  texto: 'Soma de todas as vendas fechadas no período: vendas fechadas no Kanban da Carteira, pedidos lançados no módulo Pedidos (Odin) e o histórico importado do SAP.',
}
const VENDAS_QTD: Explicacao = { termo: 'Vendas', texto: 'Quantidade de vendas/pedidos fechados no período (não é quantidade de clientes: um cliente pode ter várias vendas).' }
const TICKET: Explicacao = { termo: 'Ticket médio', texto: 'Faturamento ÷ número de vendas. Quanto vale, em média, cada venda.' }
const VARIACAO: Explicacao = {
  termo: 'Seta verde/vermelha (vs período anterior)',
  texto: 'Compara com o período imediatamente anterior, do mesmo tamanho. Ex.: "este mês" até o dia 20 é comparado com o mês passado até o dia 20. Verde = melhorou, vermelho = piorou.',
}

// ── Contatos ───────────────────────────────────────────────────────────
const COBERTURA: Explicacao = {
  termo: 'Carteira contatada no mês (cobertura)',
  texto: 'De todos os clientes da carteira, quantos tiveram pelo menos UM contato registrado no mês (ligação, WhatsApp, e-mail ou visita). Contato num CNPJ vale também pro CNPJ vinculado do mesmo vendedor.',
  exemplo: 'Vendedor com 200 clientes que falou com 150 no mês = 75%.',
}
const TENTATIVA: Explicacao = { termo: 'Tentativas', texto: 'Toda ligação registrada, atendida ou não (manual ou automática pelo telefone).' }
const EFETIVA: Explicacao = {
  termo: 'Ligações efetivas',
  texto: 'Ligações em que o vendedor realmente falou com o cliente: ele marcou "Respondeu" no card (ou a central de telefone confirmou que foi atendida e durou o mínimo configurado). Caixa postal não conta.',
}
const PCT_EFETIVA: Explicacao = { termo: '% efetivas', texto: 'Efetivas ÷ tentativas. Mostra quem liga muito mas conversa pouco.' }
const SEM_RESULTADO: Explicacao = {
  termo: 'Sem resultado confirmado',
  texto: 'Ligações que o telefone registrou, mas o vendedor ainda não confirmou se o cliente atendeu. Número alto = vendedor não está voltando no card pra confirmar.',
}

export const GLOSSARIO: Record<string, Explicacao[]> = {
  // Relatórios novos (Resumo + detalhados)
  resumo: [
    FATURAMENTO,
    VENDAS_QTD,
    TICKET,
    CARTEIRA[8], // positivação
    VARIACAO,
    ...CARTEIRA.slice(1, 7),
    CARTEIRA[7],
    { termo: 'Curva ABC', texto: 'A = clientes que somam os primeiros 80% do faturamento; B = os próximos 15%; C = o resto (últimos 5%).' },
    COBERTURA,
    EFETIVA,
    { termo: 'Orçamentos parados +15 dias', texto: 'Cards em Negociação neste mês que estão há mais de 15 dias sem sair dessa etapa.' },
    { termo: 'Pedidos perdidos', texto: 'Cards que foram pra etapa "Perdido" no período.' },
  ],
  positivacao: CARTEIRA,
  'curva-abc': [
    { termo: 'Classe A', cor: '#22a861', texto: 'Os clientes que, somados do maior pro menor, chegam a 80% do faturamento do período. Normalmente são poucos clientes que trazem a maior parte do dinheiro.' },
    { termo: 'Classe B', cor: '#f2a516', texto: 'Os próximos clientes, até completar 95% do faturamento (os 15% seguintes).' },
    { termo: 'Classe C', cor: '#9aa5b1', texto: 'Todo o resto, que soma os últimos 5% do faturamento. Muitos clientes, pouco valor cada.' },
    { termo: 'Participação', texto: 'Quanto aquele cliente representa do faturamento total do período.' },
    { termo: '% acumulado', texto: 'Soma da participação dele com a de todos acima dele no ranking. É o que define a classe.' },
    { termo: 'Vendedor', texto: 'Dono do cliente HOJE na carteira (pode não ser quem fechou a venda, se o cliente mudou de vendedor).' },
  ],
  vendas: [
    FATURAMENTO,
    VENDAS_QTD,
    TICKET,
    { termo: 'Clientes de marketing', texto: 'Vendas feitas pra clientes que chegaram pelo marketing (vieram de um lead).' },
    { termo: 'De onde vem o faturamento', texto: 'Divide o total entre Carteira (Kanban), Pedidos (módulo Pedidos) e Histórico SAP. Só aparece quando tem mais de uma fonte no período.' },
    { termo: '% do total', texto: 'Quanto cada vendedor representa do faturamento da empresa no período.' },
    { termo: 'Vendedor', texto: 'Quem fechou o negócio no Kanban daquele mês.' },
    VARIACAO,
  ],
  orcamentos: [
    { termo: 'Em negociação agora', texto: 'Cards que estão AGORA na etapa Negociação do Kanban deste mês. É uma foto do momento, não muda com o filtro de data.' },
    { termo: 'Valor em aberto', texto: 'Soma dos valores orçados desses cards em negociação.' },
    { termo: 'Parados há +15 dias', texto: 'Orçamentos em negociação há mais de 15 dias sem avançar. São os que estão esfriando. Embaixo, o valor somado deles.' },
    { termo: 'Dias em aberto', texto: 'Há quantos dias o orçamento está em Negociação, contando desde a PRIMEIRA vez que entrou na etapa (mesmo que o card tenha passado de um mês pro outro). Verde até 15 dias, amarelo de 16 a 30, vermelho acima de 30.' },
    { termo: 'Orçamentos feitos', texto: 'Quantas vezes um card ENTROU na etapa Negociação dentro do período (cada orçamento enviado conta uma vez), mais as cotações do SAP do período (abr–jul/2026, Joitec e Odin Tubos), que contam pro vendedor ATUAL do cliente.' },
    { termo: 'Abas "Feitos no período" / "Em aberto hoje"', texto: '"Feitos no período" lista cada orçamento feito nas datas do filtro (cards que entraram em Negociação + cotações do SAP), com a situação de hoje e a origem. "Em aberto hoje" é a foto do momento: o que está em Negociação agora, sem depender do filtro de data.' },
  ],
  produtos: [
    { termo: 'Quantidade', texto: 'Total de unidades vendidas daquele item, somando os itens dos pedidos fechados no período.' },
    { termo: 'Valor / Preço médio', texto: 'Valor = soma vendida do item. Preço médio = valor ÷ quantidade.' },
    { termo: 'Clientes que compraram', texto: 'Quantos clientes diferentes daquele vendedor compraram no período.' },
    { termo: 'Linhas de item', texto: 'Quantas linhas de produto apareceram nos pedidos (cada produto diferente num pedido = uma linha).' },
    { termo: 'Itens por cliente (mix)', texto: 'Linhas de item ÷ clientes que compraram. Quanto maior, mais variedade de produtos o vendedor coloca em cada cliente.' },
    { termo: 'Quantidade por cliente', texto: 'Unidades vendidas ÷ clientes que compraram.' },
  ],
  contatos: [
    { termo: 'Contatos registrados', texto: 'Todos os contatos lançados no período (ligação, WhatsApp, e-mail e visita). O mesmo cliente pode ter vários.' },
    { termo: 'WhatsApp / Ligações', texto: 'Quantos desses contatos foram por WhatsApp e quantos por ligação.' },
    COBERTURA,
    { termo: 'Sem contato', texto: 'Clientes da carteira que não tiveram nenhum contato registrado no mês.' },
  ],
  ligacoes: [TENTATIVA, EFETIVA, PCT_EFETIVA, SEM_RESULTADO, { termo: 'Duração média', texto: 'Tempo médio das ligações com aquele cliente (só quando o telefone informa a duração).' }],
  'clientes-parados': [
    { termo: 'Sem contato há X dias', texto: 'Clientes da carteira sem nenhum contato registrado (ligação, WhatsApp, e-mail, visita) nos últimos X dias.' },
    { termo: 'Sem orçamento há X dias', texto: 'Clientes que não receberam nenhum orçamento nos últimos X dias. Vale o mais recente entre o card da Carteira com valor orçado e a última cotação do SAP (o SAP cobre abr–jul/2026, Joitec e Odin Tubos).' },
    { termo: 'Sem comprar há X dias', texto: 'Clientes sem nenhuma compra nos últimos X dias (CRM, Pedidos ou SAP). A etiqueta mostra de onde veio a última compra.' },
    { termo: 'Nunca / Com histórico', texto: '"Nunca contatado / Nunca orçou / Nunca comprou" = o cliente nunca teve aquilo. "Com histórico, mas parados" = já teve, mas faz mais de X dias.' },
    { termo: 'Sem contato e sem orçamento neste mês', texto: 'Clientes que ninguém tocou neste mês: nem contato, nem orçamento.' },
  ],
  perdas: [
    { termo: 'Pedidos perdidos', texto: 'Cards que foram pra etapa "Perdido" dentro do período.' },
    { termo: 'Valor orçado perdido', texto: 'Soma dos valores que estavam orçados nesses cards perdidos. É o dinheiro que ficou na mesa.' },
    { termo: 'Motivo nº 1', texto: 'A categoria de motivo que mais apareceu nas perdas (preço, prazo, estoque...).' },
    { termo: 'Itens que mais fizeram perder', texto: 'Produtos mais citados pelo vendedor como motivo da perda.' },
  ],
  'todas-empresas': [
    { ...FATURAMENTO, termo: 'Faturamento do grupo', texto: 'Soma do faturamento de todas as empresas do grupo no período (Carteira + Pedidos + SAP de cada uma).' },
    VENDAS_QTD,
    TICKET,
    { ...COBERTURA, termo: 'Carteira contatada' },
    { termo: 'Período anterior', texto: 'Faturamento da mesma empresa no período anterior, do mesmo tamanho, pra comparar.' },
  ],

  // Relatório de Leads (refeito em 2026-10-20 — ver pages/relatorios/leads)
  'leads-geral': [
    { termo: 'Leads recebidos', texto: 'Leads que entraram no CRM no período escolhido. É a "safra" do período: atendimento, conversão e funil olham o que aconteceu com esses leads.' },
    { termo: 'Atendidos', texto: 'Quantos dos leads recebidos já tiveram um contato confirmado pelo vendedor (ou já passaram de Qualificado). "Sem contato" = ainda em aberto e ninguém falou com ele.' },
    { termo: 'Tempo até o 1º contato', texto: 'Média de tempo entre o lead chegar e o primeiro contato confirmado. Conta só horas úteis: 8h–18h, sem almoço (12h–13h), sem fim de semana e sem feriado. 9 horas úteis = 1 dia útil.', exemplo: 'Lead chegou sábado, atendido segunda 9h = 1 hora.' },
    { termo: 'Taxa de conversão', texto: 'Dos leads recebidos no período, quantos % já viraram venda (Ganho). Lead que ainda está em negociação pode virar venda depois, então a taxa de um mês recente tende a subir com o tempo.' },
    { termo: 'Vendas fechadas', texto: 'Leads marcados como Ganho no período, pela data do fechamento — inclui lead que chegou antes e fechou agora. Soma o valor final da venda.' },
    { termo: 'Ticket médio', texto: 'Valor médio de cada venda fechada no período.' },
    { termo: 'Em negociação', texto: 'Soma do valor orçado dos leads do período que estão hoje em Negociação.' },
    { termo: 'Perdidos / desqualificados', texto: 'Leads recebidos no período que hoje estão como Perdido ou Desqualificado.' },
    { termo: 'Funil dos leads do período', texto: 'Até onde cada lead já chegou, pelo histórico — um lead perdido em Negociação conta como "chegou na Negociação". Mostra quanto % de todos e quanto % da etapa anterior.' },
    { termo: 'Período anterior', texto: 'O mesmo número no período anterior, do mesmo tamanho (ou o mesmo pedaço do mês passado), com os mesmos filtros.' },
    { termo: 'Metas do mês', texto: 'Metas de marketing do mês (as mesmas do Painel de TV), comparadas com os números do relatório com os filtros aplicados. Clientes ganhos = vendas fechadas no mês.' },
  ],
  'leads-origem': [
    { termo: 'Canal', texto: 'De onde o lead veio, juntando a origem digitada, a campanha e o link do anúncio (UTM): Meta Ads, Google Ads, Site, Instagram, WhatsApp, E-mail, Loja online, Indicação, outra empresa do grupo.' },
    { termo: 'Sem origem', texto: 'Lead cadastrado à mão sem preencher a origem. Quanto maior esse número, menos dá pra saber qual canal dá resultado — vale pedir pra equipe sempre preencher.' },
    { termo: 'Campanha', texto: 'Nome da campanha do formulário da Meta, ou o utm_campaign do link quando o lead veio pelo site.' },
    { termo: 'Conversão por canal', texto: 'Dos leads que chegaram por aquele canal no período, quantos % já viraram venda.' },
    { termo: 'Quando os leads chegam', texto: 'Hora do dia e dia da semana em que os leads entraram (horário de Brasília), com quantos deles viraram venda.' },
  ],
  'leads-vendedores': [
    { termo: 'Atendidos', texto: '% dos leads do vendedor que já tiveram contato confirmado.' },
    { termo: '1º contato', texto: 'Tempo médio, em horas úteis, até o primeiro contato confirmado.' },
    { termo: 'Retorno atrasado', texto: 'Leads em aberto com a data de próximo contato já vencida.' },
    { termo: 'Conversão', texto: 'Leads recebidos no período que já viraram venda ÷ leads recebidos.' },
  ],
  'leads-regioes': [
    { termo: 'Região e estado', texto: 'Saem do DDD do telefone, então funcionam mesmo quando a cidade não foi preenchida.' },
    { termo: 'Segmento', texto: 'O que o lead faz (assistente técnico, instalador, revendedor...), preenchido pelo vendedor. "Outros" inclui quem não foi classificado.' },
  ],
  'leads-perdas': [
    { termo: 'Encerrados sem venda', texto: 'Leads marcados como Perdido, Desqualificado ou Consumidor final / Repassado no período (pela data em que foram encerrados).' },
    { termo: 'Motivo agrupado', texto: 'O motivo que o vendedor escreveu, juntado por assunto ("não responde", "comprou do concorrente", "preço"...). O texto original aparece na tabela.' },
    { termo: 'Chegou até', texto: 'A etapa mais longe que o lead chegou antes de ser perdido. Perder em Negociação significa que já tinha orçamento.' },
  ],
  'leads-lista': [
    { termo: 'Chegaram', texto: 'Todos os leads que entraram no período, com os filtros. Clique numa linha pra abrir o lead.' },
    { termo: 'Vendas fechadas', texto: 'Leads ganhos no período (pela data do fechamento).' },
  ],
  'leads-sla': [
    { termo: 'Leads críticos / em risco', texto: 'Leads que passaram do prazo de atendimento: "em risco" está quase estourando, "crítico" já estourou.' },
    { termo: 'Tempo médio em Abordagem', texto: 'Em média, quanto tempo os leads que estão em Abordagem estão parados nessa etapa. Conta só horas úteis (8h–18h, sem almoço, fim de semana e feriado).' },
    { termo: 'Recebeu / Perdeu', texto: 'Quantas vezes um lead foi passado PARA o vendedor (recebeu) e quantas vezes um lead dele foi passado pra outro (perdeu), por transferência manual ou automática por falta de atendimento.' },
  ],
  'leads-transferencias': [{ termo: 'Transferências', texto: 'Quando um lead mudou de vendedor no período: quem tinha (De), quem ficou (Para) e quem fez a mudança. ⚠️ marca lead que voltou pro rodízio 2 vezes ou mais.' }],
  'marketing-geral': [
    { termo: 'Tempo médio até 1º contato', texto: 'Média, entre as empresas, do tempo até o primeiro contato confirmado com o lead, em horas úteis (8h–18h, sem almoço, fim de semana e feriado). Empresa com mais leads pesa mais.' },
    { termo: 'Tempo médio de fechamento', texto: 'Dias entre o lead ser entregue ao vendedor e ser encerrado (ganho, perdido ou desqualificado).' },
    { termo: 'Leads atendidos no mês', texto: 'Leads que tiveram pelo menos 1 contato no período.' },
    { termo: 'Leads novos no mês', texto: 'Leads que ENTRARAM no período (pela data de chegada).' },
    { termo: 'Vendas (Leads)', texto: 'Valor dos leads marcados como Ganho no módulo de Leads.' },
    { termo: 'Vendas Marketing', texto: 'Vendas fechadas na Carteira pra clientes que vieram do marketing.' },
  ],

  // Relatórios Odin Compressores (abas)
  'odin-semanal': [
    { termo: 'Visitas', texto: 'Visitas registradas na semana.' },
    { termo: 'Com GPS / Manuais', texto: 'Com GPS = check-in feito no local com localização. Manual = lançada sem localização.' },
    { termo: 'Tempo médio de visita', texto: 'Do check-in ao check-out. Visita sem check-out (ou com mais de 12h, check-out esquecido) fica fora da média.' },
    { termo: 'Propostas feitas', texto: 'Propostas criadas na semana.' },
    { termo: 'Fechamentos', texto: 'Pedidos criados na semana e não cancelados (proposta que virou pedido = venda fechada), com o valor somado.' },
  ],
  'odin-pedidos': [
    { termo: 'Total', texto: 'Pedidos que batem com os filtros (data de criação e vendedor).' },
    { termo: 'Ativos', texto: 'Pedidos ainda em andamento: nem concluídos, nem cancelados.' },
    { termo: 'Concluídos', texto: 'Pedidos que chegaram no Pós-venda ou foram marcados como concluídos.' },
    { termo: 'Cancelados', texto: 'Pedidos com status cancelado.' },
  ],
  'odin-marketing': [
    { termo: 'Planejadas / Em campo', texto: 'Planejada = visita agendada antes. Em campo = visita feita sem agendamento.' },
    { termo: 'Duração média', texto: 'Tempo médio entre check-in e check-out das visitas.' },
    { termo: 'Taxa → proposta', texto: 'Visitas com resultado "gerar proposta" ÷ total de visitas.' },
    { termo: 'Taxa → negociação', texto: 'Propostas que chegaram em Negociação (ou além: fechado/convertido) ÷ total de propostas.' },
    { termo: 'Taxa → fechado', texto: 'Propostas fechadas ou convertidas em pedido ÷ total de propostas.' },
    { termo: 'Sem PDF anexado', texto: 'Propostas sem o arquivo PDF da proposta anexado.' },
  ],
  'odin-posVenda': [
    { termo: 'Pós-venda registrados', texto: 'Atendimentos de pós-venda lançados no período.' },
    { termo: 'Com feedback do cliente', texto: 'Quantos têm a opinião do cliente preenchida.' },
    { termo: 'NPS médio', texto: 'Nota média (0 a 10) que o cliente deu pra "quanto recomendaria a empresa". Só conta quem respondeu a nota.' },
    { termo: 'Com lembrete pendente', texto: 'Pós-vendas com data de lembrete marcada pra voltar a falar com o cliente.' },
  ],
  'odin-maquinas': [{ termo: 'Total em estoque cadastrado', texto: 'Máquinas cadastradas no estoque, divididas por status e porte (pequeno/grande). Não usa filtro de data.' }],
  'odin-pipeline': [{ termo: 'Total de pedidos', texto: 'Pedidos do período, divididos pela etapa em que estão agora, pelo status e por tipo (máquina ou peça).' }],
  'odin-propostas': [
    { termo: 'Total de propostas', texto: 'Propostas criadas no período.' },
    { termo: 'Convertidas em pedido', texto: 'Propostas que já viraram pedido.' },
    { termo: 'Taxa de conversão', texto: 'Convertidas ÷ total de propostas.' },
  ],
  'odin-faturamento': [
    { termo: 'Pedidos no período', texto: 'Pedidos que ENTRARAM na etapa Faturamento no período (cancelados não contam). É a mesma conta do Painel Financeiro e do Dashboard.' },
    { termo: 'Valor total', texto: 'Soma do valor desses pedidos.' },
    { termo: 'Valor confirmado / Pagamentos confirmados', texto: 'Só os pedidos em que o pagamento já foi confirmado no faturamento: o valor somado e a quantidade.' },
  ],
}

// Texto de uma métrica só (pro ⓘ ao lado do número).
export function explicar(chave: string, termo: string): string | undefined {
  return GLOSSARIO[chave]?.find((i) => i.termo === termo)?.texto
}

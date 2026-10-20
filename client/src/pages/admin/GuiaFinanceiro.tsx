import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import imgCaixa from '../../assets/guia-financeiro/caixa.jpg'
import imgBoletos from '../../assets/guia-financeiro/boletos.jpg'
import imgBoletoModal from '../../assets/guia-financeiro/boleto-modal.jpg'
import imgBoletosPedidos from '../../assets/guia-financeiro/boletos-pedidos.jpg'
import imgNegCobranca from '../../assets/guia-financeiro/neg-cobranca.jpg'
import imgNegCartorio from '../../assets/guia-financeiro/neg-cartorio.jpg'
import imgNegRc from '../../assets/guia-financeiro/neg-rc.jpg'
import imgSolFila from '../../assets/guia-financeiro/sol-fila.jpg'
import imgSolDetalhe from '../../assets/guia-financeiro/sol-detalhe.jpg'
import imgVendSol from '../../assets/guia-financeiro/vend-sol.jpg'
import imgLibLanc from '../../assets/guia-financeiro/lib-lanc.jpg'
import imgLibLimites from '../../assets/guia-financeiro/lib-limites.jpg'
import imgLibRel from '../../assets/guia-financeiro/lib-rel.jpg'
import imgPosto from '../../assets/guia-financeiro/posto.jpg'
import imgVendCartao from '../../assets/guia-financeiro/vend-cartao.jpg'
import imgCartaoRel from '../../assets/guia-financeiro/cartao-rel.jpg'

// Guia do Financeiro — pedido do João, 2026-10-20: igual o Guia do Vendedor
// e o de Relatórios (client/public/guia/), mas SÓ pra quem tem acesso às
// telas do Financeiro. Por isso é uma página do app (login + permissão, ver
// FEATURES_GUIA_FINANCEIRO) e não um HTML em public/. Prints com dados
// fictícios. Se uma regra das telas mudar, atualize o texto aqui também.

type Pino = { x: number; y: number }

function Print({ src, alt, pinos = [], legenda }: { src: string; alt: string; pinos?: Pino[]; legenda?: ReactNode[] | ReactNode }) {
  return (
    <figure className="space-y-3">
      <div className="relative rounded-xl overflow-hidden border border-dark-600 bg-dark-900">
        <img src={src} alt={alt} loading="lazy" className="block w-full h-auto" />
        {pinos.map((p, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-amber-400 text-amber-950 text-xs font-bold flex items-center justify-center shadow-[0_0_0_3px_rgba(11,21,34,.8)]"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {Array.isArray(legenda) ? (
        <ol className="space-y-1.5">
          {legenda.map((l, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-dark-200">
              <span className="w-6 h-6 rounded-full bg-amber-400 text-amber-950 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="pt-0.5">{l}</span>
            </li>
          ))}
        </ol>
      ) : (
        legenda && <figcaption className="text-sm text-dark-300">{legenda}</figcaption>
      )}
    </figure>
  )
}

function Secao({ id, rotulo, titulo, intro, children }: { id: string; rotulo: string; titulo: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-5">
      <div className="pb-3 border-b-2 border-dark-200 space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">{rotulo}</p>
        <h2 className="font-heading text-2xl md:text-3xl font-bold text-dark-50">{titulo}</h2>
        {intro && <p className="text-dark-300 max-w-3xl">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function Passo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-dark-50">{titulo}</h3>
      {children}
    </div>
  )
}

function Caixinha({ titulo, children, tom = 'neutro' }: { titulo: string; children: ReactNode; tom?: 'neutro' | 'alerta' | 'ok' }) {
  const cor =
    tom === 'alerta'
      ? 'border-red-500/40 bg-red-500/5 [&_h4]:text-red-400'
      : tom === 'ok'
        ? 'border-green-500/40 bg-green-500/5 [&_h4]:text-green-500'
        : 'border-dark-600 bg-dark-800'
  return (
    <div className={`rounded-xl border p-4 space-y-1.5 ${cor}`}>
      <h4 className="font-semibold text-dark-50">{titulo}</h4>
      <div className="text-sm text-dark-300 space-y-1.5">{children}</div>
    </div>
  )
}

function Grade({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}

function Status({ cor, children }: { cor: string; children: ReactNode }) {
  return <span className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 border ${cor}`}>{children}</span>
}

const SECOES = [
  { id: 'comeco', rotulo: 'Antes de começar' },
  { id: 'caixa', rotulo: 'Caixa' },
  { id: 'boletos', rotulo: 'Boletos' },
  { id: 'negociacoes', rotulo: 'Negociações' },
  { id: 'credito', rotulo: 'Crédito' },
  { id: 'posto', rotulo: 'Requisição Posto' },
  { id: 'cartao', rotulo: 'Cartão de Crédito' },
  { id: 'paineis', rotulo: 'Painel e Faturamento' },
  { id: 'rotina', rotulo: 'Rotina' },
]

const VERMELHO = 'text-red-500 bg-red-500/10 border-red-500/30'
const LARANJA = 'text-orange-500 bg-orange-500/10 border-orange-500/30'
const VERDE = 'text-green-600 bg-green-500/10 border-green-500/30'
const CINZA = 'text-dark-400 bg-dark-700/40 border-dark-600'

export default function GuiaFinanceiro() {
  const irPara = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-12 pb-20">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-gold-500/15 text-gold-500 flex items-center justify-center shrink-0">
            <BookOpen size={22} />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-500">Grupo Odin · acesso restrito</p>
            <h1 className="font-heading text-3xl md:text-4xl font-bold text-dark-50">Guia do Financeiro</h1>
          </div>
        </div>
        <p className="text-dark-300 max-w-3xl">
          Como usar cada tela do Financeiro no CRM: caixa, boletos, cobrança, crédito, abastecimento e cartão. Este guia só aparece para quem tem acesso a alguma dessas telas.
          Os números amarelos nos prints mostram onde olhar. Os clientes e valores dos prints são de exemplo.
        </p>
        <nav className="flex flex-wrap gap-2 sticky top-0 z-10 bg-dark-950/90 backdrop-blur py-2" aria-label="Seções">
          {SECOES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => irPara(s.id)}
              className="px-3.5 py-1.5 rounded-full border border-dark-600 bg-dark-800 text-sm font-medium text-dark-100 hover:border-gold-500 hover:text-gold-500 transition-colors"
            >
              {s.rotulo}
            </button>
          ))}
        </nav>
      </header>

      {/* ───────── ANTES DE COMEÇAR ───────── */}
      <Secao id="comeco" rotulo="Para todos" titulo="Antes de começar">
        <Grade>
          <Caixinha titulo="Cada pessoa vê só o que foi liberado">
            <p>As telas do Financeiro aparecem no menu só para quem tem a permissão. Se faltar alguma, peça ao administrador para liberar em Permissões.</p>
          </Caixinha>
          <Caixinha titulo="Telas da empresa ativa">
            <p>
              <b>Caixa</b>, <b>Boletos</b> e <b>Negociações</b> mostram só a empresa escolhida no alto do menu. Para ver outra empresa, troque a empresa ativa.
            </p>
          </Caixinha>
          <Caixinha titulo="Telas do grupo inteiro">
            <p>
              <b>Consulta/Solicitação de Crédito</b>, <b>Liberação / Limite de Crédito</b> e <b>Requisição Posto</b> mostram todas as empresas juntas, sem precisar trocar.
            </p>
          </Caixinha>
          <Caixinha titulo="Como digitar valores">
            <p>
              Use vírgula para os centavos: <b>1.250,50</b>. O ponto separa milhar. Escrever "1250.50" pode virar outro valor.
            </p>
          </Caixinha>
          <Caixinha titulo="Exportar para o Excel">
            <p>Quase toda lista tem o botão <b>Exportar CSV</b>, que baixa uma planilha pronta para abrir no Excel.</p>
          </Caixinha>
          <Caixinha titulo="Dados sigilosos">
            <p>Valores, limites e respostas de crédito são confidenciais. Não mande prints dessas telas em grupos.</p>
          </Caixinha>
        </Grade>
      </Secao>

      {/* ───────── CAIXA ───────── */}
      <Secao id="caixa" rotulo="Empresa ativa" titulo="Caixa" intro="Entradas e saídas de dinheiro, com o saldo do período e de cada mês.">
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr] items-start">
          <Print src={imgCaixa} alt="Tela Caixa com entradas, saídas, saldo, formulário de novo lançamento e lista" />
          <div className="space-y-3">
            <Passo titulo="Lançar">
              <ol className="list-decimal pl-5 space-y-1.5 text-sm text-dark-200">
                <li>
                  Em <b>Novo lançamento</b>, escolha <b>Entrada</b> ou <b>Saída</b>.
                </li>
                <li>Digite o valor e a data. A descrição é opcional, mas ajuda muito na conferência.</li>
                <li>
                  Clique em <b>Registrar</b>.
                </li>
              </ol>
            </Passo>
            <Caixinha titulo="Período">
              <p>O seletor de mês mostra o mês inteiro. Para ver só uma quinzena, ou um período que atravessa dois meses, mude as datas de início e fim.</p>
              <p>Os cards Entradas, Saídas e Saldo somam o período todo. O filtro "Todos / Entradas / Saídas" muda só a lista.</p>
            </Caixinha>
            <Caixinha titulo="Lançamento automático">
              <p>Na Compretec Loja Física, a venda de balcão para Consumidor Final já cria a entrada no Caixa sozinha. Não lance de novo.</p>
            </Caixinha>
            <Caixinha titulo="Errou?">
              <p>
                Use <b>Remover</b> na linha e lance de novo com o valor certo.
              </p>
            </Caixinha>
          </div>
        </div>
      </Secao>

      {/* ───────── BOLETOS ───────── */}
      <Secao id="boletos" rotulo="Empresa ativa" titulo="Boletos" intro="Planilha dos boletos da empresa: valor, vencimento, renegociação e histórico de cada um.">
        <Print
          src={imgBoletos}
          alt="Tela Boletos com resumo de em aberto, renegociados, vencidos e total, e lista de boletos"
          pinos={[
            { x: 28, y: 18.2 },
            { x: 93.5, y: 19.5 },
            { x: 64.5, y: 32.3 },
            { x: 88.5, y: 50 },
            { x: 25, y: 54.9 },
          ]}
          legenda={[
            <>
              <b>Abas:</b> Boletos e Pedidos de alteração.
            </>,
            <>
              <b>Novo boleto:</b> escolha o cliente (já cadastrado), número (opcional), valor e vencimento.
            </>,
            <>
              <b>Resumo:</b> quantos estão em aberto, renegociados, vencidos e o total em aberto.
            </>,
            <>
              <b>Situação:</b> <Status cor={CINZA}>Em aberto</Status> <Status cor={LARANJA}>Renegociado</Status> <Status cor={VERDE}>Pago</Status>. Fica{' '}
              <Status cor={VERMELHO}>Vencido</Status> sozinho quando a data passa e ele não foi pago.
            </>,
            <>
              <b>Clique na linha</b> para abrir o boleto.
            </>,
          ]}
        />
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Passo titulo="Dentro do boleto: renegociar, prorrogar, dar baixa">
            <Print src={imgBoletoModal} alt="Boleto aberto com alterar valor, alterar vencimento, marcar como pago e histórico" />
            <ul className="list-disc pl-5 space-y-1 text-sm text-dark-200">
              <li>
                <b>Alterar valor pra:</b> desconto ou acordo. O boleto vira <b>Renegociado</b> e o valor original continua guardado.
              </li>
              <li>
                <b>Alterar vencimento:</b> nova data.
              </li>
              <li>
                <b>Marcar como pago:</b> dá baixa no boleto.
              </li>
              <li>
                <b>Histórico:</b> toda mudança fica registrada, com de/para, quem fez e quando.
              </li>
            </ul>
          </Passo>
          <Passo titulo="Pedidos de alteração">
            <Print src={imgBoletosPedidos} alt="Aba Pedidos de alteração com cliente, vendedor, número, valor, tipo, datas e status" />
            <p className="text-sm text-dark-200">
              Quando o cliente ou o vendedor pede para mudar a data, mudar o valor ou cancelar um boleto, o pedido fica registrado aqui até o Financeiro fazer a troca. Não precisa ter o boleto cadastrado.
            </p>
            <p className="text-sm text-dark-200">
              Acompanhe pelo status: <Status cor={CINZA}>Pendente</Status> → <Status cor={LARANJA}>Em processo</Status> → <Status cor={VERDE}>Finalizado</Status>. Preencha a{' '}
              <b>Data da troca</b> quando a alteração for feita de verdade (pode ser depois de finalizar).
            </p>
          </Passo>
        </div>
      </Secao>

      {/* ───────── NEGOCIAÇÕES ───────── */}
      <Secao
        id="negociacoes"
        rotulo="Empresa ativa"
        titulo="Negociações (cobrança)"
        intro="Três planilhas do dia a dia de cobrança: os contatos de cobrança, os clientes no Cartório e os enviados à assessoria RC."
      >
        <Print
          src={imgNegCobranca}
          alt="Aba Cobrança do dia com cliente, valor, vencimento, canal, retorno do cliente e status"
          pinos={[
            { x: 35, y: 18.2 },
            { x: 12.5, y: 26.8 },
            { x: 92.7, y: 21.5 },
            { x: 82.5, y: 49.7 },
          ]}
          legenda={[
            <>
              <b>Abas:</b> Cobrança do dia, Cartório e Enviados à RC.
            </>,
            <>
              <b>Vencimento de / até:</b> filtra pela data de vencimento da dívida.
            </>,
            <>
              <b>Nova cobrança:</b> registre cada contato. Cliente, valor, vencimento, canal (WhatsApp, ligação ou e-mail) e o que o cliente respondeu.
            </>,
            <>
              <b>Status:</b> mude direto na linha. <Status cor={VERDE}>Pago</Status> encerra. <Status cor={LARANJA}>Enviado ao cartório</Status> e{' '}
              <Status cor={VERMELHO}>Enviado à RC</Status> já criam a linha na aba correspondente, sem cadastrar de novo.
            </>,
          ]}
        />
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Passo titulo="Cartório">
            <Print src={imgNegCartorio} alt="Aba Cartório com clientes, valor, data de envio e status" />
            <p className="text-sm text-dark-200">
              Lista de quem foi para o cartório. Serve para lembrar de cobrar quando o cliente voltar: <Status cor={CINZA}>Aguardando cartório</Status> →{' '}
              <Status cor={VERMELHO}>Voltou — cobrar</Status> → <Status cor={VERDE}>Cobrança feita</Status>.
            </p>
          </Passo>
          <Passo titulo="Enviados à RC">
            <Print src={imgNegRc} alt="Aba Enviados à RC com clientes, valor, data, parcelas e status" />
            <p className="text-sm text-dark-200">
              Clientes passados para a assessoria de cobrança: <Status cor={LARANJA}>Em negociação</Status> → <Status cor={VERDE}>Acordo fechado</Status> ou{' '}
              <Status cor={VERMELHO}>Não fechou</Status>. As <b>parcelas</b> podem ser preenchidas depois, quando o acordo sair. "Por vendedor" mostra quanto cada carteira tem na RC. Dá para marcar
              várias linhas e excluir de uma vez.
            </p>
          </Passo>
        </div>
      </Secao>

      {/* ───────── CRÉDITO ───────── */}
      <Secao
        id="credito"
        rotulo="Grupo inteiro"
        titulo="Crédito: consulta, liberação e limite"
        intro="O vendedor pede pelo CRM e o Financeiro responde. Tudo fica registrado, das 4 empresas, numa tela só."
      >
        <Grade>
          <Caixinha titulo="1. O vendedor pede">
            <p>
              Em <b>Consulta/Solicitação de Crédito</b>, escolhe um cliente da carteira dele e o que precisa: <b>Consulta geral</b>, <b>Só verificar se está limpo</b> ou{' '}
              <b>Limite de crédito</b>. Pode mandar valor, informações fiscais e anexos (print, áudio, vídeo).
            </p>
          </Caixinha>
          <Caixinha titulo="2. O Financeiro responde">
            <p>
              Abre o pedido na fila, vê o histórico completo do cliente (compras, orçamentos, itens) e decide <b>Liberado</b> ou <b>Negado</b>, com motivo e, se quiser, a observação do Serasa.
            </p>
          </Caixinha>
          <Caixinha titulo="3. Fica registrado">
            <p>
              Resposta de <b>consulta</b> vai para Liberação de Crédito → Lançamentos. Pedido de <b>limite</b> fica na aba Limites. O vendedor vê a resposta na hora e pode contestar pelo WhatsApp.
            </p>
          </Caixinha>
        </Grade>

        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Passo titulo="A fila do Financeiro">
            <Print src={imgSolFila} alt="Fila de solicitações de crédito com filtros de cliente, datas, vendedor e status" />
            <p className="text-sm text-dark-200">
              Menu <b>Consulta/Solicitação de Crédito</b>. Já abre nos <b>Pendentes</b>. Filtre por cliente, datas, vendedor ou status (Liberados, Negados, Todas).
            </p>
          </Passo>
          <Passo titulo="Responder um pedido">
            <Print src={imgSolDetalhe} alt="Solicitação aberta com valor, informações fiscais, observações e histórico completo do cliente" />
            <ul className="list-disc pl-5 space-y-1 text-sm text-dark-200">
              <li>
                Para <b>liberar</b> uma consulta geral ou um limite, informe o <b>valor liberado</b>. Para "só verificar se está limpo", não precisa de valor.
              </li>
              <li>
                <b>Quem decidiu</b> e <b>Motivo</b> são obrigatórios. Serasa e anexos são opcionais.
              </li>
              <li>Dá para responder de novo depois (reavaliação, por exemplo quando o cliente quitou). A resposta anterior continua no histórico.</li>
              <li>
                <b>Conversar sobre isso</b> abre o chat interno já ligado a esse pedido.
              </li>
            </ul>
          </Passo>
        </div>

        <Passo titulo="O que o vendedor vê">
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr] items-start">
            <Print src={imgVendSol} alt="Tela do vendedor com formulário de nova solicitação e lista dos pedidos dele" />
            <div className="space-y-3 text-sm text-dark-200">
              <p>O vendedor só consegue pedir para cliente da própria carteira.</p>
              <p>Ele não consegue abrir dois pedidos iguais (mesmo cliente e mesmo tipo) enquanto um estiver pendente.</p>
              <p>
                Na lista ele acompanha o status e, depois da resposta, vê a decisão e o botão <b>Contestar no WhatsApp</b>.
              </p>
            </div>
          </div>
        </Passo>

        <Passo titulo="Liberação / Limite de Crédito">
          <Print src={imgLibLanc} alt="Tela Liberação / Limite de Crédito na aba Lançamentos" />
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            <div className="space-y-2 text-sm text-dark-200">
              <p>
                <b>Lançamentos:</b> o registro de cada liberação ou negativa. As respostas de consulta entram sozinhas. Use <b>Nova liberação</b> para registrar uma que foi decidida fora do CRM (por
                telefone, por exemplo): cliente cadastrado, quem liberou, motivo e, se tiver, um anexo.
              </p>
              <p>
                <b>Limites:</b> a fila dos pedidos de limite de crédito, separada das consultas.
              </p>
              <p>
                <b>Relatório:</b> total no período, por cliente, por vendedor, por quem liberou e por dia.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Print src={imgLibLimites} alt="Aba Limites com pedidos de limite de crédito" />
              <Print src={imgLibRel} alt="Aba Relatório com totais por cliente, vendedor, quem liberou e dia" />
            </div>
          </div>
        </Passo>
      </Secao>

      {/* ───────── POSTO ───────── */}
      <Secao id="posto" rotulo="Grupo inteiro" titulo="Requisição Posto" intro="Controle de abastecimento de todas as empresas, com o fechamento do mês e os canhotos que faltam.">
        <Print
          src={imgPosto}
          alt="Tela Requisição Posto com formulário, fechamento do mês e lista de lançamentos"
          pinos={[
            { x: 24, y: 17.4 },
            { x: 33.5, y: 24.3 },
            { x: 61.8, y: 24.2 },
            { x: 68, y: 37.3 },
            { x: 67, y: 60.6 },
            { x: 71, y: 69.7 },
          ]}
          legenda={[
            <>
              <b>Lançar requisição:</b> data, colaborador (o motorista, que não tem login), carro e valor.
            </>,
            <>
              <b>+</b> ao lado do menu cadastra um colaborador novo (nome e empresa) ou um carro novo (placa).
            </>,
            <>
              <b>Canhoto já entregue:</b> marque se o canhoto do posto já chegou.
            </>,
            <>
              <b>Fechamento do mês:</b> total, quanto foi de cada empresa e de cada colaborador, e quantos canhotos estão pendentes.
            </>,
            <>
              <b>Mês da lista:</b> escolha o mês dos lançamentos.
            </>,
            <>
              <b>Canhoto:</b> clique para trocar entre entregue e não entregue. O lápis corrige um lançamento sem precisar apagar.
            </>,
          ]}
        />
      </Secao>

      {/* ───────── CARTÃO ───────── */}
      <Secao id="cartao" rotulo="Odin Compressores" titulo="Cartão de Crédito" intro="Gastos do cartão corporativo dos vendedores externos, sempre com a nota ou o cupom fiscal.">
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Passo titulo="O vendedor lança o gasto">
            <Print src={imgVendCartao} alt="Tela Cartão de Crédito do vendedor com novo gasto e lista" />
            <p className="text-sm text-dark-200">
              Data, valor, categoria (combustível, alimentação, hospedagem, pedágio, manutenção, outro) e descrição. <b>Pelo menos um anexo</b> (nota ou cupom) é obrigatório: sem ele o gasto não
              é salvo.
            </p>
          </Passo>
          <Passo titulo="Relatório do cartão">
            <Print src={imgCartaoRel} alt="Relatório do cartão com total do mês, total por vendedor e lançamentos com o cupom" />
            <p className="text-sm text-dark-200">
              Menu <b>Cartão de Crédito (Relatório)</b>. Total do mês, quanto cada vendedor gastou e cada gasto com o link para o cupom. Quem tem essa permissão vê os gastos da própria empresa.
            </p>
          </Passo>
        </div>
      </Secao>

      {/* ───────── PAINEL / FATURAMENTO ───────── */}
      <Secao id="paineis" rotulo="Visão geral" titulo="Painel Financeiro e Faturamento Geral">
        <Grade>
          <Caixinha titulo="Painel Financeiro">
            <p>Tela para TV (abre em nova aba), feita para uma sala fechada. Mostra vendas de hoje, vendas do mês, % da meta e inadimplência de cada empresa do grupo, e atualiza sozinha a cada 30 segundos.</p>
            <p>A inadimplência é digitada à mão no próprio painel.</p>
            <p>
              A segunda tela mostra as demandas marcadas com <b>Mostrar no Painel Financeiro</b> em Demandas (cobrança pendente, nota a emitir...).
            </p>
          </Caixinha>
          <Caixinha titulo="Faturamento da Odin Compressores">
            <p>Conta os pedidos que entraram na etapa Faturamento no mês (cancelados não contam). É a mesma conta da aba Faturamento dos Relatórios Odin.</p>
          </Caixinha>
          <Caixinha titulo="Faturamento Geral (Compretec Loja Física)">
            <p>Junta num quadro só os cards em Fechado, Faturamento e Consumidor Final de todos os vendedores da loja. Serve para conferir cupom/nota e marcar o que já foi faturado. Escolha o mês no alto.</p>
          </Caixinha>
        </Grade>
      </Secao>

      {/* ───────── ROTINA ───────── */}
      <Secao id="rotina" rotulo="Sugestão" titulo="Quando olhar o quê">
        <Grade>
          <Caixinha titulo="Todo dia" tom="ok">
            <ul className="list-disc pl-5 space-y-1">
              <li>Consulta/Solicitação de Crédito: responder os pendentes.</li>
              <li>Boletos: ver os vencidos e os pedidos de alteração pendentes.</li>
              <li>Negociações: registrar cada cobrança feita no dia.</li>
              <li>Caixa: lançar entradas e saídas do dia.</li>
              <li>Requisição Posto: lançar as requisições e marcar os canhotos recebidos.</li>
            </ul>
          </Caixinha>
          <Caixinha titulo="Toda semana" tom="ok">
            <ul className="list-disc pl-5 space-y-1">
              <li>Cartório: quem está em "Voltou — cobrar"?</li>
              <li>RC: atualizar acordos e parcelas.</li>
              <li>Liberação de Crédito → Limites: nada esquecido na fila.</li>
            </ul>
          </Caixinha>
          <Caixinha titulo="Todo mês" tom="ok">
            <ul className="list-disc pl-5 space-y-1">
              <li>Requisição Posto: fechamento do mês e cobrança dos canhotos pendentes.</li>
              <li>Cartão de Crédito (Relatório): conferir os gastos com os cupons.</li>
              <li>Caixa: saldo de cada mês nos últimos 12 meses.</li>
              <li>Liberação de Crédito → Relatório: quem mais pediu e quem mais liberou.</li>
              <li>Painel Financeiro: atualizar a inadimplência de cada empresa.</li>
            </ul>
          </Caixinha>
        </Grade>
      </Secao>

      <p className="text-xs text-dark-500 border-t border-dark-700 pt-4">Guia do Financeiro · Grupo Odin · outubro de 2026 · prints com dados de exemplo.</p>
    </div>
  )
}

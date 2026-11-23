// Guia do Módulo Marketing (João, 2026-11-23): o ciclo do mês e o que cada aba faz.
// Painel "Como funciona" no topo + uma linha de dica embaixo das abas.
import { cls } from './comum'

export const DICA_ABA: Record<string, string> = {
  hoje: 'Comece por aqui: o que está esperando você, a semana da marca escolhida e as metas. Clique em qualquer item para ir resolver.',
  empresa: 'Conheça a marca antes de planejar: base de conhecimento (documentos que a IA lê), números das redes, para quem falamos (persona) e forças e fraquezas (SWOT). Revise 1 vez por mês.',
  brainstorm: 'Guarde ideias e links que inspiram. Clique no card para completar, adaptar para a empresa com IA (ou copiar o pedido para o Claude) e criar a peça no Calendário.',
  plano: 'O norte do mês: objetivo, mensagem central, pilares (os tipos de conteúdo, cada um com uma cor, na ordem que você escolher com ▲▼), metas e o que funcionou ou travou no mês anterior.',
  calendario: 'As peças do mês, semana a semana. Clique numa peça para escrever o roteiro (ou colar ele inteiro, que o CRM separa) e gerar a legenda. Escreveu o roteiro, a peça já anda no Quadro. Meta: 3 vídeos + 2 posts por semana.',
  pedidos: 'O que outros setores pedem ao marketing pelo menu "Pedir ao marketing": Novo → Aprovado → Produção → Entregue. Só entrega com o arquivo anexado.',
  quadro: 'Cada peça pelas etapas: Ideia → Roteiro → Aprovação do roteiro → Produção → Aprovação final → Agendado na mLabs. Arraste o cartão. Para agendar precisa do vídeo/arte anexado. Vermelho = atrasada.',
  revisao: 'Os revisores aprovam o roteiro (libera a gravação) e a peça pronta. João revisa vídeo e post, Maria só vídeo, Gaby só post. O que cada um muda no roteiro fica na cor dele. A nota da IA ajuda.',
  metas: 'Confere no Instagram de verdade se saiu o combinado na semana (3 vídeos + 2 posts por marca). Olhe toda sexta.',
  relatorios: 'Em quais redes menos postamos e quantos vídeos e posts saem por mês, semana e dia, por marca e por rede.',
  radar: 'Comentários com o texto (responda os que estão sem resposta), Directs (quando a Meta liberar) e o que os concorrentes estão postando.',
  conexoes: 'Revisores (quem aprova o quê), chave da Meta de cada marca e importação de dados. Só o super admin vê.',
}

const CICLO: { quando: string; cor: string; passos: [string, string][] }[] = [
  {
    quando: 'Antes do mês começar (dias 20 a 30)',
    cor: 'border-t-blue-500',
    passos: [
      ['Empresa', 'Atualize a base de conhecimento, olhe os números das redes e confira persona e SWOT.'],
      ['Brainstorm', 'Separe as ideias que vão entrar no mês.'],
      ['Plano do mês', 'Escreva objetivo, mensagem e metas. Puxe o que funcionou e o que travou no mês anterior. A IA monta um rascunho.'],
      ['Calendário', 'Distribua 3 vídeos + 2 posts por semana, com tema da semana. Escreva os roteiros.'],
      ['Revisão', 'Mande os roteiros para aprovação. Os revisores aprovam (libera a gravação) ou pedem ajuste.'],
    ],
  },
  {
    quando: 'Toda semana, durante o mês',
    cor: 'border-t-orange-500',
    passos: [
      ['Segunda · Quadro', 'Veja o que é da semana. Se faltar peça, o CRM cria sozinho às 6h10 para completar a meta.'],
      ['Seg a qui · Quadro', 'Produção (gravar e editar) → anexar o vídeo/arte → aprovação final → agendar na mLabs.'],
      ['Todo dia · Pedidos e Radar', 'Responda os pedidos dos outros setores e os comentários do Instagram.'],
      ['Sexta · Metas e Relatórios', 'Confira se saíram os 3 vídeos + 2 posts de cada marca e em qual rede ficou faltando.'],
    ],
  },
  {
    quando: 'No fim do mês',
    cor: 'border-t-green-500',
    passos: [
      ['Plano do mês', 'Anote o que funcionou e o que travou. Isso vira o diagnóstico do mês seguinte e o ciclo recomeça.'],
    ],
  },
]

const ETAPAS = ['Ideia', 'Roteiro', 'Aprovação do roteiro', 'Produção (gravação e edição)', 'Aprovação final', 'Agendado na mLabs']

export default function GuiaMarketing({ fechar }: { fechar: () => void }) {
  return (
    <div className="bg-dark-800 border border-gold-700/50 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cls.rotulo}>Guia</div>
          <h2 className="text-xl font-bold text-dark-100">Como funciona o Marketing</h2>
          <p className="text-sm text-dark-400 mt-1">Comece em <b className="text-dark-200">Hoje</b>. Depois a ordem do trabalho: <b className="text-dark-200">Planejar</b> → <b className="text-dark-200">Produzir</b> → <b className="text-dark-200">Aprovar</b> → <b className="text-dark-200">Resultados</b>. Cada marca tem o seu plano por mês.</p>
        </div>
        <button onClick={fechar} className="text-dark-400 hover:text-dark-100 text-sm whitespace-nowrap">Fechar ✕</button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {CICLO.map((c) => (
          <div key={c.quando} className={`bg-dark-900 border border-dark-700 border-t-4 ${c.cor} rounded-xl p-3 space-y-2`}>
            <div className="font-bold text-dark-100">{c.quando}</div>
            <ol className="space-y-1.5">
              {c.passos.map(([aba, txt], i) => (
                <li key={i} className="text-sm text-dark-300"><b className="text-dark-100">{aba}:</b> {txt}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="font-bold text-dark-100 text-sm">O caminho de uma peça</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {ETAPAS.map((e, i) => (
            <span key={e} className="flex items-center gap-1.5">
              <span className="px-2 py-1 rounded bg-dark-700 text-dark-200">{e}</span>
              {i < ETAPAS.length - 1 && <span className="text-dark-500">→</span>}
            </span>
          ))}
        </div>
        <p className="text-xs text-dark-400">Escreveu o roteiro, a peça vai para Roteiro. O revisor aprova o roteiro e a peça vai para Produção com a etiqueta "Liberado para gravação". Anexe o vídeo/arte, ela passa pela aprovação final e só então vai para Agendado na mLabs. Pedir ajuste volta uma etapa. O anexo também fica em Arquivos/Mídia → Marketing. Demanda complementar (fora do plano) pula a aprovação do roteiro.</p>
      </div>
    </div>
  )
}

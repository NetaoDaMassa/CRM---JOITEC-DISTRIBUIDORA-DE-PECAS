// Guia do Módulo Marketing (João, 2026-11-23): o ciclo do mês e o que cada aba faz.
// Painel "Como funciona" no topo + uma linha de dica embaixo das abas.
import { cls } from './comum'

export const DICA_ABA: Record<string, string> = {
  empresa: 'Conheça a marca antes de planejar: números do Instagram dos últimos 90 dias (vêm sozinhos da Meta), para quem falamos (persona) e forças e fraquezas (SWOT). Revise 1 vez por mês.',
  brainstorm: 'Guarde aqui links de vídeos que inspiram e ideias soltas. Quando uma ideia virar peça no Calendário, clique em "Marcar como usada".',
  plano: 'O norte do mês: objetivo, mensagem central, pilares (os tipos de conteúdo, cada um com uma cor), metas e o que funcionou ou travou no mês anterior.',
  calendario: 'As peças do mês, semana a semana, com o tema de cada semana. Clique numa peça para escrever título, gancho, roteiro e legenda. Meta: 3 vídeos + 2 posts por semana.',
  pedidos: 'O que outros setores pedem ao marketing pelo menu "Pedir ao marketing". Defina quem faz, responda e entregue com o link do arquivo.',
  quadro: 'Cada peça andando pelas etapas, de Ideia até Publicado. Arraste o cartão para mudar de etapa e defina o responsável. Vermelho = atrasada.',
  revisao: 'A IA dá nota para os roteiros. Nota boa vai para "prontos para gravar"; o resto mostra o que ajustar. Aprove em lote ou mande o link de aprovação (sem login) para o gestor.',
  metas: 'Confere no Instagram de verdade se saiu o combinado na semana (3 vídeos + 2 posts por marca). Olhe toda sexta.',
  radar: 'Comentários com o texto (responda os que estão sem resposta), Directs (quando a Meta liberar) e o que os concorrentes estão postando.',
  conexoes: 'Chave da Meta de cada marca (cada empresa tem o seu portfólio) e importação de dados. Só o super admin vê.',
}

const CICLO: { quando: string; cor: string; passos: [string, string][] }[] = [
  {
    quando: 'Antes do mês começar (dias 20 a 30)',
    cor: 'border-t-blue-500',
    passos: [
      ['Empresa', 'Olhe os números do Instagram e confira se persona e SWOT continuam certos.'],
      ['Brainstorm', 'Separe as ideias que vão entrar no mês.'],
      ['Plano do mês', 'Escreva objetivo, mensagem e metas. Puxe o que funcionou e o que travou no mês anterior. A IA monta um rascunho.'],
      ['Calendário', 'Distribua 3 vídeos + 2 posts por semana, com tema da semana. Escreva os roteiros.'],
      ['Revisão', 'A IA dá nota nos roteiros. Ajuste os fracos e aprove (ou mande o link de aprovação).'],
    ],
  },
  {
    quando: 'Toda semana, durante o mês',
    cor: 'border-t-orange-500',
    passos: [
      ['Segunda · Quadro', 'Veja o que é da semana. Se faltar peça, o CRM cria sozinho às 6h10 para completar a meta.'],
      ['Seg a qui · Quadro', 'Gravar → editar → aprovar → agendar na mLabs. Arraste o cartão a cada etapa.'],
      ['Todo dia · Pedidos e Radar', 'Responda os pedidos dos outros setores e os comentários do Instagram.'],
      ['Sexta · Metas', 'Confira se saíram os 3 vídeos + 2 posts de cada marca.'],
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

const ETAPAS = ['Ideia', 'Roteiro', 'Gravação', 'Edição', 'Aprovação', 'Agendado na mLabs', 'Publicado']

export default function GuiaMarketing({ fechar }: { fechar: () => void }) {
  return (
    <div className="bg-dark-800 border border-gold-700/50 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={cls.rotulo}>Guia</div>
          <h2 className="text-xl font-bold text-dark-100">Como funciona o Marketing</h2>
          <p className="text-sm text-dark-400 mt-1">As abas estão na ordem do trabalho: <b className="text-dark-200">1. Planejar</b> → <b className="text-dark-200">2. Produzir</b> → <b className="text-dark-200">3. Acompanhar</b>. Cada marca tem o seu plano por mês.</p>
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
        <p className="text-xs text-dark-400">Aprovar o roteiro manda a peça para Gravação. Aprovar o vídeo pronto manda para Agendado na mLabs. Pedir ajuste volta uma etapa. Peça vencida que não foi agendada fica vermelha.</p>
      </div>
    </div>
  )
}

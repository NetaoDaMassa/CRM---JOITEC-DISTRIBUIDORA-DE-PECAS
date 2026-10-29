// Etapa "Pós-venda" do pedido de MÁQUINA (Odin Compressores) — pedido do
// João, 2026-10-29: manda ao cliente o PDF padrão (cuidados, plano de
// preventiva, garantia) + link da pesquisa de satisfação; a resposta fica
// gravada aqui e, respondida, o pedido vai sozinho pra "Concluído" (que abre
// o Agendamento de peças).
// Também é o Pós-venda do pedido de PEÇA (João, 2026-10-29): previsão de
// chegada no lugar do PDF, sem técnico, e o Concluir é só o OK.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, FileText, MessageCircle, Send } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import Button from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import FormPesquisa, { ATENDEU_LABEL, Estrelas, PERGUNTAS_NOTA } from '../posVenda/FormPesquisa'
import PassoAPasso from '../posVenda/PassoAPasso'
import PrevisaoChegadaPeca from './PrevisaoChegadaPeca'

function dataHora(v: string | null) {
  if (!v) return ''
  return new Date(v.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function EtapaPosVendaMaquina({
  ordemId,
  readonly,
  clienteNome,
  clienteWhatsapp,
}: {
  ordemId: number
  isAdmin: boolean
  readonly: boolean
  clienteNome?: string | null
  clienteWhatsapp?: string | null
  clienteRevendaId?: number | null
}) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.posVendaOdin.painelOrdem.useQuery({ ordemId })
  const [transportadora, setTransportadora] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [lancando, setLancando] = useState(false)
  const [obsAcompanhamento, setObsAcompanhamento] = useState('')
  const podeEditar = !readonly

  const linkCompleto = data ? `${window.location.origin}${data.linkPesquisa}` : ''
  useEffect(() => {
    if (!data) return
    setTransportadora(data.pesquisa.transportadora ?? '')
    setTecnico(data.pesquisa.tecnicoNome ?? '')
    const ehPeca = data.orderType === 'peca'
    const docs = data.documentos.map((d) => `• ${d.titulo}: ${window.location.origin}${d.url}`).join('\n')
    setMensagem(
      `Olá${clienteNome ? `, ${clienteNome}` : ''}! Aqui é da Odin Compressores. 😊\n\n` +
        (docs ? `Segue o guia do seu equipamento, com os cuidados, o plano de manutenção preventiva e as informações de garantia:\n${docs}\n\n` : '') +
        (ehPeca
          ? `Queremos saber como foi a sua experiência com a Odin e com a entrega das suas peças. Leva menos de 1 minuto:`
          : `Queremos saber como foi a sua experiência com a Odin, com a entrega e com o técnico que fez a partida da máquina. Leva menos de 1 minuto:`) +
        `\n${window.location.origin}${data.linkPesquisa}\n\nObrigado!`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.pesquisa.id, data?.documentos.length])

  const invalidar = () => {
    utils.posVendaOdin.painelOrdem.invalidate({ ordemId })
    utils.ordens.core.invalidate()
  }
  const salvarAvaliadosMut = trpc.posVendaOdin.salvarAvaliados.useMutation({ onSuccess: () => { toast.success('Salvo'); invalidar() }, onError: (e) => toast.error(e.message) })
  const enviadoMut = trpc.posVendaOdin.marcarEnviado.useMutation({ onSuccess: invalidar, onError: (e) => toast.error(e.message) })
  const respostaMut = trpc.posVendaOdin.registrarResposta.useMutation({
    onSuccess: (r) => {
      toast.success(r.concluiu ? 'Resposta salva — pedido concluído e enviado para a carteira da Bruna' : 'Resposta salva')
      setLancando(false)
      invalidar()
    },
    onError: (e) => toast.error(e.message),
  })
  const concluirMut = trpc.posVendaOdin.concluirPosVenda.useMutation({
    onSuccess: (_r, v) => {
      toast.success(v.acao === 'bruna' ? 'Enviado para a carteira da Bruna — pedido concluído' : 'Pedido concluído')
      invalidar()
      utils.ordens.invalidate()
    },
    onError: (e) => toast.error(e.message),
  })
  const resolverMut = trpc.posVendaOdin.resolverAcompanhamento.useMutation({ onSuccess: () => { toast.success('Registrado'); invalidar() }, onError: (e) => toast.error(e.message) })

  if (isLoading || !data) return <p className="text-dark-500 text-sm">Carregando...</p>
  const p = data.pesquisa
  const peca = data.orderType === 'peca'
  const num = (n: number) => n
  const perguntas = peca ? PERGUNTAS_NOTA.filter((q) => q.campo !== 'notaTecnico') : PERGUNTAS_NOTA

  function enviarWhatsapp() {
    if (!clienteWhatsapp) { toast.error('Cliente sem WhatsApp cadastrado — use "Copiar mensagem"'); return }
    const numero = clienteWhatsapp.replace(/\D/g, '')
    window.open(`https://wa.me/${numero.length <= 11 ? `55${numero}` : numero}?text=${encodeURIComponent(mensagem)}`, '_blank')
    enviadoMut.mutate({ ordemId })
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem)
      toast.success('Mensagem copiada')
      enviadoMut.mutate({ ordemId })
    } catch {
      toast.error('Não deu para copiar — selecione o texto e copie manualmente')
    }
  }

  return (
    <div className="space-y-5">
      {peca && (
        <PassoAPasso
          chave="feedback_peca"
          titulo="Como funciona o Pós-venda da peça"
          explicacao="Nesta etapa a Odin acompanha a chegada das peças e manda ao cliente uma pesquisa rápida de satisfação."
          passos={[
            <>Em <b>1. Previsão de chegada</b>, marque quando as peças devem chegar ao cliente e clique em <b>Salvar</b> (aparece no Calendário Odin).</>,
            <>Em <b>2. Quem o cliente vai avaliar</b>, confira a transportadora e clique em <b>Salvar</b>.</>,
            <>Em <b>3. Enviar ao cliente</b>, revise a mensagem e clique em <b>Enviar no WhatsApp</b> (ou <b>Copiar mensagem</b>).</>,
            <>A resposta aparece em <b>4. Resposta</b>. Se o cliente respondeu por telefone, clique em <b>Lançar resposta</b>. Respondida, o pedido vai sozinho para <b>Concluído</b>.</>,
            <>Se aparecer o aviso vermelho de <b>acompanhamento</b>, resolva com o cliente e escreva o que foi feito.</>,
            <>Se o cliente não responder, clique em <b>5. Concluir → Concluir pedido</b> (só depois de enviar a pesquisa).</>,
          ]}
          dicas={['As notas entram em Relatórios Odin → Pós-venda → Satisfação (dá para filtrar só peças).']}
        />
      )}
      {!peca && (
      <PassoAPasso
        chave="pos_venda_pedido"
        titulo="Como funciona o Pós-venda"
        explicacao="Nesta etapa a Odin manda ao cliente o guia do equipamento e uma pesquisa rápida de satisfação. O objetivo é saber se o cliente ficou bem atendido e achar o que precisa melhorar."
        passos={[
          <>Confira em <b>1. Documento</b> se aparece o PDF do equipamento. Se não aparecer, peça para subirem em <b>Config. Odin → Pós-venda</b>.</>,
          <>Em <b>2. Quem o cliente vai avaliar</b>, confira a transportadora, digite o nome do técnico que fez a partida da máquina e clique em <b>Salvar</b>.</>,
          <>Em <b>3. Enviar ao cliente</b>, revise a mensagem e clique em <b>Enviar no WhatsApp</b> (ou <b>Copiar mensagem</b> para mandar por outro lugar).</>,
          <>A resposta do cliente aparece em <b>4. Resposta</b>. Se ele respondeu por telefone, clique em <b>Lançar resposta</b> e marque o que ele disse.</>,
          <>Se aparecer o aviso vermelho de <b>acompanhamento</b> (nota 1 ou 2, "não atendeu" ou o cliente pediu contato), resolva com o cliente e escreva o que foi feito.</>,
          <><b>Compressor:</b> em <b>5. Concluir</b>, clique em <b>Enviar para a carteira da Bruna e concluir</b>. A revenda vai junto, puxada do próprio pedido. Venda de peça, 1ª preventiva e lembrete a Bruna preenche no card dela. (Se o cliente responder a pesquisa pelo link, isso acontece sozinho.)</>,
          <><b>Secador, trafo, reservatório, filtro ou motocompressor:</b> não vai para a Bruna (não tem peça nem preventiva). Em <b>5. Concluir</b>, clique em <b>OK — concluir sem agendamento</b>.</>,
        ]}
        dicas={[
          'O pedido só pode ir para "Concluído" depois que a pesquisa foi enviada.',
          'O sistema reconhece o tipo pelo modelo das máquinas do pedido. Pedido sem máquina cadastrada mostra os dois botões.',
          'Use "Ver a pesquisa como o cliente vê" para conferir o link antes de mandar.',
        ]}
      />
      )}
      {peca && <PrevisaoChegadaPeca ordemId={ordemId} readonly={readonly} />}
      {/* 1. Documento */}
      {!peca && (
      <section className="p-4 rounded-xl border border-dark-700 bg-dark-900/40">
        <h3 className="text-sm font-semibold text-dark-100 mb-2 flex items-center gap-2"><FileText size={15} className="text-gold-400" /> 1. Documento para o cliente</h3>
        {data.documentos.length === 0 ? (
          <p className="text-sm text-amber-400">Nenhum PDF cadastrado ainda. Suba o documento padrão em Config. Odin → Pós-venda.</p>
        ) : (
          <div className="space-y-1">
            {data.documentos.map((d) => (
              <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-400 hover:underline">
                <FileText size={14} /> {d.titulo}
                {d.modelo && <span className="text-[11px] text-dark-500">(modelo {d.modelo})</span>}
              </a>
            ))}
          </div>
        )}
        {data.maquinas.length > 0 && (
          <p className="text-xs text-dark-500 mt-2">Máquinas do pedido: {data.maquinas.map((m) => `${m.modelo}${m.numeroSerie ? ` (série ${m.numeroSerie})` : ''}`).join(', ')}</p>
        )}
      </section>
      )}

      {/* 2. Quem é avaliado */}
      <section className="p-4 rounded-xl border border-dark-700 bg-dark-900/40">
        <h3 className="text-sm font-semibold text-dark-100 mb-2">{num(2)}. Quem o cliente vai avaliar</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Transportadora" value={transportadora} onChange={(e) => setTransportadora(e.target.value)} disabled={!podeEditar} placeholder="Ex.: Braspress" />
          {!peca && <Input label="Assistente técnico que fez a partida" value={tecnico} onChange={(e) => setTecnico(e.target.value)} disabled={!podeEditar} placeholder="Nome do técnico" />}
        </div>
        {podeEditar && (
          <Button size="sm" variant="secondary" className="mt-3" loading={salvarAvaliadosMut.isPending} onClick={() => salvarAvaliadosMut.mutate({ ordemId, transportadora, tecnicoNome: tecnico })}>
            Salvar
          </Button>
        )}
        <p className="text-[11px] text-dark-500 mt-2">Serve para o relatório mostrar a nota de cada transportadora{peca ? '' : ' e de cada técnico'}.</p>
      </section>

      {/* 3. Envio */}
      <section className="p-4 rounded-xl border border-dark-700 bg-dark-900/40">
        <h3 className="text-sm font-semibold text-dark-100 mb-2 flex items-center gap-2"><Send size={15} className="text-gold-400" /> {num(3)}. Enviar ao cliente</h3>
        {p.enviadoEm ? (
          <p className="text-xs text-green-400 mb-2">✓ Enviado em {dataHora(p.enviadoEm)}{p.respondidoEm ? '' : ' — aguardando resposta do cliente'}</p>
        ) : (
          <p className="text-xs text-dark-400 mb-2">Ainda não enviado. O pedido só pode ir para "Concluído" depois do envio.</p>
        )}
        <Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={8} disabled={!podeEditar} />
        {podeEditar && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Button size="sm" onClick={enviarWhatsapp} loading={enviadoMut.isPending}>
              <MessageCircle size={14} className="mr-1" /> Enviar no WhatsApp
            </Button>
            <Button size="sm" variant="secondary" onClick={copiar}>
              <Copy size={14} className="mr-1" /> Copiar mensagem
            </Button>
            <a href={linkCompleto} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline px-2">
              <ExternalLink size={13} /> Ver a pesquisa como o cliente vê
            </a>
          </div>
        )}
      </section>

      {/* 4. Resposta */}
      <section className="p-4 rounded-xl border border-dark-700 bg-dark-900/40">
        <h3 className="text-sm font-semibold text-dark-100 mb-3">{num(4)}. Resposta da pesquisa</h3>
        {p.respondidoEm ? (
          <div className="space-y-3">
            <p className="text-xs text-dark-400">
              Respondida em {dataHora(p.respondidoEm)} {p.respondidoVia === 'equipe' ? '(lançada pela equipe)' : '(pelo cliente, no link)'}
            </p>
            <div className="space-y-1.5">
              {perguntas.map((q) => (
                <div key={q.campo} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-dark-300">{q.texto}</span>
                  <Estrelas nota={p[q.campo]} />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-dark-300">Atendeu à necessidade?</span>
                <span className={p.atendeu === 'sim' ? 'text-green-400' : p.atendeu === 'parcial' ? 'text-amber-400' : 'text-red-400'}>{p.atendeu ? ATENDEU_LABEL[p.atendeu] : '—'}</span>
              </div>
            </div>
            {p.comentario && <p className="text-sm text-dark-200 bg-dark-800 rounded-lg p-3 whitespace-pre-wrap">“{p.comentario}”</p>}
            {p.querContato && <p className="text-sm text-amber-300">📞 O cliente pediu que a equipe entre em contato.</p>}
            {p.pedeAtencao && !p.acompanhamentoResolvidoEm && (
              <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-3 space-y-2">
                <p className="text-sm text-red-300 flex items-center gap-2"><AlertTriangle size={15} /> Esta resposta precisa de acompanhamento da equipe.</p>
                {podeEditar && (
                  <>
                    <Textarea value={obsAcompanhamento} onChange={(e) => setObsAcompanhamento(e.target.value)} placeholder="O que foi feito? (ex.: liguei, técnico vai voltar dia 05)" rows={2} />
                    <Button size="sm" disabled={!obsAcompanhamento.trim()} loading={resolverMut.isPending} onClick={() => resolverMut.mutate({ ordemId, obs: obsAcompanhamento })}>
                      Registrar e marcar como resolvido
                    </Button>
                  </>
                )}
              </div>
            )}
            {p.acompanhamentoResolvidoEm && (
              <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={13} /> Acompanhamento resolvido em {dataHora(p.acompanhamentoResolvidoEm)}: {p.acompanhamentoObs}</p>
            )}
          </div>
        ) : lancando ? (
          <div>
            <p className="text-xs text-dark-400 mb-3">Preencha com o que o cliente respondeu (por telefone ou mensagem).</p>
            <FormPesquisa semTecnico={peca} enviando={respostaMut.isPending} rotuloBotao="Salvar resposta" onEnviar={(r) => respostaMut.mutate({ ordemId, ...r })} />
            <button className="text-xs text-dark-400 hover:text-dark-200 mt-3" onClick={() => setLancando(false)}>Cancelar</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-dark-400">
              Ainda sem resposta. Quando o cliente responder pelo link, aparece aqui{peca ? ' e o pedido vai sozinho para "Concluído"' : data.tipo === 'compressor' ? ' e o pedido vai sozinho para a carteira da Bruna e para "Concluído"' : ''}.
            </p>
            {podeEditar && (
              <Button size="sm" variant="secondary" onClick={() => setLancando(true)}>
                Lançar resposta (cliente respondeu por telefone)
              </Button>
            )}
          </div>
        )}
      </section>

      {/* 5. Concluir */}
      {peca && (
        <section className="p-4 rounded-xl border border-gold-600/40 bg-gold-900/10">
          <h3 className="text-sm font-semibold text-dark-100 mb-1">5. Concluir</h3>
          <p className="text-xs text-dark-400 mb-3">Quando o cliente responde, o pedido conclui sozinho. Se ele não responder, conclua aqui depois de enviar a pesquisa.</p>
          {podeEditar && (
            <Button size="sm" disabled={!p.enviadoEm} loading={concluirMut.isPending} onClick={() => concluirMut.mutate({ ordemId, acao: 'ok' })}>
              Concluir pedido
            </Button>
          )}
          {!p.enviadoEm && <p className="text-[11px] text-dark-500 mt-2">Envie a pesquisa primeiro (parte 3).</p>}
        </section>
      )}
      {!peca && (
      <section className="p-4 rounded-xl border border-gold-600/40 bg-gold-900/10">
        <h3 className="text-sm font-semibold text-dark-100 mb-1">5. Concluir</h3>
        {data.tipo !== 'acessorio' && (
          <p className="text-xs text-dark-300 mb-2">
            Revenda do pedido: <b className="text-dark-100">{data.revenda ?? 'nenhuma informada'}</b>
            {!data.revenda && <span className="text-dark-500"> — dá para informar na etapa de Faturamento/dados do pedido ou no cadastro do cliente.</span>}
          </p>
        )}
        {data.temAgendamento ? (
          <p className="text-sm text-green-400">✓ Já está na carteira da Bruna (Agendamentos).</p>
        ) : (
          <>
            <p className="text-xs text-dark-400 mb-3">
              {data.tipo === 'compressor' && 'Compressor: desce para a carteira da Bruna (coluna Agendamentos). Lá ela completa venda de peça, 1ª preventiva e lembrete, e segue com o agendamento.'}
              {data.tipo === 'acessorio' && 'Secador / trafo / reservatório / filtro / motocompressor: não tem venda de peça nem preventiva, então não vai para a Bruna. Dê o OK para concluir.'}
              {data.tipo === 'indefinido' && 'Este pedido não tem máquina cadastrada. Escolha: se for compressor, mande para a Bruna; se for secador, trafo, reservatório, filtro ou motocompressor, dê o OK.'}
            </p>
            {podeEditar && (
              <div className="flex flex-wrap gap-2">
                {data.tipo !== 'acessorio' && (
                  <Button size="sm" loading={concluirMut.isPending && concluirMut.variables?.acao === 'bruna'} onClick={() => concluirMut.mutate({ ordemId, acao: 'bruna' })}>
                    Enviar para a carteira da Bruna e concluir
                  </Button>
                )}
                {data.tipo !== 'compressor' && (
                  <Button size="sm" variant="secondary" loading={concluirMut.isPending && concluirMut.variables?.acao === 'ok'} onClick={() => concluirMut.mutate({ ordemId, acao: 'ok' })}>
                    OK — concluir sem agendamento
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </section>
      )}
    </div>
  )
}

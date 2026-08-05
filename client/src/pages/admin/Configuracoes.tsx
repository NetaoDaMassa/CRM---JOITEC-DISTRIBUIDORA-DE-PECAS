import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import { Input } from '../../components/ui/Input'
import Button from '../../components/ui/Button'

function IntegracaoGoTo() {
  const utils = trpc.useUtils()
  const { data: status, isLoading } = trpc.goto.status.useQuery()
  const { data: urlConexao } = trpc.goto.urlConexao.useQuery(undefined, { enabled: status?.conectado === false })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const resultado = params.get('goto')
    if (resultado === 'conectado') {
      toast.success('GoTo Connect conectado com sucesso!')
      utils.goto.status.invalidate()
      window.history.replaceState({}, '', window.location.pathname)
    } else if (resultado === 'erro') {
      toast.error('Falha ao conectar com a GoTo. Tente novamente.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const desconectarMut = trpc.goto.desconectar.useMutation({
    onSuccess() {
      toast.success('Desconectado da GoTo')
      utils.goto.status.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  if (isLoading) return null

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-dark-100">Integração GoTo Connect</h2>
      <p className="text-xs text-dark-400">
        Quando conectado, ligações feitas ou recebidas pelo telefone da GoTo são registradas automaticamente no
        histórico de contato do cliente correspondente.
      </p>
      {status?.conectado ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-green-400">Conectado como {status.email}</p>
          <Button variant="secondary" size="sm" loading={desconectarMut.isPending} onClick={() => desconectarMut.mutate()}>
            Desconectar
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          disabled={!urlConexao}
          onClick={() => {
            if (urlConexao) window.location.href = urlConexao.url
          }}
        >
          Conectar com a GoTo
        </Button>
      )}
    </div>
  )
}

export default function AdminConfiguracoes() {
  const { data, isLoading } = trpc.configuracoes.get.useQuery()
  const utils = trpc.useUtils()

  const [maxTentativas, setMaxTentativas] = useState('')
  const [bloqueioMinutos, setBloqueioMinutos] = useState('')
  const [metaFaturamentoPadrao, setMetaFaturamentoPadrao] = useState('')
  const [metaFaturamentoEmpresa, setMetaFaturamentoEmpresa] = useState('')
  const [metaLigacoesDiaPadrao, setMetaLigacoesDiaPadrao] = useState('')
  const [diasSemContatoAlerta, setDiasSemContatoAlerta] = useState('')
  const [backupRetencaoDias, setBackupRetencaoDias] = useState('')
  const [gotoDuracaoMinima, setGotoDuracaoMinima] = useState('')
  const [painelTvSegundosPorSlide, setPainelTvSegundosPorSlide] = useState('')
  const [expedienteInicio, setExpedienteInicio] = useState('08:00')
  const [expedienteFim, setExpedienteFim] = useState('17:48')
  const [almocoInicio, setAlmocoInicio] = useState('12:00')
  const [almocoFim, setAlmocoFim] = useState('13:00')
  const [carregado, setCarregado] = useState(false)

  function paraHHMM(hora: number, minuto: number): string {
    return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
  }

  function deHHMM(valor: string): [number, number] {
    const [h, m] = valor.split(':').map(Number)
    return [h || 0, m || 0]
  }

  useEffect(() => {
    if (data && !carregado) {
      setMaxTentativas(String(data.senha_max_tentativas_login))
      setBloqueioMinutos(String(data.senha_bloqueio_minutos))
      setMetaFaturamentoPadrao(String(data.meta_faturamento_padrao))
      setMetaFaturamentoEmpresa(String(data.meta_faturamento_empresa))
      setMetaLigacoesDiaPadrao(String(data.meta_ligacoes_dia_padrao))
      setDiasSemContatoAlerta(String(data.dias_sem_contato_alerta))
      setBackupRetencaoDias(String(data.backup_retencao_dias))
      setGotoDuracaoMinima(String(data.goto_duracao_minima_segundos))
      setPainelTvSegundosPorSlide(String(data.painel_tv_segundos_por_slide))
      setExpedienteInicio(paraHHMM(data.expediente_inicio_hora, data.expediente_inicio_minuto))
      setExpedienteFim(paraHHMM(data.expediente_fim_hora, data.expediente_fim_minuto))
      setAlmocoInicio(paraHHMM(data.expediente_almoco_inicio_hora, data.expediente_almoco_inicio_minuto))
      setAlmocoFim(paraHHMM(data.expediente_almoco_fim_hora, data.expediente_almoco_fim_minuto))
      setCarregado(true)
    }
  }, [data, carregado])

  const setMut = trpc.configuracoes.set.useMutation({
    onSuccess() {
      toast.success('Configurações salvas')
      utils.configuracoes.get.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const [inicioHora, inicioMinuto] = deHHMM(expedienteInicio)
    const [fimHora, fimMinuto] = deHHMM(expedienteFim)
    const [almocoInicioHora, almocoInicioMinuto] = deHHMM(almocoInicio)
    const [almocoFimHora, almocoFimMinuto] = deHHMM(almocoFim)
    setMut.mutate({
      senha_max_tentativas_login: Number(maxTentativas),
      senha_bloqueio_minutos: Number(bloqueioMinutos),
      meta_faturamento_padrao: Number(metaFaturamentoPadrao),
      meta_faturamento_empresa: Number(metaFaturamentoEmpresa),
      meta_ligacoes_dia_padrao: Number(metaLigacoesDiaPadrao),
      dias_sem_contato_alerta: Number(diasSemContatoAlerta),
      backup_retencao_dias: Number(backupRetencaoDias),
      goto_duracao_minima_segundos: Number(gotoDuracaoMinima),
      painel_tv_segundos_por_slide: Number(painelTvSegundosPorSlide),
      expediente_inicio_hora: inicioHora,
      expediente_inicio_minuto: inicioMinuto,
      expediente_fim_hora: fimHora,
      expediente_fim_minuto: fimMinuto,
      expediente_almoco_inicio_hora: almocoInicioHora,
      expediente_almoco_inicio_minuto: almocoInicioMinuto,
      expediente_almoco_fim_hora: almocoFimHora,
      expediente_almoco_fim_minuto: almocoFimMinuto,
    })
  }

  if (isLoading) return <div className="p-6 text-dark-400">Carregando...</div>

  return (
    <div className="p-6 max-w-lg space-y-4">
      <h1 className="font-heading text-xl text-dark-50">Configurações</h1>
      <form onSubmit={handleSubmit} className="space-y-4 bg-dark-800 border border-dark-600 rounded-2xl p-5">
        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Segurança de login</h2>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Máx. tentativas antes de bloquear"
              type="number"
              value={maxTentativas}
              onChange={(e) => setMaxTentativas(e.target.value)}
            />
            <Input
              label="Minutos de bloqueio"
              type="number"
              value={bloqueioMinutos}
              onChange={(e) => setBloqueioMinutos(e.target.value)}
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Meta geral da empresa</h2>
          <Input
            label="Meta de faturamento da empresa (R$/mês)"
            type="number"
            value={metaFaturamentoEmpresa}
            onChange={(e) => setMetaFaturamentoEmpresa(e.target.value)}
          />
          <p className="text-xs text-dark-500 mt-1.5">
            Soma de todos os vendedores. Aparece no Dashboard e no Painel de TV com o ritmo do dia, igual à meta
            individual.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Metas padrão (vendedor novo)</h2>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Meta de faturamento (R$/mês)"
              type="number"
              value={metaFaturamentoPadrao}
              onChange={(e) => setMetaFaturamentoPadrao(e.target.value)}
            />
            <Input
              label="Meta de ligações/dia"
              type="number"
              value={metaLigacoesDiaPadrao}
              onChange={(e) => setMetaLigacoesDiaPadrao(e.target.value)}
            />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Ligações automáticas (GoTo Connect)</h2>
          <Input
            label="Duração mínima pra considerar que pode ter atendido (segundos)"
            type="number"
            value={gotoDuracaoMinima}
            onChange={(e) => setGotoDuracaoMinima(e.target.value)}
          />
          <p className="text-xs text-dark-500 mt-1.5">
            Ligações mais curtas que isso são marcadas automaticamente como "Não respondeu" (não deu tempo de
            conversar). Ligações mais longas que isso sempre ficam pendentes, pedindo pro vendedor confirmar se
            falou com o cliente ou caiu na caixa postal — a duração sozinha não prova que teve conversa de verdade.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Notificações</h2>
          <Input
            label="Alertar cliente sem contato há quantos dias"
            type="number"
            value={diasSemContatoAlerta}
            onChange={(e) => setDiasSemContatoAlerta(e.target.value)}
          />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Horário de expediente (seg-sex)</h2>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Início do expediente" type="time" value={expedienteInicio} onChange={(e) => setExpedienteInicio(e.target.value)} />
            <Input label="Fim do expediente" type="time" value={expedienteFim} onChange={(e) => setExpedienteFim(e.target.value)} />
            <Input label="Início do almoço" type="time" value={almocoInicio} onChange={(e) => setAlmocoInicio(e.target.value)} />
            <Input label="Fim do almoço" type="time" value={almocoFim} onChange={(e) => setAlmocoFim(e.target.value)} />
          </div>
          <p className="text-xs text-dark-500 mt-1.5">Sábado e domingo não trabalham — fixo no sistema.</p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Painel de TV</h2>
          <Input
            label="Segundos por slide (carrossel automático)"
            type="number"
            min={3}
            value={painelTvSegundosPorSlide}
            onChange={(e) => setPainelTvSegundosPorSlide(e.target.value)}
          />
          <p className="text-xs text-dark-500 mt-1.5">Quanto tempo cada tela fica visível antes de trocar pra próxima, automaticamente.</p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-dark-100 mb-2">Backup</h2>
          <Input
            label="Manter backups por quantos dias"
            type="number"
            value={backupRetencaoDias}
            onChange={(e) => setBackupRetencaoDias(e.target.value)}
          />
        </div>

        <Button type="submit" loading={setMut.isPending}>
          Salvar
        </Button>
      </form>

      <IntegracaoGoTo />
    </div>
  )
}

type Agendamento = {
  id: number
  transportadora: string | null
  coletaAgendada: string
  registradoEm: string
  registradoPor: string | null
}

const agenda = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)} ${v.slice(11, 16)}`
const registrado = (utc: string) =>
  new Date(`${utc.replace(' ', 'T')}Z`).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

// Todas as tentativas de agendar a coleta do pedido: a transportadora nem
// sempre vem, e a equipe e o vendedor precisam ver quantas vezes foi marcado.
export default function HistoricoAgendamentos({ agendamentos }: { agendamentos: Agendamento[] }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="font-semibold text-dark-200">🚚 Agendamentos de coleta ({agendamentos.length})</p>
      <ol className="space-y-0.5">
        {agendamentos.map((a, i) => (
          <li key={a.id} className={i === agendamentos.length - 1 ? 'text-dark-100' : 'text-dark-400'}>
            <b>{i + 1}ª</b> · {agenda(a.coletaAgendada)}
            {a.transportadora ? ` · ${a.transportadora}` : ''}
            <span className="text-dark-500">
              {' '}
              — marcado em {registrado(a.registradoEm)}
              {a.registradoPor ? ` por ${a.registradoPor}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

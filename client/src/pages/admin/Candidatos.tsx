import { useSearchParams } from 'react-router-dom'
import { Contact, Paperclip, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import { trpc } from '../../lib/trpc'
import Select from '../../components/ui/Select'
import CandidateMessageMenu from '../../components/CandidateMessageMenu'
import { timeAgo } from '../../lib/utils'

const STATUS_OPTIONS = [
  { value: 'novo', label: 'Novo' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'entrevista', label: 'Entrevista' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'reprovado', label: 'Reprovado' },
]

const STATUS_COLORS: Record<string, string> = {
  novo: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  em_analise: 'bg-gold-600/20 text-gold-300 border-gold-500/30',
  entrevista: 'bg-purple-600/20 text-purple-300 border-purple-500/30',
  aprovado: 'bg-green-600/20 text-green-300 border-green-500/30',
  reprovado: 'bg-red-600/20 text-red-300 border-red-500/30',
}

// Candidatos que se aplicaram nas vagas (via API pública /api/careers) —
// portado do CRM-GRUPO-ODIN.
export default function AdminCandidatos() {
  const [searchParams, setSearchParams] = useSearchParams()
  const jobIdFilter = searchParams.get('jobId')

  const utils = trpc.useUtils()
  const { data: candidatos = [], isLoading } = trpc.candidatos.list.useQuery(undefined)
  const { data: vagas = [] } = trpc.vagas.list.useQuery()

  const updateStatusMut = trpc.candidatos.updateStatus.useMutation({
    onSuccess() {
      toast.success('Status atualizado')
      utils.candidatos.list.invalidate()
    },
    onError(err) {
      toast.error(err.message)
    },
  })

  const filtrados = jobIdFilter ? candidatos.filter((c: any) => String(c.jobPostingId) === jobIdFilter) : candidatos

  const vagaOptions = [{ value: '', label: 'Todas as vagas' }, ...vagas.map((v: any) => ({ value: String(v.id), label: v.title }))]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl text-gold-400 font-bold">Candidatos</h1>
          <p className="text-dark-400 text-sm mt-0.5">
            {filtrados.length} candidato{filtrados.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="w-64">
          <Select
            options={vagaOptions}
            value={jobIdFilter ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setSearchParams(v ? { jobId: v } : {})
            }}
          />
        </div>
      </div>

      <div className="bg-dark-800 border border-dark-600 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="text-dark-400 text-sm">Carregando...</div>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-center">
            <Contact size={36} className="text-dark-700" />
            <p className="text-dark-400 text-sm">Nenhum candidato ainda</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-600 bg-dark-900/40">
                <th className="text-left text-dark-400 font-medium px-5 py-3">Candidato</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Vaga</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Contato</th>
                <th className="text-left text-dark-400 font-medium px-5 py-3">Currículo</th>
                <th className="text-center text-dark-400 font-medium px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {filtrados.map((c: any) => (
                <tr key={c.id} className="hover:bg-dark-700/30 transition-colors align-top">
                  <td className="px-5 py-4">
                    <span className="font-medium text-dark-100">{c.name}</span>
                    <p className="text-xs text-dark-500">Candidatou-se {timeAgo(c.createdAt)}</p>
                    {c.message && <p className="text-xs text-dark-400 mt-1 max-w-xs">{c.message}</p>}
                  </td>
                  <td className="px-5 py-4 text-dark-300">{c.jobPosting?.title ?? '—'}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1.5 items-start">
                      <CandidateMessageMenu candidateName={c.name} jobTitle={c.jobPosting?.title ?? ''} phone={c.phone} />
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                          <Mail size={11} />
                          {c.email}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {c.resumeFilename ? (
                      <a
                        href={`/uploads/${c.resumeFilename}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-gold-400 hover:underline"
                      >
                        <Paperclip size={12} />
                        {c.resumeOriginalName ?? 'currículo'}
                      </a>
                    ) : (
                      <span className="text-dark-600 italic text-xs">Sem currículo</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <select
                      value={c.status}
                      onChange={(e) => updateStatusMut.mutate({ id: c.id, status: e.target.value as any })}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-transparent cursor-pointer ${STATUS_COLORS[c.status] ?? STATUS_COLORS.novo}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value} className="bg-dark-800 text-dark-100">
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

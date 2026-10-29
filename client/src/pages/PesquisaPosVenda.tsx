// Página pública da pesquisa de satisfação do Pós-venda (Odin Compressores)
// — o cliente abre pelo link que a equipe manda no WhatsApp, sem login.
// Tema claro de propósito (é a cara que o cliente vê, igual ao modelo que
// o João mandou), diferente do resto do sistema.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, FileText } from 'lucide-react'
import { trpc } from '../lib/trpc'
import FormPesquisa from '../components/posVenda/FormPesquisa'

export default function PesquisaPosVenda() {
  const { token = '' } = useParams()
  const { data, isLoading, error } = trpc.posVendaOdin.publicoObter.useQuery({ token }, { retry: false, enabled: token.length >= 10 })
  const [enviada, setEnviada] = useState(false)
  const responderMut = trpc.posVendaOdin.publicoResponder.useMutation({ onSuccess: () => setEnviada(true) })

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4" style={{ colorScheme: 'light' }}>
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-8">
        {isLoading && <p className="text-slate-500 text-sm">Carregando...</p>}
        {(error || (!isLoading && !data)) && (
          <p className="text-slate-600">Não encontramos essa pesquisa. Confira se o link está completo ou fale com a equipe da Odin.</p>
        )}
        {data && (data.respondida || enviada) && (
          <div className="text-center py-6">
            <CheckCircle2 size={48} className="mx-auto text-green-600 mb-3" />
            <h1 className="text-xl font-bold text-slate-900">Obrigado pela sua resposta!</h1>
            <p className="text-slate-600 mt-2">Sua opinião ajuda a {data.empresaNome} a melhorar sempre.</p>
            {responderMut.variables?.querContato && <p className="text-slate-600 mt-2">Nossa equipe vai entrar em contato com você.</p>}
          </div>
        )}
        {data && !data.respondida && !enviada && (
          <>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Sua experiência com a Odin</h1>
            <p className="text-slate-600 mt-1 mb-2">
              Queremos saber como foi sua experiência com {data.orderType === 'peca' ? 'nossas peças, a entrega' : 'nosso produto'} e atendimento. Sua opinião é importante para melhorarmos continuamente.
            </p>
            {(data.clienteNome || data.modelos.length > 0) && (
              <p className="text-sm text-slate-500 mb-4">
                {data.clienteNome}
                {data.modelos.length > 0 && ` · ${data.modelos.join(', ')}`}
              </p>
            )}
            {data.documentos.length > 0 && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800 mb-2">Guia do seu equipamento (cuidados, manutenção preventiva e garantia)</p>
                <div className="space-y-1.5">
                  {data.documentos.map((d, i) => (
                    <a key={`${i}-${d.url}`} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-700 hover:underline">
                      <FileText size={16} className="shrink-0" /> {d.titulo}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <FormPesquisa claro semTecnico={data.orderType === 'peca'} enviando={responderMut.isPending} rotuloBotao="Enviar resposta" onEnviar={(r) => responderMut.mutate({ token, ...r })} />
            {responderMut.error && <p className="text-sm text-red-600 mt-3">{responderMut.error.message}</p>}
          </>
        )}
      </div>
    </div>
  )
}

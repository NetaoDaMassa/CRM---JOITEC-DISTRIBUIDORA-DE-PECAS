// Conexões (só super admin): token da Meta, qual Instagram é de qual marca, importar o painel antigo.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import { cls, dataHora } from './comum'

type Marca = { empresaId: number; nome: string }

export default function AbaConexoes({ marcas }: { marcas: Marca[] }) {
  const utils = trpc.useUtils()
  const st = trpc.marketingModulo.conexoes.useQuery()
  const contas = trpc.marketingModulo.contasDisponiveis.useQuery(undefined, { enabled: !!st.data?.temToken, retry: false })
  const inv = () => { utils.marketingModulo.conexoes.invalidate(); utils.marketingModulo.marcas.invalidate(); utils.marketingModulo.contasDisponiveis.invalidate() }
  const salvarToken = trpc.marketingModulo.salvarToken.useMutation({ onSuccess: (r) => { toast.success(`Token salvo. ${r.contas.length} Instagram(s) encontrados.`); setToken(''); inv() }, onError: (e) => toast.error(e.message, { duration: 9000 }) })
  const vincular = trpc.marketingModulo.vincular.useMutation({ onSuccess: () => { toast.success('Instagram ligado. Clique em Atualizar agora no Radar para puxar os dados.'); inv() }, onError: (e) => toast.error(e.message, { duration: 9000 }) })
  const desvincular = trpc.marketingModulo.desvincular.useMutation({ onSuccess: inv })
  const sinc = trpc.marketingModulo.sincronizar.useMutation({ onSuccess: (r) => { toast.success(`${r.midias} posts, ${r.comentarios} comentários, ${r.conversas} conversas`); inv() }, onError: (e) => toast.error(e.message, { duration: 9000 }) })
  const importar = trpc.marketingModulo.importarPainel.useMutation({ onSuccess: (r) => { toast.success(`Importado: ${r.planosNovos} planos e ${r.pecasNovas} peças novas`); utils.marketingModulo.invalidate() }, onError: (e) => toast.error(e.message) })
  const [token, setToken] = useState('')

  const lerArquivo = async (f: File | undefined) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      if (!Array.isArray(j.planos) || !Array.isArray(j.pecas)) throw new Error('Arquivo não é a exportação do painel.')
      importar.mutate({ planos: j.planos, pecas: j.pecas })
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div><h2 className="text-2xl font-bold text-dark-100">Conexões</h2><p className="text-sm text-dark-400">Só o super admin vê esta aba.</p></div>

      <section className={cls.card + ' p-4 space-y-3'}>
        <h3 className="text-lg font-bold text-dark-100">1. Token da Meta</h3>
        <p className="text-sm text-dark-300">Um token de <b>Usuário do Sistema</b> do Gerenciador de Negócios da Meta, com acesso às Páginas e Instagrams das marcas. Permissões: instagram_basic, instagram_manage_insights, instagram_manage_comments, instagram_manage_messages, pages_show_list, pages_read_engagement, pages_manage_metadata, business_management.</p>
        <div className="text-sm">{st.data?.temToken ? <span className="text-green-400">✓ Token configurado</span> : <span className="text-orange-300">Nenhum token ainda</span>}</div>
        <div className="flex gap-2">
          <input type="password" className={cls.input} placeholder="Cole o token aqui (começa com EAA…)" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={() => salvarToken.mutate({ token })} loading={salvarToken.isPending} disabled={token.trim().length < 20}>Salvar e testar</Button>
        </div>
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <h3 className="text-lg font-bold text-dark-100">2. Qual Instagram é de qual marca</h3>
        {contas.error && <p className="text-sm text-red-400">{contas.error.message}</p>}
        {marcas.map((m) => {
          const ligada = st.data?.contas.find((c) => c.empresaId === m.empresaId)
          return (
            <div key={m.empresaId} className="flex flex-wrap items-center gap-3 py-2 border-b border-dark-700/50">
              <span className="w-56 font-semibold text-dark-100">{m.nome}</span>
              {ligada ? (
                <>
                  <span className="text-sm text-green-400">@{ligada.username}</span>
                  <span className="text-xs text-dark-400">{ligada.ultimoSync ? `atualizado ${dataHora(ligada.ultimoSync)}` : 'nunca atualizado'}</span>
                  {ligada.ultimoErro && <span className="text-xs text-orange-300 w-full">{ligada.ultimoErro}</span>}
                  <Button size="sm" variant="secondary" onClick={() => sinc.mutate({ empresaId: m.empresaId })} loading={sinc.isPending && sinc.variables?.empresaId === m.empresaId}>Atualizar agora</Button>
                  <Button size="sm" variant="ghost" onClick={() => desvincular.mutate({ empresaId: m.empresaId })}>Desligar</Button>
                </>
              ) : (
                <select className={cls.input + ' w-auto'} disabled={!contas.data?.length} defaultValue="" onChange={(e) => e.target.value && vincular.mutate({ empresaId: m.empresaId, pageId: e.target.value })}>
                  <option value="">{contas.data?.length ? 'Escolher o Instagram…' : st.data?.temToken ? 'Nenhum Instagram encontrado no token' : 'Cole o token primeiro'}</option>
                  {(contas.data || []).map((c) => <option key={c.pageId} value={c.pageId}>@{c.username} ({c.pageNome})</option>)}
                </select>
              )}
            </div>
          )
        })}
        <p className="text-xs text-dark-400">Depois de ligado, o CRM atualiza sozinho de hora em hora (posts, views, comentários, directs e concorrentes).</p>
      </section>

      <section className={cls.card + ' p-4 space-y-3'}>
        <h3 className="text-lg font-bold text-dark-100">3. Trazer os planos do painel do Claude</h3>
        <p className="text-sm text-dark-300">Escolha o arquivo <b>marketing-painel-export.json</b> (na pasta Documentos). Não apaga nada: só entra o que ainda não existe.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => lerArquivo(e.target.files?.[0])} className="text-sm text-dark-300" />
        {importar.isPending && <p className="text-sm text-dark-400">Importando…</p>}
      </section>
    </div>
  )
}

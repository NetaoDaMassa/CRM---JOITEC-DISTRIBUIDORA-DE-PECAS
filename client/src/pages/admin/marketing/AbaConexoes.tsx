// Conexões (só super admin): uma chave da Meta por marca (cada empresa tem o
// seu portfólio na Meta — João, 2026-11-21) e importar o painel antigo.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { trpc } from '../../../lib/trpc'
import Button from '../../../components/ui/Button'
import { cls, dataHora } from './comum'

type Marca = { empresaId: number; nome: string }

function LinhaMarca({ m, temToken, ligada }: { m: Marca; temToken: boolean; ligada?: { username: string | null; ultimoSync: string | null; ultimoErro: string | null } }) {
  const utils = trpc.useUtils()
  const inv = () => { utils.marketingModulo.conexoes.invalidate(); utils.marketingModulo.marcas.invalidate(); utils.marketingModulo.contasDisponiveis.invalidate() }
  const [token, setToken] = useState('')
  const [trocar, setTrocar] = useState(false)
  const contas = trpc.marketingModulo.contasDisponiveis.useQuery({ empresaId: m.empresaId }, { enabled: temToken && !ligada, retry: false })
  const salvar = trpc.marketingModulo.salvarToken.useMutation({
    onSuccess: (r) => { setToken(''); setTrocar(false); inv(); toast.success(r.ligada ? `Chave salva e @${r.ligada} ligado!` : r.contas.length ? `Chave salva. Escolha qual Instagram é da ${m.nome}.` : 'Chave salva, mas ela não enxerga nenhum Instagram. Confira se a Página e o Instagram foram dados ao usuário do sistema.', { duration: 8000 }) },
    onError: (e) => toast.error(e.message, { duration: 10000 }),
  })
  const vincular = trpc.marketingModulo.vincular.useMutation({ onSuccess: () => { toast.success('Instagram ligado.'); inv() }, onError: (e) => toast.error(e.message, { duration: 9000 }) })
  const desvincular = trpc.marketingModulo.desvincular.useMutation({ onSuccess: inv })
  const sinc = trpc.marketingModulo.sincronizar.useMutation({ onSuccess: (r) => { toast.success(`${r.midias} posts, ${r.comentarios} comentários, ${r.conversas} conversas${r.avisos.length ? ' (com avisos)' : ''}`); inv() }, onError: (e) => toast.error(e.message, { duration: 10000 }) })

  return (
    <div className="py-3 border-b border-dark-700/50 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-56 font-semibold text-dark-100">{m.nome}</span>
        <span className={`text-xs ${temToken ? 'text-green-400' : 'text-dark-500'}`}>{temToken ? '✓ chave salva' : 'sem chave'}</span>
        {ligada && <span className="text-sm text-green-400">@{ligada.username}</span>}
        {ligada && <span className="text-xs text-dark-400">{ligada.ultimoSync ? `atualizado ${dataHora(ligada.ultimoSync)}` : 'nunca atualizado'}</span>}
        {ligada && <Button size="sm" variant="secondary" onClick={() => sinc.mutate({ empresaId: m.empresaId })} loading={sinc.isPending}>Atualizar agora</Button>}
        {ligada && <Button size="sm" variant="ghost" onClick={() => desvincular.mutate({ empresaId: m.empresaId })}>Desligar Instagram</Button>}
        {temToken && !trocar && <Button size="sm" variant="ghost" onClick={() => setTrocar(true)}>Trocar chave</Button>}
      </div>
      {ligada?.ultimoErro && <div className="text-xs text-orange-300">{ligada.ultimoErro}</div>}
      {(!temToken || trocar) && (
        <div className="flex gap-2">
          <input type="password" className={cls.input} placeholder={`Cole a chave da ${m.nome} (começa com EAA…)`} value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={() => salvar.mutate({ empresaId: m.empresaId, token })} loading={salvar.isPending} disabled={token.trim().length < 20}>Salvar e testar</Button>
        </div>
      )}
      {temToken && !ligada && (
        contas.error ? <div className="text-sm text-red-400">{contas.error.message}</div> : (
          <select className={cls.input + ' w-auto'} defaultValue="" disabled={!contas.data?.length} onChange={(e) => e.target.value && vincular.mutate({ empresaId: m.empresaId, pageId: e.target.value })}>
            <option value="">{contas.isLoading ? 'Procurando Instagrams…' : contas.data?.length ? 'Escolher o Instagram…' : 'A chave não enxerga nenhum Instagram'}</option>
            {(contas.data || []).map((c) => <option key={c.pageId} value={c.pageId}>@{c.username} ({c.pageNome})</option>)}
          </select>
        )
      )}
    </div>
  )
}

export default function AbaConexoes({ marcas }: { marcas: Marca[] }) {
  const utils = trpc.useUtils()
  const st = trpc.marketingModulo.conexoes.useQuery()
  const importar = trpc.marketingModulo.importarPainel.useMutation({ onSuccess: (r) => { toast.success(`Importado: ${r.planosNovos} planos e ${r.pecasNovas} peças novas`); utils.marketingModulo.invalidate() }, onError: (e) => toast.error(e.message) })
  const lerArquivo = async (f: File | undefined) => {
    if (!f) return
    try {
      const j = JSON.parse(await f.text())
      if (!Array.isArray(j.planos) || !Array.isArray(j.pecas)) throw new Error('Arquivo não é a exportação do painel.')
      importar.mutate({ planos: j.planos, pecas: j.pecas })
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="space-y-6 max-w-5xl">
      <div><h2 className="text-2xl font-bold text-dark-100">Conexões</h2><p className="text-sm text-dark-400">Só o super admin vê esta aba.</p></div>
      <section className={cls.card + ' p-4 space-y-2'}>
        <h3 className="text-lg font-bold text-dark-100">Instagram de cada marca</h3>
        <p className="text-sm text-dark-300">Uma chave por empresa, gerada no portfólio dela na Meta (Usuário do sistema). Ao salvar, o CRM testa e, se achar um Instagram só, já liga sozinho. Depois atualiza de hora em hora: posts, views, comentários, directs e concorrentes.</p>
        {marcas.map((m) => <LinhaMarca key={m.empresaId} m={m} temToken={!!st.data?.tokens?.[m.empresaId]} ligada={st.data?.contas.find((c) => c.empresaId === m.empresaId)} />)}
      </section>
      <SecaoMlabs />
      <section className={cls.card + ' p-4 space-y-3'}>
        <h3 className="text-lg font-bold text-dark-100">Trazer os planos do painel do Claude</h3>
        <p className="text-sm text-dark-300">Escolha o arquivo <b>marketing-painel-export.json</b> (na pasta Documentos). Não apaga nada: só entra o que ainda não existe.</p>
        <input type="file" accept="application/json,.json" onChange={(e) => lerArquivo(e.target.files?.[0])} className="text-sm text-dark-300" />
        {importar.isPending && <p className="text-sm text-dark-400">Importando…</p>}
      </section>
    </div>
  )
}

// mLabs: o robô do Claude manda os números de todas as redes 1x por dia.
// Aqui dá para colar o pacote à mão (mesmo formato) se precisar.
function SecaoMlabs() {
  const utils = trpc.useUtils()
  const [json, setJson] = useState('')
  const imp = trpc.marketingModulo.importarMlabs.useMutation({
    onSuccess: (r) => { setJson(''); utils.marketingModulo.redesEmpresa.invalidate(); toast.success(`Importado: ${r.map((x) => `${x.posts} publicações`).join(', ')}`) },
    onError: (e) => toast.error(e.message, { duration: 10000 }),
  })
  return (
    <section className={cls.card + ' p-4 space-y-2'}>
      <h3 className="text-lg font-bold text-dark-100">Todas as redes (mLabs)</h3>
      <p className="text-sm text-dark-300">Facebook, TikTok, YouTube, LinkedIn, Pinterest, Google e Threads chegam da mLabs 1 vez por dia, por um robô do Claude, e aparecem na aba <b>Empresa</b>. A Odin Automação não está na mLabs.</p>
      <details className="text-sm text-dark-400">
        <summary className="cursor-pointer">Colar um pacote da mLabs à mão</summary>
        <textarea rows={4} className={cls.input + ' font-mono text-xs mt-2'} value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"empresaId": 6, "periodo": {...}, "redes": [...], "posts": [...]}' />
        <Button size="sm" className="mt-2" disabled={!json.trim()} loading={imp.isPending} onClick={() => imp.mutate({ json })}>Importar</Button>
      </details>
    </section>
  )
}

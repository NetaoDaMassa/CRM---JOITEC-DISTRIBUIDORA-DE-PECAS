import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { trpc } from '../lib/trpc'
import { useAuth } from '../contexts/AuthContext'
import { useMenuAtual } from '../lib/menuAtual'
import { AvatarIniciais } from './ui/Visual'

// Busca rápida (design novo, teste): Ctrl+K (ou ⌘K no Mac) abre uma caixa
// pra digitar o nome de um cliente ou de uma tela e ir direto.

function normalizar(t: string) {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

type Resultado = { chave: string; titulo: string; subtitulo?: string; tipo: 'tela' | 'cliente'; ir: () => void; icone: React.ReactNode }

export function BotaoBuscaRapida() {
  const ehMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('abrir-busca-rapida'))}
      className="hidden sm:flex items-center gap-2 h-9 pl-3 pr-2 rounded-xl border border-dark-600 bg-dark-800 text-sm text-dark-400 hover:text-dark-200 hover:border-dark-500 transition-colors min-w-[220px]"
    >
      <Search size={15} />
      <span className="flex-1 text-left">Buscar cliente ou tela…</span>
      <kbd className="text-[10px] font-semibold text-dark-400 bg-dark-700 rounded px-1.5 py-0.5">{ehMac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  )
}

export default function BuscaRapida() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const menu = useMenuAtual()
  const [aberta, setAberta] = useState(false)
  const [texto, setTexto] = useState('')
  const [ativo, setAtivo] = useState(0)
  const [busca, setBusca] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAberta((a) => !a)
      }
    }
    const abrir = () => setAberta(true)
    window.addEventListener('keydown', tecla)
    window.addEventListener('abrir-busca-rapida', abrir)
    return () => {
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('abrir-busca-rapida', abrir)
    }
  }, [])

  useEffect(() => {
    if (aberta) {
      setTexto('')
      setBusca('')
      setAtivo(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [aberta])

  // Espera a pessoa parar de digitar antes de buscar cliente no servidor.
  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 220)
    return () => clearTimeout(t)
  }, [texto])

  const { data: clientesAchados, isFetching } = trpc.clientes.list.useQuery(
    { q: busca, pagina: 1 },
    { enabled: aberta && busca.length >= 2 && user?.role !== 'gestor' }
  )

  const basePath = user?.role === 'admin' ? '/admin' : '/vendedor'
  const resultados: Resultado[] = useMemo(() => {
    const q = normalizar(texto.trim())
    const telas = menu
      .filter((m) => !q || normalizar(`${m.label} ${m.grupo ?? ''}`).includes(q))
      .slice(0, q ? 8 : 6)
      .map((m) => {
        const Icone = m.icon
        return {
          chave: `tela-${m.to}`,
          titulo: m.label,
          subtitulo: m.grupo ?? 'Tela',
          tipo: 'tela' as const,
          icone: (
            <span className="w-8 h-8 rounded-lg bg-dark-700 text-dark-200 flex items-center justify-center">
              <Icone size={16} />
            </span>
          ),
          ir: () => (m.external ? window.open(m.to, '_blank') : navigate(m.to)),
        }
      })
    const clientes =
      busca.length >= 2
        ? (clientesAchados?.items ?? []).slice(0, 8).map((c) => ({
            chave: `cliente-${c.id}`,
            titulo: c.razaoSocial,
            subtitulo: [c.codigo, c.cidade, c.vendedorAtual?.name].filter(Boolean).join(' · '),
            tipo: 'cliente' as const,
            icone: <AvatarIniciais nome={c.razaoSocial} tamanho={32} />,
            ir: () => navigate(`${basePath}/clientes/${c.id}`),
          }))
        : []
    return [...clientes, ...telas]
  }, [texto, busca, menu, clientesAchados, basePath, navigate])

  useEffect(() => setAtivo(0), [resultados.length])

  if (!aberta || !user) return null

  const escolher = (r: Resultado | undefined) => {
    if (!r) return
    setAberta(false)
    r.ir()
  }

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-start justify-center p-4 pt-[12vh] bg-black/50 backdrop-blur-sm" onMouseDown={() => setAberta(false)}>
      <div
        className="w-full max-w-xl rounded-2xl border border-dark-600 bg-dark-800 shadow-2xl shadow-black/50 overflow-hidden animate-[popup-pop-in_180ms_ease-out]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-dark-700">
          <Search size={18} className="text-dark-400" />
          <input
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAtivo((a) => Math.min(resultados.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAtivo((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                escolher(resultados[ativo])
              } else if (e.key === 'Escape') {
                setAberta(false)
              }
            }}
            placeholder="Digite o nome do cliente, código ou uma tela…"
            className="flex-1 h-14 bg-transparent text-dark-50 placeholder:text-dark-500 outline-none text-[15px]"
          />
          {isFetching && <span className="w-4 h-4 rounded-full border-2 border-dark-500 border-t-gold-400 animate-spin" />}
          <kbd className="text-[10px] text-dark-400 bg-dark-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {!resultados.length && <p className="px-3 py-6 text-center text-sm text-dark-500">Nada encontrado para “{texto}”.</p>}
          {resultados.map((r, i) => {
            const primeiroDoTipo = i === 0 || resultados[i - 1].tipo !== r.tipo
            return (
              <div key={r.chave}>
                {primeiroDoTipo && (
                  <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-dark-500">{r.tipo === 'cliente' ? 'Clientes' : 'Telas'}</p>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(r)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${i === ativo ? 'bg-gold-500/15' : 'hover:bg-dark-700/60'}`}
                >
                  {r.icone}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-dark-50 truncate">{r.titulo}</span>
                    {r.subtitulo && <span className="block text-[11px] text-dark-400 truncate">{r.subtitulo}</span>}
                  </span>
                  {i === ativo && <CornerDownLeft size={14} className="text-dark-400" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-dark-700 text-[11px] text-dark-500">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc fechar</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

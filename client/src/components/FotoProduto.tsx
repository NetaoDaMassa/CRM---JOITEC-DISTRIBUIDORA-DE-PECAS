import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  Package,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FolderOpen,
  Upload,
  Search,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import Modal from "./ui/Modal";

// Foto do produto (item_fotos, server/src/lib/fotosProdutos.ts) — usada na
// conferência da Expedição e nas cotações (pedido do João, 2026-11-11: o
// conferente vê a foto e amplia). Clique na miniatura abre em tela cheia com
// zoom (rodinha do mouse, pinça no celular, duplo clique, botões) e arrastar.
// Quem pode trocar (admin com Cotações ou Controle do Estoque) escolhe uma
// foto das pastas de produtos do Arquivos/Mídia ou envia outra.

export function FotoProduto({
  codigo,
  nome,
  foto,
  ilustrativa = false,
  tamanho = "h-12 w-12",
}: {
  codigo: string | null;
  nome: string;
  foto: string | null;
  ilustrativa?: boolean;
  tamanho?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [foto]);
  const url = foto && !falhou ? foto : null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => (e.stopPropagation(), setAberta(true))}
        title={
          url
            ? ilustrativa
              ? "Ver foto (ilustrativa do tipo de peça)"
              : "Ver foto"
            : "Sem foto"
        }
        className={`${tamanho} relative shrink-0 overflow-hidden rounded-lg bg-white/95 ring-1 ring-dark-600 flex items-center justify-center hover:ring-gold-500`}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain"
            onError={() => setFalhou(true)}
          />
        ) : (
          <Package className="h-5 w-5 text-dark-500" />
        )}
        {url && ilustrativa && (
          <span className="absolute bottom-0 inset-x-0 bg-amber-500/90 text-[8px] font-bold leading-tight text-black">
            ILUSTR.
          </span>
        )}
      </button>
      {aberta && (
        <VisualizadorFoto
          codigo={codigo}
          nome={nome}
          foto={url}
          ilustrativa={ilustrativa}
          onFechar={() => setAberta(false)}
        />
      )}
    </>
  );
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const limitar = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function VisualizadorFoto({
  codigo,
  nome,
  foto,
  ilustrativa,
  onFechar,
}: {
  codigo: string | null;
  nome: string;
  foto: string | null;
  ilustrativa: boolean;
  onFechar: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [escolhendo, setEscolhendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const utils = trpc.useUtils();
  const { data: podeTrocar } = trpc.fotosProdutos.podeTrocar.useQuery(
    undefined,
    { enabled: !!codigo, staleTime: 10 * 60_000 },
  );
  const ponteiros = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) =>
      e.key === "Escape" && !escolhendo && onFechar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar, escolhendo]);

  const mudarZoom = (z: number) => {
    const novo = limitar(z);
    setZoom(novo);
    if (novo === 1) setPos({ x: 0, y: 0 });
  };

  const atualizarTelas = () => {
    utils.cotacoesCrm.catalogo.invalidate();
    utils.expedicao.detalhe.invalidate();
    utils.historicoSap.cotacoesDoCliente.invalidate();
  };

  const enviar = async (arquivo: File) => {
    if (!codigo) return;
    setEnviando(true);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const r = await fetch(
        `/upload/foto-produto/${encodeURIComponent(codigo)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("odin_token")}`,
          },
          body: form,
        },
      );
      if (!r.ok)
        throw new Error(
          (await r.json().catch(() => null))?.error ?? `erro ${r.status}`,
        );
      toast.success("Foto trocada");
      atualizarTelas();
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return createPortal(
    // stopPropagation: o portal ainda borbulha eventos pela árvore do React
    // (ex.: linha clicável da tabela que abriu a foto).
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-neutral-950"
      role="dialog"
      aria-label={nome}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight break-words">
            {nome}
          </p>
          <p className="text-xs text-white/60 font-mono">
            {codigo}
            {ilustrativa && foto && (
              <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 font-sans text-[10px] font-bold text-black">
                FOTO ILUSTRATIVA DO TIPO DE PEÇA — confira a medida pelo código
              </span>
            )}
          </p>
        </div>
        {foto && (
          <div className="flex items-center gap-1">
            <BotaoIcone
              rotulo="Diminuir"
              onClick={() => mudarZoom(zoom / 1.5)}
              disabled={zoom <= ZOOM_MIN}
            >
              <ZoomOut size={18} />
            </BotaoIcone>
            <span className="w-12 text-center text-xs tabular-nums text-white/70">
              {Math.round(zoom * 100)}%
            </span>
            <BotaoIcone
              rotulo="Aumentar"
              onClick={() => mudarZoom(zoom * 1.5)}
              disabled={zoom >= ZOOM_MAX}
            >
              <ZoomIn size={18} />
            </BotaoIcone>
            <BotaoIcone
              rotulo="Tamanho normal"
              onClick={() => mudarZoom(1)}
              disabled={zoom === 1}
            >
              <Maximize2 size={16} />
            </BotaoIcone>
          </div>
        )}
        <BotaoIcone rotulo="Fechar" onClick={onFechar}>
          <X size={20} />
        </BotaoIcone>
      </div>

      <div
        className="relative flex-1 overflow-hidden select-none"
        style={{
          touchAction: "none",
          cursor: foto ? (zoom > 1 ? "grab" : "zoom-in") : "default",
        }}
        onClick={(e) =>
          e.target === e.currentTarget && zoom === 1 && onFechar()
        }
        onWheel={(e) =>
          foto && mudarZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))
        }
        onDoubleClick={() => foto && mudarZoom(zoom > 1 ? 1 : 2.5)}
        onPointerDown={(e) => {
          if (!foto) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (ponteiros.current.size === 2) {
            const [a, b] = [...ponteiros.current.values()];
            pinca.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
          }
        }}
        onPointerMove={(e) => {
          const antes = ponteiros.current.get(e.pointerId);
          if (!antes) return;
          ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (ponteiros.current.size === 2 && pinca.current) {
            const [a, b] = [...ponteiros.current.values()];
            mudarZoom(
              pinca.current.zoom *
                (Math.hypot(a.x - b.x, a.y - b.y) / pinca.current.dist),
            );
          } else if (zoom > 1) {
            setPos((p) => ({
              x: p.x + e.clientX - antes.x,
              y: p.y + e.clientY - antes.y,
            }));
          }
        }}
        onPointerUp={(e) => {
          ponteiros.current.delete(e.pointerId);
          if (ponteiros.current.size < 2) pinca.current = null;
        }}
        onPointerCancel={(e) => {
          ponteiros.current.delete(e.pointerId);
          pinca.current = null;
        }}
      >
        {foto ? (
          <img
            src={foto}
            alt={nome}
            draggable={false}
            className="pointer-events-none absolute inset-2 m-auto h-[calc(100%-1rem)] w-[calc(100%-1rem)] max-w-5xl rounded-lg bg-white object-contain sm:inset-4 sm:h-[calc(100%-2rem)] sm:w-[calc(100%-2rem)]"
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              transition: ponteiros.current.size
                ? "none"
                : "transform 120ms ease-out",
            }}
          />
        ) : (
          <p className="absolute inset-0 m-auto h-fit text-center text-sm text-white/60">
            Este item ainda não tem foto.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-white/60">
        {foto && (
          <span className="hidden sm:inline">
            Rodinha do mouse ou pinça para ampliar · arraste para mover · duplo
            clique alterna
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {podeTrocar && codigo && (
            <>
              <button
                type="button"
                onClick={() => setEscolhendo(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-2 text-sm text-white hover:bg-white/10"
              >
                <FolderOpen size={15} /> Escolher da pasta de produtos
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/25 px-3 py-2 text-sm text-white hover:bg-white/10">
                <Upload size={15} />{" "}
                {enviando
                  ? "Enviando…"
                  : foto
                    ? "Enviar outra foto"
                    : "Enviar foto"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={enviando}
                  onChange={(e) =>
                    e.target.files?.[0] && enviar(e.target.files[0])
                  }
                />
              </label>
            </>
          )}
        </div>
      </div>

      {escolhendo && codigo && (
        <EscolherFoto
          codigo={codigo}
          nome={nome}
          onFechar={() => setEscolhendo(false)}
          onEscolhida={() => {
            atualizarTelas();
            onFechar();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function BotaoIcone({
  rotulo,
  onClick,
  disabled,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-2 text-white hover:bg-white/10 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// Grade com as fotos das pastas de produtos; já vem filtrada pelas palavras
// do nome do item (dá pra apagar e buscar outra coisa).
function EscolherFoto({
  codigo,
  nome,
  onFechar,
  onEscolhida,
}: {
  codigo: string;
  nome: string;
  onFechar: () => void;
  onEscolhida: () => void;
}) {
  const { data, isLoading } = trpc.fotosProdutos.opcoes.useQuery();
  const [busca, setBusca] = useState(() =>
    nome
      .split(/\s+-\s+/)[0]
      .split(/\s+/)
      .slice(0, 1)
      .join(" "),
  );
  const escolher = trpc.fotosProdutos.escolher.useMutation({
    onSuccess: () => (toast.success("Foto ligada ao item"), onEscolhida()),
    onError: (e) => toast.error(e.message),
  });
  const semAcento = (t: string) =>
    t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const lista = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    return (data ?? []).filter((a) => {
      const texto = semAcento(`${a.empresa} ${a.caminho} ${a.nome}`);
      return termos.every((t) => texto.includes(t));
    });
  }, [data, busca]);
  return (
    <Modal open onClose={onFechar} title={`Foto para ${codigo}`} size="xl">
      <div className="space-y-3">
        <p className="text-xs text-dark-400">{nome}</p>
        <div className="relative">
          <Search
            size={15}
            className="absolute left-2.5 top-2.5 text-dark-500"
          />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo nome da foto ou da pasta"
            className="w-full rounded-lg border border-dark-600 bg-dark-900 py-2 pl-8 pr-3 text-sm text-dark-100"
          />
        </div>
        {isLoading ? (
          <p className="text-sm text-dark-400">Carregando fotos…</p>
        ) : !lista.length ? (
          <p className="text-sm text-dark-400">
            Nenhuma foto encontrada{busca ? " com essa busca" : ""}. Pastas
            usadas: Catálogo (Joitec), PRODUTOS (Odin Tubos) e PEÇAS AUTOMAÇÃO
            PNEUMÁTICA (Odin Automação), no Arquivos/Mídia.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
            {lista.slice(0, 200).map((a) => (
              <button
                key={a.arquivoId}
                type="button"
                disabled={escolher.isPending}
                onClick={() =>
                  escolher.mutate({
                    itemCodigo: codigo,
                    arquivoId: a.arquivoId,
                  })
                }
                className="rounded-lg border border-dark-600 bg-dark-900 p-1.5 text-left hover:border-gold-500"
              >
                <div className="aspect-square overflow-hidden rounded bg-white">
                  <img
                    src={a.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                </div>
                <p
                  className="mt-1 truncate text-[11px] text-dark-200"
                  title={a.nome}
                >
                  {a.nome}
                </p>
                <p
                  className="truncate text-[10px] text-dark-500"
                  title={`${a.empresa} · ${a.caminho}`}
                >
                  {a.empresa} · {a.caminho}
                </p>
              </button>
            ))}
          </div>
        )}
        {lista.length > 200 && (
          <p className="text-[11px] text-dark-500">
            Mostrando 200 de {lista.length}. Refine a busca.
          </p>
        )}
      </div>
    </Modal>
  );
}

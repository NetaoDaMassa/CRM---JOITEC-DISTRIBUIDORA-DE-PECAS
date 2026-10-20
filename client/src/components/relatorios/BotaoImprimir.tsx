import { FileText } from 'lucide-react'

// "Exportar PDF" das telas de relatório que não passam pela tela de
// exportação (Marketing, Odin, Devolução, Cartão): imprime a própria tela —
// o CSS de impressão (index.css) já tira o menu e deixa a folha clara.
export default function BotaoImprimir({ nomeArquivo }: { nomeArquivo: string }) {
  function imprimir() {
    const tituloAntes = document.title
    // O Chrome usa o título da página como nome do PDF.
    document.title = `${nomeArquivo}-${new Date().toISOString().slice(0, 10)}`
    const restaurar = () => {
      document.title = tituloAntes
      window.removeEventListener('afterprint', restaurar)
    }
    window.addEventListener('afterprint', restaurar)
    window.print()
  }
  return (
    <button
      type="button"
      onClick={imprimir}
      className="h-9 px-3.5 rounded-lg border border-dark-600 bg-dark-800 text-sm font-medium text-dark-100 hover:border-gold-500 hover:text-gold-400 flex items-center gap-1.5 transition-colors print:hidden"
    >
      <FileText size={15} /> Exportar PDF
    </button>
  )
}

import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { baseRelatorios } from './catalogo'

// Botão "Exportar" do topo de cada relatório — abre a tela de exportação já
// com este relatório marcado e os mesmos filtros (ficam na sessão).
export default function BotaoExportar({ relatorio }: { relatorio: string }) {
  const { user } = useAuth()
  return (
    <Link
      to={`${baseRelatorios(user?.role)}/exportar?r=${relatorio}`}
      className="h-9 px-3.5 rounded-lg border border-dark-600 bg-dark-800 text-sm font-medium text-dark-100 hover:border-gold-500 hover:text-gold-400 flex items-center gap-1.5 transition-colors print:hidden"
    >
      <Download size={15} /> Exportar PDF / Excel
    </Link>
  )
}

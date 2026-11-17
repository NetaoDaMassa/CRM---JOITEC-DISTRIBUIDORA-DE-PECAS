// Monta a biblioteca de páginas das propostas da Odin Compressores a partir
// da pasta com os PowerPoints modelo (ver lib/propostaModelo/biblioteca.ts).
//   npx tsx src/scripts/montarBibliotecaPropostas.ts <pasta-pptx> <pasta-saida> [datas.json]
// datas.json (opcional): { "arquivo.pptx": "aaaa-mm-dd hh:mm" } — quando a
// mesma ficha está em dois arquivos, vale a do mais novo. Sem ele, usa a
// data de modificação do arquivo.
import fs from 'fs'
import path from 'path'
import { lerZip, escreverZip } from '../lib/propostaModelo/zip.js'
import { montarBiblioteca } from '../lib/propostaModelo/biblioteca.js'

const [entrada, saida, datasArq] = process.argv.slice(2)
if (!entrada || !saida) {
  console.error('uso: montarBibliotecaPropostas.ts <pasta-pptx> <pasta-saida> [datas.json]')
  process.exit(1)
}
const datas: Record<string, string> = datasArq ? JSON.parse(fs.readFileSync(datasArq, 'utf8')) : {}
const modelos = fs
  .readdirSync(entrada)
  .filter((n) => n.toLowerCase().endsWith('.pptx') && !n.startsWith('~$'))
  .map((nome) => {
    const p = path.join(entrada, nome)
    return { nome, data: datas[nome] ?? fs.statSync(p).mtime.toISOString(), arquivos: lerZip(fs.readFileSync(p)) }
  })
const base = modelos.find((m) => m.nome.startsWith('Proposta Comercial Modelo'))!.nome
const { pptx, catalogo } = montarBiblioteca(modelos, base)
fs.mkdirSync(saida, { recursive: true })
fs.writeFileSync(path.join(saida, 'biblioteca.pptx'), escreverZip(pptx))
fs.writeFileSync(path.join(saida, 'catalogo.json'), JSON.stringify(catalogo, null, 1))
console.log(`${modelos.length} modelos → ${catalogo.conjuntos.length} conjuntos, ${catalogo.fichas.length} fichas, ${Object.keys(catalogo.intros).length} apresentações de linha`)
console.log('condições:', catalogo.condicoes, 'garantia:', catalogo.garantia)

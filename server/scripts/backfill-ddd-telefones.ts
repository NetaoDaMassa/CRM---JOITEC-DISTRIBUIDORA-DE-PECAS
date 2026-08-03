// Script avulso — grande parte dos telefones foi importada sem DDD (só o
// número local, ex: "88211507"). Não tem como recuperar o DDD certo de
// nenhuma planilha (nunca foi digitado em lugar nenhum), então infere pelo
// município/estado do cliente: uma tabela curada de cidade->DDD (cobre as
// cidades mais frequentes na carteira) + fallback por estado só quando o
// estado inteiro tem um único DDD possível. Casos que não batem em nenhuma
// das duas listas ficam intocados e saem no relatório final pra revisão manual.
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../src/db/client.js'
import { clientes } from '../src/db/schema.js'

// Estados com um único DDD — pode aplicar direto, independente da cidade.
const DDD_UNICO_POR_ESTADO: Record<string, string> = {
  AC: '68', AL: '82', AP: '96', DF: '61', MS: '67',
  PB: '83', RN: '84', RO: '69', RR: '95', SE: '79', TO: '63',
}

// Cidade (normalizada: maiúsculo, sem acento) -> DDD. Cobre as cidades mais
// frequentes na carteira em estados com mais de um DDD.
const DDD_POR_CIDADE: Record<string, string> = {
  // SC
  JOINVILLE: '47', ARAQUARI: '47', 'SAO FRANCISCO DO SUL': '47', 'JARAGUA DO SUL': '47',
  BLUMENAU: '47', CHAPECO: '49', GUARAMIRIM: '47', ITAJAI: '47', 'BARRA VELHA': '47',
  GARUVA: '47', 'SAO JOSE': '48', CRICIUMA: '48', FLORIANOPOLIS: '48', BRUSQUE: '47',
  ITAPOA: '47', TIMBO: '47', PALHOCA: '48', 'SAO BENTO DO SUL': '47', TUBARAO: '48',
  NAVEGANTES: '47', 'BALNEARIO BARRA DO SUL': '47', TIJUCAS: '48', XANXERE: '49',
  'RIO DO SUL': '47', VIDEIRA: '49', POMERODE: '47', INDAIAL: '47', MASSARANDUBA: '47',
  GASPAR: '47', LAGES: '49', CONCORDIA: '49', ITAPEMA: '47', ICARA: '48',
  'BALNEARIO PICARRAS': '47', CORUPA: '47', 'BALNEARIO CAMBORIU': '47', CACADOR: '49',
  ARARANGUA: '48', BIGUACU: '48', CANOINHAS: '47', SCHROEDER: '47', 'CAMPOS NOVOS': '49',
  PENHA: '47', 'SAO JOAO BATISTA': '48',
  // SP
  'SAO PAULO': '11', 'RIBEIRAO PRETO': '16', GUARULHOS: '11', CAMPINAS: '19',
  SOROCABA: '15', BIRIGUI: '18', 'SAO BERNARDO DO CAMPO': '11', 'SAO JOSE DO RIO PRETO': '17',
  'SAO JOSE DOS CAMPOS': '12', PIRACICABA: '19', ARARAQUARA: '16', FRANCA: '16',
  'SANTO ANDRE': '11', JAU: '14', BAURU: '14', DIADEMA: '11', JUNDIAI: '11',
  'PRESIDENTE PRUDENTE': '18', OURINHOS: '14', AMERICANA: '19', ATIBAIA: '11',
  'SAO CARLOS': '16', VALINHOS: '19', ARACATUBA: '18', CARAPICUIBA: '11', OSASCO: '11',
  SERTAOZINHO: '16', ITAQUAQUECETUBA: '11', MARILIA: '14', BOTUCATU: '14', SANTOS: '13',
  SUMARE: '19', BARUERI: '11', 'MOGI DAS CRUZES': '11', 'EMBU-GUACU': '11', SUZANO: '11',
  TAUBATE: '12', ASSIS: '18', AVARE: '14', ITUPEVA: '11', PEDERNEIRAS: '14',
  ADAMANTINA: '18', ARARAS: '19', COTIA: '11', INDAIATUBA: '19', LIMEIRA: '19',
  'SANTANA DE PARNAIBA': '11', TATUI: '15', COSMOPOLIS: '19', ITAPEVA: '15',
  ITATIBA: '11', JACAREI: '12', MAUA: '11', 'MOGI-MIRIM': '19', "SANTA BARBARA D'OESTE": '19',
  // PR
  CURITIBA: '41', MARINGA: '44', LONDRINA: '43', PINHAIS: '41', 'SAO JOSE DOS PINHAIS': '41',
  'PONTA GROSSA': '42', CASCAVEL: '45', ARAPONGAS: '43', GUARAPUAVA: '42',
  'FRANCISCO BELTRAO': '46', PARANAGUA: '41', GUARATUBA: '41', TOLEDO: '45',
  COLOMBO: '41', 'FAZENDA RIO GRANDE': '41', 'FOZ DO IGUACU': '45', PRUDENTOPOLIS: '42',
  'MARECHAL CANDIDO RONDON': '45', 'DOIS VIZINHOS': '46', 'SAO MATEUS DO SUL': '42',
  UMUARAMA: '44', 'SANTA TEREZA DO OESTE': '45', 'PATO BRANCO': '46',
  // RJ
  'RIO DE JANEIRO': '21', 'NOVA IGUACU': '21', 'CABO FRIO': '22', MACAE: '22',
  'SAO GONCALO': '21', 'DUQUE DE CAXIAS': '21', 'CAMPOS DOS GOYTACAZES': '22',
  PETROPOLIS: '24', TANGUA: '21', 'BARRA MANSA': '24', 'BELFORD ROXO': '21',
  NITEROI: '21', 'NOVA FRIBURGO': '22', 'SAO JOAO DE MERITI': '21', RESENDE: '24',
  // GO
  GOIANIA: '62', 'APARECIDA DE GOIANIA': '62', ANAPOLIS: '62', 'RIO VERDE': '64',
  ITUMBIARA: '64', CATALAO: '64', JATAI: '64', LUZIANIA: '61', 'AGUAS LINDAS DE GOIAS': '61',
  FORMOSA: '61', 'VALPARAISO DE GOIAS': '61', 'CALDAS NOVAS': '64', GOIANESIA: '62',
  // MG
  'BELO HORIZONTE': '31', UBERLANDIA: '34', CONTAGEM: '31', UBA: '32', 'MONTES CLAROS': '38',
  'NOVA SERRANA': '37', 'JUIZ DE FORA': '32', 'SETE LAGOAS': '31', DIVINOPOLIS: '37',
  'GOVERNADOR VALADARES': '33', 'JOAO MONLEVADE': '31', 'POUSO ALEGRE': '35', VARGINHA: '35',
  ITABIRA: '31', BETIM: '31', CARATINGA: '33', ITAUNA: '37', ARAXA: '34', GUAXUPE: '35',
  MURIAE: '32', 'PARA DE MINAS': '37', 'PATOS DE MINAS': '34', 'SANTA LUZIA': '31',
  'TEOFILO OTONI': '33', UNAI: '38', ITUIUTABA: '34', 'SAO GOTARDO': '34',
  'CORONEL FABRICIANO': '31', UBERABA: '34', IPATINGA: '31',
  // RS
  'CAXIAS DO SUL': '54', 'NOVO HAMBURGO': '51', 'PORTO ALEGRE': '51', GRAVATAI: '51',
  'PASSO FUNDO': '54', 'SANTA CRUZ DO SUL': '51', ERECHIM: '54', CANOAS: '51',
  'SANTA MARIA': '55', 'SAO LEOPOLDO': '51', MONTENEGRO: '51', PELOTAS: '53', IJUI: '55',
  'SAPUCAIA DO SUL': '51', CARAZINHO: '54', 'SAO MARCOS': '54', VACARIA: '54',
  'BENTO GONCALVES': '54', 'CAMPO BOM': '51', PAROBE: '51', TAQUARA: '51',
  'AMETISTA DO SUL': '55', 'FLORES DA CUNHA': '54', LAJEADO: '51', CACHOEIRINHA: '51',
  CAMAQUA: '53', 'DOIS IRMAOS': '51', 'VENANCIO AIRES': '51',
  // BA
  SALVADOR: '71', 'FEIRA DE SANTANA': '75', 'LAURO DE FREITAS': '71', CAMACARI: '71',
  'VITORIA DA CONQUISTA': '77', EUNAPOLIS: '73', 'LUIS EDUARDO MAGALHAES': '77',
  'TEIXEIRA DE FREITAS': '73', JUAZEIRO: '74', 'SANTO ANTONIO DE JESUS': '75',
  ITABUNA: '73', 'PAULO AFONSO': '75', 'PORTO SEGURO': '73', JACOBINA: '74',
  // PE
  RECIFE: '81', CARUARU: '81', 'JABOATAO DOS GUARARAPES': '81', PETROLINA: '87',
  PAULISTA: '81', 'CABO DE SANTO AGOSTINHO': '81', CARPINA: '81', TORITAMA: '81',
  // MT
  'VARZEA GRANDE': '65', RONDONOPOLIS: '66', CUIABA: '65', SINOP: '66',
  'PRIMAVERA DO LESTE': '66', 'CAMPO NOVO DO PARECIS': '65', 'PONTES E LACERDA': '65',
  'LUCAS DO RIO VERDE': '65', 'BARRA DO GARCAS': '66', SORRISO: '66', 'NOVA MUTUM': '65',
  // CE
  FORTALEZA: '85', 'JUAZEIRO DO NORTE': '88', MARACANAU: '85',
  // ES
  SERRA: '27', 'VILA VELHA': '27', CARIACICA: '27', 'CACHOEIRO DE ITAPEMIRIM': '28',
  LINHARES: '27', 'SAO MATEUS': '27', 'SANTA MARIA DE JETIBA': '27', VITORIA: '27',
  // PA
  BELEM: '91', PARAUAPEBAS: '94', CASTANHAL: '91', MARABA: '94',
  'SAO MIGUEL DO GUAMA': '91', ANANINDEUA: '91', 'CONCEICAO DO ARAGUAIA': '94',
  PARAGOMINAS: '91', SANTAREM: '93',
  // MA
  'SAO LUIS': '98', IMPERATRIZ: '99', BALSAS: '99', ACAILANDIA: '99', TIMON: '99',
  // PI
  TERESINA: '86',
  // AM
  MANAUS: '92',
  // RN, PB, TO, RO, RR, AP, AL, SE, MS, DF (múltiplos DDD mas cidade específica conhecida)
  NATAL: '84', 'JOAO PESSOA': '83', 'CAMPINA GRANDE': '83', ARAGUAINA: '63',
  'PARAISO DO TOCANTINS': '63', PALMAS: '63', 'PORTO VELHO': '69', VILHENA: '69',
  ARIQUEMES: '69', 'BOA VISTA': '95', MACAPA: '96', MACEIO: '82', ARACAJU: '79',
  'CAMPO GRANDE': '67', DOURADOS: '67', 'PONTA PORA': '67', 'NOVA ANDRADINA': '67',
  'TRES LAGOAS': '67', BRASILIA: '61', MOSSORO: '84', PARNAMIRIM: '84', PATOS: '83',
  'RIO BRANCO': '68',
  // Segunda leva — cidades menores que apareceram na lista de não resolvidos
  APUCARANA: '43', ARAUCARIA: '41',
  MIRASSOL: '17', TUPA: '18', 'PRAIA GRANDE': '13', PERUIBE: '13', LEME: '19',
  HORTOLANDIA: '19', 'BRAGANCA PAULISTA': '11', 'AGUAS DE LINDOIA': '19', VOTUPORANGA: '17',
  'SAO MANUEL': '14', 'RIO CLARO': '19', 'RIBEIRAO PIRES': '11', PINDAMONHANGABA: '12',
  'MONTE ALTO': '16', JARDINOPOLIS: '16', IBIUNA: '15', EMBU: '11', CRUZEIRO: '12', CAJAMAR: '11',
  'SAO JOAO DO ITAPERIU': '47', SOMBRIO: '48', ITUPORANGA: '47', 'BRACO DO NORTE': '48',
  "SAO MIGUEL D'OESTE": '49', 'RIO NEGRINHO': '47', CURITIBANOS: '49', 'CAMPO ALEGRE': '47',
  CAMBORIU: '47',
  VIAMAO: '51', 'SANTA ROSA': '55', IVOTI: '51', FARROUPILHA: '54',
  'FREDERICO WESTPHALEN': '55', ESTEIO: '51', ALVORADA: '51',
  ITABORAI: '21', ARARUAMA: '22', 'ANGRA DOS REIS': '24',
  // Interior NE frequente na carteira
  ARARIPINA: '87', BARREIRAS: '77', CHAPADINHA: '99', RUSSAS: '88', GARANHUNS: '87',
  'LIMOEIRO DO NORTE': '88', OLINDA: '81', CRATO: '88', SOBRAL: '88', 'SAO LUIZ': '98',
  BRUMADO: '77', 'SENHOR DO BONFIM': '74', 'SANTA INES': '99', PARNAIBA: '86',
  ALAGOINHAS: '71', CONDADO: '81', BATURITE: '85', QUIXADA: '88', SURUBIM: '81',
  LUZILANDIA: '86', JEQUIE: '73', 'RIBEIRA DO POMBAL': '75',
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
}

async function run() {
  const candidatos = await db.query.clientes.findMany({
    where: isNull(clientes.deletedAt),
    columns: { id: true, codigo: true, razaoSocial: true, telefoneWhatsapp: true, estado: true, cidade: true },
  })

  let corrigidosPorCidade = 0
  let corrigidosPorEstado = 0
  let semDdd = 0
  const naoResolvidos: string[] = []

  for (const c of candidatos) {
    if (!c.telefoneWhatsapp) continue
    const digitos = c.telefoneWhatsapp.replace(/\D/g, '')
    if (digitos.length !== 8 && digitos.length !== 9) continue // só mexe em quem não tem DDD
    semDdd++

    const cidadeNorm = c.cidade ? normalizar(c.cidade) : ''
    const estadoNorm = c.estado ? c.estado.trim().toUpperCase() : ''

    let ddd = DDD_POR_CIDADE[cidadeNorm]
    let origem = 'cidade'
    if (!ddd) {
      ddd = DDD_UNICO_POR_ESTADO[estadoNorm]
      origem = 'estado'
    }

    if (!ddd) {
      naoResolvidos.push(`${c.codigo} - ${c.razaoSocial} (${c.cidade}/${c.estado}) - tel: ${c.telefoneWhatsapp}`)
      continue
    }

    await db.update(clientes).set({ telefoneWhatsapp: ddd + digitos }).where(eq(clientes.id, c.id))
    if (origem === 'cidade') corrigidosPorCidade++
    else corrigidosPorEstado++
  }

  console.log('\n📊 Resumo:')
  console.log('  Telefones sem DDD encontrados:', semDdd)
  console.log('  Corrigidos por cidade:', corrigidosPorCidade)
  console.log('  Corrigidos por estado (DDD único):', corrigidosPorEstado)
  console.log('  Não resolvidos (revisar manualmente):', naoResolvidos.length)

  if (naoResolvidos.length) {
    const fs = await import('fs')
    fs.writeFileSync('nao-resolvidos-ddd.txt', naoResolvidos.join('\n'))
    console.log('  -> Lista salva em nao-resolvidos-ddd.txt')
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro:', err)
  process.exit(1)
})

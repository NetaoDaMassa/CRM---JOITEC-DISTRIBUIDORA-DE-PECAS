// ⚠️ TEMPORÁRIO — cópia de server/scripts/importar-carteiras-luana-yasminsalles-ricardo-odin-tubos.ts
// só pra existir dentro de src/ (compilado pro dist/ da imagem Docker) e
// rodar em produção via `docker compose exec backend node dist/scriptsOnetime/importarCarteirasLuanaYasminSallesRicardo.js`,
// já que server/scripts/ não entra na imagem. Excluir este arquivo (e este
// diretório) depois de confirmar que rodou certo em produção — a versão de
// registro histórico permanente é a de server/scripts/.
//
// Script avulso — importa a planilha 'CARTEIRA DE CLIENTES LUANA _ YASMIN
// SALLES _ RICARDO .xlsx' (~/Downloads, mensagem do João de 07/08/2026) pra
// empresa Odin Tubos e Conexões (slug 'odin-tubos'), cada aba na carteira do
// vendedor correspondente (Luana Aparecida, Yasmin Salles, Ricardo).
//
// A aba da Luana já vem com estado por linha (região sai de regiaoPorUf).
// Algumas células de estado tinham anotações coladas junto (ex: 'PR
// -C000133', 'SC - Maiollo', 'BA- CF') — só a sigla de 2 letras é usada, o
// resto é ignorado. 18 linhas marcadas 'Lead' na planilha viram observacoes.
//
// As abas da Yasmin Salles e do Ricardo não trazem estado — por decisão do
// João (mensagem de 07/08/2026): Yasmin Salles = Sul (bate com a carteira
// atual dela, majoritariamente PR/RS/SC), Ricardo = Sudeste (sem carteira
// prévia pra referência). A aba do Ricardo também não traz CNPJ — fica em
// branco pra ele completar depois.
//
// Mesma lógica de atribuição das importações da Yasmin Ramos e da Karinna:
// código que já existe sem vendedor -> atribui ao vendedor via
// transferirCliente; código já do vendedor certo -> não mexe; código de
// OUTRO vendedor -> não mexe, fica logado como conflito. Duplicados dentro
// de cada lista: fica a ocorrência com nome de verdade (não um CNPJ colado
// por engano no campo errado), senão a primeira.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../db/schema.js'
import { cnpjValido, limparCnpj } from '../lib/cnpj.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { regiaoPorUf, type Regiao } from '../lib/regiao.js'
import { transferirCliente } from '../router/carteira.js'

interface LinhaComEstado {
  codigo: string
  codigoAntigo?: string
  razaoSocial: string
  estado: string
  cnpj: string
  observacoes?: string
}

interface LinhaSimples {
  codigo: string
  razaoSocial: string
  cnpj?: string
}

const LUANA: LinhaComEstado[] = [
  {
    "codigo": "C000052",
    "codigoAntigo": "3517",
    "razaoSocial": "35.744.273 GERSON FERNANDES GARCES FILHO",
    "estado": "MA",
    "cnpj": "35.744.273/0001-25"
  },
  {
    "codigo": "C000061",
    "razaoSocial": "3L MANGUEIRAS E CONEXÕES LTDA",
    "estado": "BA",
    "cnpj": "58.806.224/0001-75"
  },
  {
    "codigo": "C000062",
    "razaoSocial": "3R FABRICAÇÃO DE ARTEFATOS DE METAL LTDA- ME",
    "estado": "AM",
    "cnpj": "12.564.882/0001-05"
  },
  {
    "codigo": "C000067",
    "razaoSocial": "40.657.842 VILMA MARIA DA SILVA",
    "estado": "PE",
    "cnpj": "40.657.842/0001-35"
  },
  {
    "codigo": "C000096",
    "razaoSocial": "48.824.778 JANETH RIBEIRO DE CARVALHO DIAS",
    "estado": "BA",
    "cnpj": "48.824.778/0001-41"
  },
  {
    "codigo": "C000118",
    "razaoSocial": "50.528.086 NUBIA ELLEN LIMA DE PINHO ROSA",
    "estado": "GO",
    "cnpj": "50.528.086/0001-06"
  },
  {
    "codigo": "C000337",
    "razaoSocial": "AB ENGENHARIA E COMPRESSORES LTDA",
    "estado": "PR",
    "cnpj": "35.302.029/0001-02"
  },
  {
    "codigo": "C000144",
    "razaoSocial": "52.292.561 JESSICA ALINE LENTINO",
    "estado": "SC",
    "cnpj": "52.292.561/0001-05"
  },
  {
    "codigo": "C000188",
    "razaoSocial": "54.763.298 FRANCISCO RICARDO CASAGRANDE FRANZOL",
    "estado": "SP",
    "cnpj": "54.763.298/0001-10"
  },
  {
    "codigo": "C010143",
    "razaoSocial": "61.120.122 FRANCK HALEM FREIRE",
    "estado": "PA",
    "cnpj": "61.120.122/0001-06"
  },
  {
    "codigo": "C000257",
    "razaoSocial": "61.551.492 JOSENILTON SANTOS DA SILVA",
    "estado": "RN",
    "cnpj": "61.551.492/0001-06"
  },
  {
    "codigo": "C010253",
    "codigoAntigo": "C010154",
    "razaoSocial": "62.841.543 ADJAR SEVERINO DOS SANTOS",
    "estado": "PE",
    "cnpj": "62.841.543/0001-99"
  },
  {
    "codigo": "C000294",
    "razaoSocial": "A H DA SILVA NETO COMPRESSORES",
    "estado": "RN",
    "cnpj": "53.936.509/0001-07"
  },
  {
    "codigo": "C000356",
    "razaoSocial": "Adalto M. Correa LTDA",
    "estado": "MS",
    "cnpj": "26.136.693/0001-38"
  },
  {
    "codigo": "C010135",
    "razaoSocial": "AGRESTE GASES COMERCIO LTDA",
    "estado": "PE",
    "cnpj": "41.081.134/0001-61"
  },
  {
    "codigo": "C000421",
    "razaoSocial": "AGROMOTORES",
    "estado": "CE",
    "cnpj": "02.956.532/0001-22"
  },
  {
    "codigo": "C000432",
    "razaoSocial": "AILANDE REGIS FERREIRA DOS SANTOS",
    "estado": "PE",
    "cnpj": "13.056.180/0001-75"
  },
  {
    "codigo": "C000469",
    "razaoSocial": "ALAN WAGNER MOURA DO AMARAL",
    "estado": "PE",
    "cnpj": "41.395.973/0001-54"
  },
  {
    "codigo": "C000586",
    "razaoSocial": "ANDERSON DE CARVALHO SILVA 09033598477",
    "estado": "CE",
    "cnpj": "22.032.854/0001-92"
  },
  {
    "codigo": "C000625",
    "razaoSocial": "ANTONIA DANIELA DA SILVA BARBOSA",
    "estado": "CE",
    "cnpj": "40.454.234/0001-23"
  },
  {
    "codigo": "C000649",
    "razaoSocial": "ANTONIO MARCOS JOSE PEREIRA",
    "estado": "MS",
    "cnpj": "40.522.860/0001-00"
  },
  {
    "codigo": "C000682",
    "razaoSocial": "AR MIL LTDA",
    "estado": "PA",
    "cnpj": "57.720.643/0001-27"
  },
  {
    "codigo": "C000686",
    "razaoSocial": "AR PNEUMATICA LTDA",
    "estado": "RN",
    "cnpj": "51.793.960/0001-97"
  },
  {
    "codigo": "C000695",
    "razaoSocial": "ARBRAS COMERCIO E SERVICOS LTDA",
    "estado": "TO",
    "cnpj": "58.111.635/0001-46"
  },
  {
    "codigo": "C000760",
    "razaoSocial": "ASSISFER ASSISTÊNCIA TÉCNICA DE MÁQ. FERRAMENTAS",
    "estado": "MT",
    "cnpj": "05.289.403/0001-16"
  },
  {
    "codigo": "C000831",
    "razaoSocial": "BARROS E BEZERRA COMERCIO E ASSISTENCIA DE MAQUINA",
    "estado": "PE",
    "cnpj": "59.554.620/0001-15"
  },
  {
    "codigo": "C000855",
    "razaoSocial": "BEUTÉCNICA COM E ASSISTENCIA DE MÁQUINAS LTDA",
    "estado": "RS",
    "cnpj": "07.435.123/0001-02"
  },
  {
    "codigo": "C000893",
    "razaoSocial": "BR TUBOS E CONEXOES LTDA",
    "estado": "MS",
    "cnpj": "15.582.089/0001-19"
  },
  {
    "codigo": "C000901",
    "razaoSocial": "BRASIL TESTE - SERVICOS DE MANUTENCAO LTDA",
    "estado": "DF",
    "cnpj": "38.285.149/0001-37"
  },
  {
    "codigo": "C000931",
    "razaoSocial": "BTR COMERCIO ATACADISTA DE MAQUINAS E SERVICOS LTD",
    "estado": "CE",
    "cnpj": "41.092.712/0001-65"
  },
  {
    "codigo": "C000951",
    "razaoSocial": "C R D DE OLIVEIRA COMPRESSORES",
    "estado": "GO",
    "cnpj": "54.205.153/0001-02"
  },
  {
    "codigo": "C001000",
    "razaoSocial": "CARLOS ANTONIO ALVES BARRETO GOMES",
    "estado": "PB",
    "cnpj": "44.718.171/0001-26"
  },
  {
    "codigo": "C001043",
    "codigoAntigo": "C001453",
    "razaoSocial": "CASA DO COMPRESSOR LTDA",
    "estado": "SC",
    "cnpj": "73.539.389/0001-11"
  },
  {
    "codigo": "C001075",
    "codigoAntigo": "C001444",
    "razaoSocial": "CDM CONEXÕES LTDA",
    "estado": "SP",
    "cnpj": "20.765.346/0001-98"
  },
  {
    "codigo": "C001096",
    "razaoSocial": "CENTRAL DA AUTOMACAO LTDA",
    "estado": "RN",
    "cnpj": "09.687.459/0001-80"
  },
  {
    "codigo": "C001162",
    "razaoSocial": "Claudio R. de Melo LTDA",
    "estado": "AP",
    "cnpj": "01.911.324/0001-44"
  },
  {
    "codigo": "C001267",
    "razaoSocial": "COMPRE PEÇAS DIST. DE MAQ. E COMPRESSORES. LTDA",
    "estado": "RS",
    "cnpj": "13.838.815/0001-96"
  },
  {
    "codigo": "C001306",
    "razaoSocial": "CONFIANCA PNEUMATICA AUTOMACAO INDUSTRIAL LTDA",
    "estado": "PA",
    "cnpj": "37.330.440/0002-06"
  },
  {
    "codigo": "C001307",
    "razaoSocial": "CONFIANCA PNEUMATICA AUTOMACAO INDUSTRIAL LTDA",
    "estado": "MT",
    "cnpj": "37.330.440/0001-17"
  },
  {
    "codigo": "C001397",
    "razaoSocial": "DANIEL AVILA JUNIOR",
    "estado": "SC",
    "cnpj": "43.736.155/0001-01"
  },
  {
    "codigo": "C001517",
    "razaoSocial": "DMF COMPRESSORES LTDA",
    "estado": "MT",
    "cnpj": "49.170.257/0001-80"
  },
  {
    "codigo": "C001547",
    "razaoSocial": "E DA SILVA RAMOS COMPRESSORES",
    "estado": "GO",
    "cnpj": "31.359.238/0001-31"
  },
  {
    "codigo": "C001558",
    "razaoSocial": "E. RICARDO DE SOUZA SANTOS LTDA",
    "estado": "MT",
    "cnpj": "62.895.878/0001-90"
  },
  {
    "codigo": "C001634",
    "razaoSocial": "ELAINE CRISTINA SANTOS SILVA DE OLIVEIRA E CIA LT",
    "estado": "BA",
    "cnpj": "21.918.893/0001-29"
  },
  {
    "codigo": "C001640",
    "codigoAntigo": "C004638",
    "razaoSocial": "ELEMEPY COMERCIO, MANUTENCAO E SERVICOS PNEUMATICO",
    "estado": "BA",
    "cnpj": "12.703.379/0001-85"
  },
  {
    "codigo": "C001649",
    "razaoSocial": "ELETRICA INSTALADORA NOGUEIRA LTDA",
    "estado": "GO",
    "cnpj": "26.931.014/0001-12"
  },
  {
    "codigo": "C001663",
    "razaoSocial": "ELETRO COSTA LTDA",
    "estado": "TO",
    "cnpj": "28.682.910/0001-10"
  },
  {
    "codigo": "C001695",
    "razaoSocial": "ELETROCONNECT AUTOMACAO INDUSTRIAL E CONSTRUCAO LT",
    "estado": "MT",
    "cnpj": "55.037.445/0002-19"
  },
  {
    "codigo": "C001732",
    "razaoSocial": "ELIEZER MARTINS DE OLIVEIRA FILHO",
    "estado": "CE",
    "cnpj": "41.854.617/0001-51"
  },
  {
    "codigo": "C001792",
    "razaoSocial": "EPX COMERCIO LTDA",
    "estado": "CE",
    "cnpj": "24.193.303/0001-36"
  },
  {
    "codigo": "C001828",
    "razaoSocial": "EVANILSON LUCAS DO NASCIMENTO 01101605413",
    "estado": "RN",
    "cnpj": "35.627.254/0001-19"
  },
  {
    "codigo": "C001871",
    "razaoSocial": "FABIANA MARIA CARDOSO DOS ANJOS",
    "estado": "PE",
    "cnpj": "11.936.284/0001-49"
  },
  {
    "codigo": "C001862",
    "razaoSocial": "F. C. S GONZALEZ",
    "estado": "PA",
    "cnpj": "06.100.134/0001-60"
  },
  {
    "codigo": "C002014",
    "razaoSocial": "FORT MANUTENCAO LTDA",
    "estado": "MT",
    "cnpj": "03.264.286/0001-00"
  },
  {
    "codigo": "C002043",
    "razaoSocial": "FRANCISCO JUNIO COSTA CASIMIRO",
    "estado": "PB",
    "cnpj": "09.442.441/0001-18"
  },
  {
    "codigo": "C000188",
    "razaoSocial": "54.763.298 FRANCISCO RICARDO CASAGRANDE FRANZOL",
    "estado": "SP",
    "cnpj": "54.763.298/0001-10"
  },
  {
    "codigo": "C002085",
    "razaoSocial": "G S COMERCIO DE MANGUEIRAS LTDA",
    "estado": "PA",
    "cnpj": "21.617.504/0001-25"
  },
  {
    "codigo": "C002163",
    "razaoSocial": "GIDEOLI COMERCIO E IMPORTACAO LTDA",
    "estado": "MT",
    "cnpj": "24.833.443/0001-21"
  },
  {
    "codigo": "C002179",
    "razaoSocial": "GILMAR MARICONI 06173437805",
    "estado": "SP",
    "cnpj": "39.483.294/0001-95"
  },
  {
    "codigo": "C002196",
    "codigoAntigo": "C002197",
    "razaoSocial": "GLIER & CIA LTDA",
    "estado": "BA",
    "cnpj": "06.014.974/0001-00"
  },
  {
    "codigo": "C002222",
    "razaoSocial": "GP COMPRESSORES TEC.E COMERCIO DE COMPRESSOR LTDA",
    "estado": "SP",
    "cnpj": "46.892.729/0001-10"
  },
  {
    "codigo": "C002224",
    "razaoSocial": "GR SOLUCOES INDUSTRIAIS LTDA",
    "estado": "GO",
    "cnpj": "50.297.500/0001-05"
  },
  {
    "codigo": "C002291",
    "razaoSocial": "HERBERT VENTURA DABROWSKI",
    "estado": "BA",
    "cnpj": "25.391.659/0001-47"
  },
  {
    "codigo": "C002319",
    "razaoSocial": "HIDRAULEM - MANUTENCAO HIDRAULICA LEM LTDA",
    "estado": "GO",
    "cnpj": "10.969.114/0004-40"
  },
  {
    "codigo": "C002418",
    "razaoSocial": "IMAC IND E COM DE MAQUINAS AGRICOLAS CONQUISTENSE",
    "estado": "BA",
    "cnpj": "14.633.416/0001-51"
  },
  {
    "codigo": "C002438",
    "razaoSocial": "INDUTECH EQUIPAMENTOS E SERVIÇOS LTD",
    "estado": "PE",
    "cnpj": "53.016.379/0001-94"
  },
  {
    "codigo": "C010132",
    "codigoAntigo": "C002773",
    "razaoSocial": "J B S ASSISTENCIA TECNICA EM COMPRESSORES LTDA",
    "estado": "CE",
    "cnpj": "64.869.106/0001-09"
  },
  {
    "codigo": "C002513",
    "razaoSocial": "J MAGNO LINDEBERG DE LIMA ME",
    "estado": "PE",
    "cnpj": "12.300.242/0001-80"
  },
  {
    "codigo": "C002536",
    "razaoSocial": "J. DANTAS FILHO ME",
    "estado": "RN",
    "cnpj": "06.156.217/0001-71"
  },
  {
    "codigo": "C002553",
    "razaoSocial": "JAA COMPRESSORES LTDA",
    "estado": "GO",
    "cnpj": "54.908.880/0001-28"
  },
  {
    "codigo": "C002578",
    "razaoSocial": "JAISON CLAY DE SOUZA LIMA",
    "estado": "AC",
    "cnpj": "27.747.573/0001-30"
  },
  {
    "codigo": "C002685",
    "razaoSocial": "JOAO MOREIRA DA SILVA JUNIOR 72516119100",
    "estado": "GO",
    "cnpj": "39.561.712/0001-15"
  },
  {
    "codigo": "C002772",
    "razaoSocial": "JOSÉ ANTÔNIO MOURA PEREIRA",
    "estado": "BA",
    "cnpj": "12.923.276/0001-20"
  },
  {
    "codigo": "C002793",
    "razaoSocial": "JOÃO VITOR RECOARO",
    "estado": "SP",
    "cnpj": "33.629.033/0001-54"
  },
  {
    "codigo": "C010909",
    "razaoSocial": "JS MAQUINAS E MANUTENCAO LTDA",
    "estado": "CE",
    "cnpj": "37.876.684/0001-08"
  },
  {
    "codigo": "C002874",
    "razaoSocial": "KESSIA DOS SANTOS ARAÚJO SILVA",
    "estado": "PB",
    "cnpj": "42.758.612/0001-98"
  },
  {
    "codigo": "C002931",
    "razaoSocial": "LC COMPRESSORES VENDA E MANUTENCAO DE MAQUINAS E E",
    "estado": "SP",
    "cnpj": "54.763.182/0001-81"
  },
  {
    "codigo": "C002988",
    "razaoSocial": "LIDER AUTOMACAO INDUSTRIAL LTDA",
    "estado": "GO",
    "cnpj": "13.579.467/0001-80"
  },
  {
    "codigo": "C003003",
    "razaoSocial": "LIMA VIEIRA MOTORES LTDA",
    "estado": "GO",
    "cnpj": "51.224.366/0001-85"
  },
  {
    "codigo": "C003083",
    "razaoSocial": "LUCINÉIA MARIA MACHADO",
    "estado": "RN",
    "cnpj": "24.839.548/0001-98"
  },
  {
    "codigo": "C003126",
    "razaoSocial": "LUNATEC MOTORES LTDA",
    "estado": "RN",
    "cnpj": "41.769.913/0001-54"
  },
  {
    "codigo": "C003140",
    "razaoSocial": "M A COMERCIO DE PECAS MAQUINAS E EQUIPAMENTOS LTDA",
    "estado": "PE",
    "cnpj": "16.629.158/0001-65"
  },
  {
    "codigo": "C003161",
    "razaoSocial": "M R CORREA DE MIRANDA LTDA",
    "estado": "PA",
    "cnpj": "28.526.493/0001-17"
  },
  {
    "codigo": "C003246",
    "razaoSocial": "MANUTTEC EQUIPAMENTOS LTDA",
    "estado": "GO",
    "cnpj": "52.694.886/0001-14"
  },
  {
    "codigo": "C007767",
    "razaoSocial": "MAPI SERVICOS HOSPITALARES LTDA",
    "estado": "MA",
    "cnpj": "69.378.081/0001-64"
  },
  {
    "codigo": "C003253",
    "razaoSocial": "MAQBELTING EQUIPAMENTOS INDUSTRIAIS LTDA",
    "estado": "PE",
    "cnpj": "05.031.585/0001-20"
  },
  {
    "codigo": "C003256",
    "razaoSocial": "MAQMOTORES COMERCIO DE MAQUINAS E FERRAMENTAS LTDA",
    "estado": "CE",
    "cnpj": "42.459.675/0001-43"
  },
  {
    "codigo": "C003342",
    "razaoSocial": "MARCUS VINICIUS ALMEIDA CRISPIM",
    "estado": "DF",
    "cnpj": "46.215.425/0001-19"
  },
  {
    "codigo": "C003347",
    "razaoSocial": "MARIA CONSUELO DA SILVA BARBOSA ME",
    "estado": "CE",
    "cnpj": "11.116.518/0001-01"
  },
  {
    "codigo": "C003352",
    "razaoSocial": "MARIA DE L A SILVA",
    "estado": "RN",
    "cnpj": "37.172.460/0001-07"
  },
  {
    "codigo": "C003391",
    "razaoSocial": "MART INDUSTRIA E COMERCIO DE ARTIGOS DE FIBRA LTDA",
    "estado": "CE",
    "cnpj": "23.778.106/0001-16"
  },
  {
    "codigo": "C003399",
    "razaoSocial": "MARVIBA MANUTENCAO E SERVICOS LTDA",
    "estado": "BA",
    "cnpj": "47.074.074/0001-36"
  },
  {
    "codigo": "C003404",
    "razaoSocial": "MASTER MANUTENÇÕES EIRELI",
    "estado": "GO",
    "cnpj": "29.023.773/0001-75"
  },
  {
    "codigo": "C003457",
    "razaoSocial": "MC MANGUEIRAS E CONEXOES COMERCIO E SERVICOS LTDA",
    "estado": "SE",
    "cnpj": "47.305.252/0001-92"
  },
  {
    "codigo": "C003481",
    "razaoSocial": "MEGA COM. DE MAT. P/ CONST. LTDA",
    "estado": "GO",
    "cnpj": "36.249.731/0001-12"
  },
  {
    "codigo": "C003482",
    "razaoSocial": "MEGA COMERCIO E MANUTENCAO LTDA ME",
    "estado": "BA",
    "cnpj": "33.173.207/0001-17"
  },
  {
    "codigo": "C003487",
    "codigoAntigo": "C003488",
    "razaoSocial": "MEGAFLEX MECANICA E HIDRAULICA LTDA",
    "estado": "PE",
    "cnpj": "22.635.226/0001-00"
  },
  {
    "codigo": "C003883",
    "razaoSocial": "PAULO RENATO RIBEIRO SANTOS 03276632519",
    "estado": "SE",
    "cnpj": "24.490.925/0001-26"
  },
  {
    "codigo": "C003694",
    "razaoSocial": "NERI MANUTENÇÃO EM LAVADORA DE ALTA PRESSÃO E COMR",
    "estado": "DF",
    "cnpj": "45.309.510/0001-83"
  },
  {
    "codigo": "C003767",
    "razaoSocial": "27.825.352/0001-32",
    "estado": "MT",
    "cnpj": "27.825.352/0001-32"
  },
  {
    "codigo": "C003807",
    "razaoSocial": "OLIVIA NUNES LYRA 04874427413",
    "estado": "PB",
    "cnpj": "19.591.976/0001-04"
  },
  {
    "codigo": "C003838",
    "razaoSocial": "P. F. BARBOSA NETO - ME",
    "estado": "PI",
    "cnpj": "86.733.631/0002-16"
  },
  {
    "codigo": "C003895",
    "razaoSocial": "PC & N CONSTRUCOES E SERVICOS LTDA",
    "estado": "PA",
    "cnpj": "33.963.637/0001-32"
  },
  {
    "codigo": "C003918",
    "razaoSocial": "PERNAMBUCO PECAS PARA COMPRESSORES LTDA",
    "estado": "PE",
    "cnpj": "37.349.521/0001-69"
  },
  {
    "codigo": "C003936",
    "codigoAntigo": "C004824",
    "razaoSocial": "PIX COMERCIO DE MANGUEIRAS E CONEXOES LTDA",
    "estado": "SE",
    "cnpj": "43.634.936/0001-87"
  },
  {
    "codigo": "C003944",
    "codigoAntigo": "C004572",
    "razaoSocial": "PNEUMATECH COMPRESSORES COMERCIO E SERVICOS LTDA",
    "estado": "AL",
    "cnpj": "41.112.985/0001-24"
  },
  {
    "codigo": "C003967",
    "razaoSocial": "PPR SISTEMAS PNEUMATICO LTDA",
    "estado": "CE",
    "cnpj": "20.739.487/0001-36"
  },
  {
    "codigo": "C003917",
    "razaoSocial": "PERNAMBUCO MANGUEIRAS E CONEXOES LTDA",
    "estado": "PE",
    "cnpj": "50.055.180/0001-87"
  },
  {
    "codigo": "C003989",
    "razaoSocial": "PROAR COMPRESSORES E EQUIPAMENTOS LTDA",
    "estado": "SC",
    "cnpj": "35.042.465/0001-90"
  },
  {
    "codigo": "C004005",
    "codigoAntigo": "C010146",
    "razaoSocial": "PSI AUTOMAÇÃO HIDRAULICA E PNEUMATICA EIRELI",
    "estado": "BA",
    "cnpj": "21.829.826/0001-38"
  },
  {
    "codigo": "C004028",
    "razaoSocial": "R K COMERCIAL ATACAD E VAREJISTA DE FERRAGENS LTDA",
    "estado": "PE",
    "cnpj": "09.304.576/0001-17"
  },
  {
    "codigo": "C010024",
    "codigoAntigo": "C004119",
    "razaoSocial": "RECAUTEC MAQUINAS E FERRAMENTAS LTDA",
    "estado": "CE",
    "cnpj": "15.814.588/0004-37"
  },
  {
    "codigo": "C004124",
    "razaoSocial": "REDE GOIANA DE ASSISTENCIA PECAS E SERVICO LTDA",
    "estado": "GO",
    "cnpj": "57.361.173/0001-52"
  },
  {
    "codigo": "C004176",
    "razaoSocial": "RESIHIDRAULICA COMERCIO E SERVICOS INDUSTRIAIS LTD",
    "estado": "CE",
    "cnpj": "42.671.747/0001-11"
  },
  {
    "codigo": "C004194",
    "razaoSocial": "RICARDO LOPES DA SILVA 92028608587",
    "estado": "BA",
    "cnpj": "33.084.490/0001-00"
  },
  {
    "codigo": "C004214",
    "razaoSocial": "RIV MANUTENCAO, PECAS E SERVICOS PARA COMPRESSOREE",
    "estado": "PE",
    "cnpj": "22.381.463/0001-83"
  },
  {
    "codigo": "C004220",
    "razaoSocial": "RL MANUTENCAO E AUTOMACAO LTDA",
    "estado": "CE",
    "cnpj": "48.101.921/0001-77"
  },
  {
    "codigo": "C004225",
    "razaoSocial": "RM MANUTENCAO PREVENTIVA INDUSTRIAL E COMERCIO DE",
    "estado": "BA",
    "cnpj": "23.324.633/0001-50"
  },
  {
    "codigo": "C004274",
    "razaoSocial": "RODRIGUES DA SILVA 85813096582",
    "estado": "BA",
    "cnpj": "27.820.451/0001-21"
  },
  {
    "codigo": "C004297",
    "razaoSocial": "ROMILSON SILVA DE ASSIS",
    "estado": "PI",
    "cnpj": "19.255.075/0001-41"
  },
  {
    "codigo": "C004333",
    "razaoSocial": "RR COMPRESSORES LTDA",
    "estado": "MT",
    "cnpj": "48.618.692/0001-62"
  },
  {
    "codigo": "C004351",
    "razaoSocial": "RUTAMACH COMERCIO E SERVICOS LTDA",
    "estado": "PA",
    "cnpj": "19.837.103/0001-39"
  },
  {
    "codigo": "C004452",
    "razaoSocial": "SERGIO AVELINO DA SILVA -ME",
    "estado": "BA",
    "cnpj": "21.783.891/0001-70"
  },
  {
    "codigo": "C004465",
    "razaoSocial": "SERVCOMP MANUTENCAO LTDA",
    "estado": "BA",
    "cnpj": "21.727.958/0001-59"
  },
  {
    "codigo": "C004530",
    "razaoSocial": "SO MANGUEIRAS COMERCIO E SERVICOS LTDA",
    "estado": "PB",
    "cnpj": "03.327.900/0001-36"
  },
  {
    "codigo": "C004589",
    "razaoSocial": "STEMAX MANUTENCOES E SOLUCOES LTDA",
    "estado": "CE",
    "cnpj": "20.636.139/0001-33"
  },
  {
    "codigo": "C004599",
    "razaoSocial": "SUL FERRAMENTAS COMERCIO E SERVICOS LTDA",
    "estado": "BA",
    "cnpj": "08.017.770/0001-59"
  },
  {
    "codigo": "C004620",
    "razaoSocial": "T. BERGOLI E CIA. LTDA",
    "estado": "MA",
    "cnpj": "11.210.830/0001-60"
  },
  {
    "codigo": "C004630",
    "razaoSocial": "TAIAMA PNEUMATICA E AUTOMACAO LTDA ME",
    "estado": "MT",
    "cnpj": "07.083.257/0001-01"
  },
  {
    "codigo": "C004702",
    "razaoSocial": "THIAGO M CRISPIM COMPRESSORES LTDA",
    "estado": "GO",
    "cnpj": "42.590.490/0001-73"
  },
  {
    "codigo": "C004739",
    "razaoSocial": "TORNSOLDA TORNEADORA LTDA",
    "estado": "GO",
    "cnpj": "23.316.745/0001-60"
  },
  {
    "codigo": "C004772",
    "razaoSocial": "UNITEC SERVICOS LTDA",
    "estado": "PB",
    "cnpj": "10.319.076/0001-38"
  },
  {
    "codigo": "C004789",
    "razaoSocial": "V S D DOS SANTOS",
    "estado": "GO",
    "cnpj": "29.879.163/0001-78"
  },
  {
    "codigo": "C004910",
    "razaoSocial": "VISAO HIDROPNEUMATICA COMERCIO, SERVICOS E REPRES",
    "estado": "BA",
    "cnpj": "20.897.019/0001-90"
  },
  {
    "codigo": "C004913",
    "razaoSocial": "VITAL SOLUCOES INDUSTRIAIS LTDA",
    "estado": "GO",
    "cnpj": "40.923.848/0001-07"
  },
  {
    "codigo": "C011186",
    "razaoSocial": "TECNOLOGICA SERVICOS TECNICOS INDUSTRIAIS LTDA",
    "estado": "PA",
    "cnpj": "39.656.175/0001-97"
  },
  {
    "codigo": "C011335",
    "codigoAntigo": "C011280",
    "razaoSocial": "42.538.015 SAMARA DE SOUZA BRAGA",
    "estado": "AM",
    "cnpj": "49.940.036/0001-44"
  },
  {
    "codigo": "C011063",
    "razaoSocial": "CARREFLEX COMERCIAL LTDA.",
    "estado": "PA",
    "cnpj": "27.685.033/0001-79"
  },
  {
    "codigo": "C010556",
    "razaoSocial": "DAM SERVICE & CIA LTDA",
    "estado": "PE",
    "cnpj": "27.915.186/0001-65"
  },
  {
    "codigo": "C001535",
    "razaoSocial": "DTL CONSTRUCOES LTDA",
    "estado": "PI",
    "cnpj": "39.961.921/0001-56"
  },
  {
    "codigo": "C011260",
    "razaoSocial": "FERGAL SOLUCOES INDUSTRIAIS LTDA",
    "estado": "PE",
    "cnpj": "11.581.087/0001-54"
  },
  {
    "codigo": "C010998",
    "razaoSocial": "HELEVAH EQUIPAMENTOS, ESTRUTURA E SERVICOS LTDA",
    "estado": "PA",
    "cnpj": "62.308.772/0001-42"
  },
  {
    "codigo": "C010944",
    "razaoSocial": "J B LINHARES ANDRADE COMERCIO",
    "estado": "RN",
    "cnpj": "31.055.459/0001-16"
  },
  {
    "codigo": "C010945",
    "razaoSocial": "J.S.A. IMPORTACAO LTDA",
    "estado": "MT",
    "cnpj": "62.888.522/0001-29"
  },
  {
    "codigo": "C011215",
    "razaoSocial": "JANDERSON DE SOUSA GONTIJO",
    "estado": "PE",
    "cnpj": "20.511.817/0001-31"
  },
  {
    "codigo": "C010443",
    "razaoSocial": "JOCLAL CASA DAS MANGUEIRAS E CORREIAS LTDA",
    "estado": "BA",
    "cnpj": "34.071.993/0001-04"
  },
  {
    "codigo": "C010897",
    "razaoSocial": "JOSUE BERNARDO BORGES",
    "estado": "GO",
    "cnpj": "26.688.439/0001-42"
  },
  {
    "codigo": "C010909",
    "razaoSocial": "JS MAQUINAS E MANUTENCAO LTDA",
    "estado": "CE",
    "cnpj": "37.876.684/0001-08"
  },
  {
    "codigo": "C010364",
    "razaoSocial": "MENDONCA & MARINHO LTDA",
    "estado": "MS",
    "cnpj": "11.627.596/0001-70"
  },
  {
    "codigo": "C010970",
    "razaoSocial": "RAV COMERCIO DE ROLAMENTOS E ACESSORIOS INDUSTRIAS LTDA",
    "estado": "BA",
    "cnpj": "30.590.271/0001-05"
  },
  {
    "codigo": "C010367",
    "razaoSocial": "SPB COMERCIO DE EQUIPAMENTOS E SUPRIMENTOS TECNICOS LTDA",
    "estado": "AM",
    "cnpj": "47.561.367/0001-48"
  },
  {
    "codigo": "C011373",
    "razaoSocial": "41.510.004 LUCIANO PEREIRA VASCONCELOS",
    "estado": "BA",
    "cnpj": "41.510.004/0001-05",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011041",
    "razaoSocial": "55.275.524 BEATRIZ LUIZA DO CARMO SILVA",
    "estado": "GO",
    "cnpj": "55.275.524/0001-87",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011363",
    "razaoSocial": "62.911.804 LILIAN DE FATIMA SILVA MENEZES",
    "estado": "AL",
    "cnpj": "62.911.804/0001-08",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011220",
    "razaoSocial": "66.732.815 WESLLI DANTAS DE SANTANA",
    "estado": "BA",
    "cnpj": "66.732.815/0001-73",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011132",
    "razaoSocial": "ALRENIR CLEMENTINO DE ANDRADE OLIVEIRA",
    "estado": "PB",
    "cnpj": "42.294.836/0001-96",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010750",
    "razaoSocial": "B.M. DO NASCIMENTO GLUCHOWSKI",
    "estado": "MT",
    "cnpj": "23.385.535/0001-23",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011462",
    "razaoSocial": "BARATAO DA HIDRAULICA LTDA",
    "estado": "RN",
    "cnpj": "65.039.759/0001-23",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010338",
    "razaoSocial": "BRASIL SOLUCOES ELETRICOS E HIDRAULICOS LTDA",
    "estado": "PI",
    "cnpj": "60.535.391/0001-70",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010982",
    "razaoSocial": "CIMSAL COM E IND DE MOAGEM E REFINACAO STA CECILIA LTDA",
    "estado": "RN",
    "cnpj": "08.348.609/0001-68",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011004",
    "razaoSocial": "CLASSE A FERRAMENTAS LTDA",
    "estado": "MS",
    "cnpj": "58.072.129/0001-95",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010618",
    "razaoSocial": "CONEXAO MANGUEIRAS COMERCIO & SERVICOS LTDA",
    "estado": "SE",
    "cnpj": "04.140.287/0001-06",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010405",
    "razaoSocial": "FG - COMERCIO DE PECAS E EQUIPAMENTOS PARA POSTOS DE COMBUSTIVEIS LTDA",
    "estado": "GO",
    "cnpj": "09.222.471/0001-19",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011028",
    "razaoSocial": "FORTNORT SERVICO DE MANUTENCAO EM IMPLEMENTOS RODOVIARIOS LTDA.",
    "estado": "BA",
    "cnpj": "54.430.942/0001-39",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010987",
    "razaoSocial": "LUCAS BRANDAO COMERCIO INDUSTRIA E SERVICOS DE MOVEIS LTDA",
    "estado": "BA",
    "cnpj": "13.937.830/0001-91",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011274",
    "razaoSocial": "S. S. M. FILHO LTDA",
    "estado": "AM",
    "cnpj": "36.157.058/0001-90",
    "observacoes": "Lead"
  },
  {
    "codigo": "C010912",
    "razaoSocial": "TREVO SERVICOS E COMERCIO DE MATERIAIS ELETRICOS LTDA",
    "estado": "PA",
    "cnpj": "07.699.348/0001-68",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011418",
    "razaoSocial": "UNITECH AUTOMACAO INDUSTRIAL LTDA",
    "estado": "PA",
    "cnpj": "12.442.102/0001-46",
    "observacoes": "Lead"
  },
  {
    "codigo": "C011166",
    "razaoSocial": "ZR MOTORES, COMERCIO E SERVICOS DE EQUIPAMENTOS ELETRICOS LTDA",
    "estado": "DF",
    "cnpj": "10.992.555/0001-10",
    "observacoes": "Lead"
  },
  {
    "codigo": "C000955",
    "razaoSocial": "C. BORDALO HIDRAULICOS E PNEUMATICOS LTDA",
    "estado": "PA",
    "cnpj": "52.799.896/0001-14"
  },
  {
    "codigo": "C001121",
    "razaoSocial": "CG COMPRESSORES E PNEUMATICA LTDA",
    "estado": "MT",
    "cnpj": "57.610.331/0001-60"
  },
  {
    "codigo": "C001142",
    "razaoSocial": "CIM ENGENHARIA LTDA",
    "estado": "TO",
    "cnpj": "31.034.171/0001-65"
  },
  {
    "codigo": "C011260",
    "razaoSocial": "FERGAL SOLUCOES INDUSTRIAIS LTDA",
    "estado": "PE",
    "cnpj": "11.581.087/0001-54"
  },
  {
    "codigo": "C002613",
    "razaoSocial": "JE AGROMAQ MAQUINAS E COMPRESSORES LTDA ME",
    "estado": "GO",
    "cnpj": "26.672.809/0001-53"
  },
  {
    "codigo": "C003114",
    "razaoSocial": "LUIZ FELIPE LIRA VIEIRA",
    "estado": "DF",
    "cnpj": "43.023.817/0001-98"
  },
  {
    "codigo": "C003240",
    "razaoSocial": "MANUMED COM. E SER. DE MAQ. E EQUI. EIRELI ME",
    "estado": "PA",
    "cnpj": "02.328.024/0001-08"
  },
  {
    "codigo": "C003767",
    "razaoSocial": "ODAIR ARAUJO DE OLIVEIRA LTDA",
    "estado": "MT",
    "cnpj": "27.825.352/0001-32"
  },
  {
    "codigo": "C004014",
    "razaoSocial": "QUERENCIA MANGUEIRAS E COMPONENTES HIDRAULICOS LTD",
    "estado": "MT",
    "cnpj": "21.491.602/0001-69"
  },
  {
    "codigo": "C004435",
    "razaoSocial": "SCHNEIDER COMÉRCIO DE COMPRESSORES",
    "estado": "GO",
    "cnpj": "23.091.160/0001-99"
  },
  {
    "codigo": "C004892",
    "razaoSocial": "VICTOR HUGO BRAVO GUIMARAES 70298568136",
    "estado": "GO",
    "cnpj": "42.732.368/0001-94"
  },
  {
    "codigo": "C004928",
    "razaoSocial": "VMC VÁLVULAS MAQUINAS E CÂMARAS DE AR VITALINO LTA",
    "estado": "BA",
    "cnpj": "00.922.333/0004-10"
  }
]

const YASMIN_SALLES: LinhaSimples[] = [
  {
    "codigo": "C003288",
    "razaoSocial": "MARCIA A HECK EIRELI",
    "cnpj": "26.946.595/0001-66"
  },
  {
    "codigo": "C002698",
    "razaoSocial": "JOEL DALVAN BOHRER",
    "cnpj": "23.309.868/0001-73"
  },
  {
    "codigo": "C004651",
    "razaoSocial": "TECAR PORTUARIA LTDA",
    "cnpj": "08.313.893/0001-37"
  },
  {
    "codigo": "C001692",
    "razaoSocial": "ELETROBAU",
    "cnpj": "07.318.738/0001-40"
  },
  {
    "codigo": "C004663",
    "razaoSocial": "TECNOAIR RENTAL AR LTDA",
    "cnpj": "03.450.722/0001-36"
  },
  {
    "codigo": "C010688",
    "razaoSocial": "TMX MAQUINAS E EQUIPAMENTOS LTDA",
    "cnpj": "63.907.575/0001-02"
  },
  {
    "codigo": "C010613",
    "razaoSocial": "RETROFITI SOLUCOES INDUSTRIAIS LTDA",
    "cnpj": "17.643.681/0001-09"
  },
  {
    "codigo": "C010501",
    "razaoSocial": "M G ROSA LTDA",
    "cnpj": "24.987.235/0001-87"
  },
  {
    "codigo": "C004750",
    "razaoSocial": "TREEFER COMERCIO E MANUTENCAO DE MAQUINAS E FERRAM",
    "cnpj": "56.707.963/0001-84"
  },
  {
    "codigo": "C000740",
    "razaoSocial": "ARSISTEQ SISTEMAS MANUTENCOES LOCACOES E EQUIPAME",
    "cnpj": "31.128.767/0001-24"
  },
  {
    "codigo": "C003626",
    "razaoSocial": "MTR COMPRESSORES ASSISTENCIA TECNICA LTDA",
    "cnpj": "46.108.923/0001-62"
  },
  {
    "codigo": "C010447",
    "razaoSocial": "EVERTON MASTELLA TULESKI LTDA",
    "cnpj": "06.984.328/0001-76"
  },
  {
    "codigo": "C003069",
    "razaoSocial": "LUCIANO AUGUSTIN",
    "cnpj": "12.182.057/0001-38"
  },
  {
    "codigo": "C002221",
    "razaoSocial": "GOPHEX AUTOMACAO INDUSTRIAL LTDA",
    "cnpj": "23.644.019/0001-76"
  },
  {
    "codigo": "C010591",
    "razaoSocial": "",
    "cnpj": ""
  },
  {
    "codigo": "C005019",
    "razaoSocial": "WM COMPRESSORES LTDA",
    "cnpj": "51.395.741/0001-50"
  },
  {
    "codigo": "C004916",
    "razaoSocial": "VITORIO ROSSINI NETO",
    "cnpj": "18.033.840/0001-16"
  },
  {
    "codigo": "C003493",
    "razaoSocial": "MENDES E BARCELOS LTDA",
    "cnpj": "80.737.695/0001-28"
  },
  {
    "codigo": "C004208",
    "razaoSocial": "Rio Grande Ferramentas Comercio e Importacao LTDA",
    "cnpj": "10.891.490/0001-17"
  },
  {
    "codigo": "C002290",
    "razaoSocial": "HERBERT SANTOS FORNAZIER",
    "cnpj": "33.897.085/0001-01"
  },
  {
    "codigo": "C004906",
    "razaoSocial": "VILMAR ROQUE STRAPAZZON",
    "cnpj": "81.518.722/0001-34"
  },
  {
    "codigo": "C010877",
    "razaoSocial": "BEATRIZ LEMES DE CASTRO",
    "cnpj": "64.335.930/0001-89"
  },
  {
    "codigo": "C002469",
    "razaoSocial": "ISAIR MAZZI",
    "cnpj": "61.837.733/0001-70"
  },
  {
    "codigo": "C002892",
    "razaoSocial": "KS FERRAMENTAS LTDA",
    "cnpj": "10.228.992/0001-62"
  },
  {
    "codigo": "C003868",
    "razaoSocial": "PAULO C. LIMA",
    "cnpj": "21.203.201/0001-66"
  },
  {
    "codigo": "C002843",
    "razaoSocial": "JW COMPRESSORES LTDA",
    "cnpj": "52.475.991/0001-62"
  },
  {
    "codigo": "C005029",
    "razaoSocial": "WYLLIS COMERCIO E ASSISTENCIA TECNICA DE FERRAMENA",
    "cnpj": "05.749.749/0001-50"
  },
  {
    "codigo": "C002643",
    "razaoSocial": "JGS FERRAMENTAS E EQUIPAMENTOS LTDA",
    "cnpj": "05.341.610/0001-72"
  },
  {
    "codigo": "C000879",
    "razaoSocial": "BORGES SOLUCOES EM AR COMPRIMIDO EIRELI",
    "cnpj": "31.008.262/0001-26"
  },
  {
    "codigo": "C010963",
    "razaoSocial": "MIORANDO SOLUCOES LTDA",
    "cnpj": "23.901.494/0001-80"
  },
  {
    "codigo": "C004981",
    "razaoSocial": "WEIGEL MANUTENCAO E COMERCIO DE PECAS E EQUIPAMENA",
    "cnpj": "43.271.427/0001-37"
  },
  {
    "codigo": "C001786",
    "razaoSocial": "ENGENORMA AUTOMACAO INDUSTRIAL LTDA",
    "cnpj": "23.437.075/0001-30"
  },
  {
    "codigo": "C000196",
    "razaoSocial": "55.586.922 JOSIEL ALMEIDA GAVIRAGHI",
    "cnpj": "55.586.922/0001-14"
  },
  {
    "codigo": "C010613",
    "razaoSocial": "RETROFITI SOLUCOES INDUSTRIAIS LTDA",
    "cnpj": "17.643.681/0001-09"
  },
  {
    "codigo": "C002340",
    "razaoSocial": "HIDROAR SOLUCOES PNEUMATICAS LTDA",
    "cnpj": "12.995.398/0001-22"
  },
  {
    "codigo": "C001282",
    "razaoSocial": "COMPRESSUL COMPRESSORES LTDA",
    "cnpj": "78.429.222/0001-11"
  },
  {
    "codigo": "C010109",
    "razaoSocial": "VIZIMAQ MAQUINAS E EQUIPAMENTOS INDUSTRIAIS - EIRI",
    "cnpj": "21.973.701/0001-87"
  },
  {
    "codigo": "C002621",
    "razaoSocial": "JEFERSON TAVARES ME",
    "cnpj": "15.399.695/0001-01"
  },
  {
    "codigo": "C004731",
    "razaoSocial": "TOPSUL COMPRESSORES LTDA",
    "cnpj": "39.639.827/0001-85"
  },
  {
    "codigo": "C011225",
    "razaoSocial": "SB AUTOMACAO E SOLUCOES LTDA",
    "cnpj": "04.010.592/0001-83"
  },
  {
    "codigo": "C004444",
    "razaoSocial": "SELMAK ASSISTÊNCIA E AUTOMAÇÃO INDUSTRIAL LTDA",
    "cnpj": "00.119.712/0001-24"
  },
  {
    "codigo": "C002072",
    "razaoSocial": "FUSOMAQ - COMPRESSORES LTDA",
    "cnpj": "55.623.285/0001-09"
  },
  {
    "codigo": "C000707",
    "razaoSocial": "ARCOMP COMPRESSORES E ELEVADORES LTDA",
    "cnpj": "21.490.742/0001-12"
  },
  {
    "codigo": "C002621",
    "razaoSocial": "JEFERSON TAVARES ME",
    "cnpj": "15.399.695/0001-01"
  },
  {
    "codigo": "C004027",
    "razaoSocial": "R GOMES DE OLIVEIRA CONSTRUTORA LTDA",
    "cnpj": "11.308.480/0001-79"
  },
  {
    "codigo": "C000740",
    "razaoSocial": "ARSISTEQ SISTEMAS MANUTENCOES LOCACOES E EQUIPAME",
    "cnpj": "31.128.767/0001-24"
  },
  {
    "codigo": "C004593",
    "razaoSocial": "STROKE COMERCIO DE EQUIP. PNEUMATICOS E HIDRALICOS",
    "cnpj": "05.636.464/0001-02"
  },
  {
    "codigo": "C000041",
    "razaoSocial": "31.767.065 EVERTON SIEWERT NASCIMENTO",
    "cnpj": "31.767.065/0001-90"
  },
  {
    "codigo": "C000743",
    "razaoSocial": "ARTEC COMPRESSORES E BOMBAS LTDA",
    "cnpj": "21.595.328/0001-78"
  },
  {
    "codigo": "C001580",
    "razaoSocial": "EDER STACHOWSKI SELINGER",
    "cnpj": "30.741.344/0001-12"
  },
  {
    "codigo": "C002154",
    "razaoSocial": "GERTEC ENGENHARIA E SOLUCOES INDUSTRIAIS",
    "cnpj": "74.169.897/0001-18"
  },
  {
    "codigo": "C001388",
    "razaoSocial": "Daiane Beatriz Kuhn Nunes",
    "cnpj": "24.740.807/0001-29"
  },
  {
    "codigo": "C004647",
    "razaoSocial": "TEC PRESS COMPRESSORES E SERVIÇOS LTDA",
    "cnpj": "42.540.345/0001-88"
  },
  {
    "codigo": "C001524",
    "razaoSocial": "DOTTO E CIA LTDA",
    "cnpj": "07.155.422/0001-85"
  },
  {
    "codigo": "C003145",
    "razaoSocial": "M C FREIMUTH LTDA",
    "cnpj": "44.290.801/0001-04"
  },
  {
    "codigo": "C011473",
    "razaoSocial": "TOPINST COMERCIO E INSTALACOES DE COMPRESSORES LTDA",
    "cnpj": "63.758.069/0001-07"
  },
  {
    "codigo": "C003295",
    "razaoSocial": "MARCIO AQUILES PINTO",
    "cnpj": "23.918.763/0001-11"
  },
  {
    "codigo": "C004024",
    "razaoSocial": "R D COMPRESSORES EIRELI",
    "cnpj": "25.508.893/0001-01"
  },
  {
    "codigo": "C000457",
    "razaoSocial": "AIRTECNO EQUIPAMENTOS INDUSTRIAIS LTDA",
    "cnpj": "51.810.673/0001-48"
  },
  {
    "codigo": "C004649",
    "razaoSocial": "TECAR AR COMPRIMIDO LTDA - ME EPP",
    "cnpj": "12.628.179/0001-05"
  },
  {
    "codigo": "C000018",
    "razaoSocial": "18.183.649 JOSE EDSON DOS SANTOS",
    "cnpj": "8.183.649/0001-50"
  },
  {
    "codigo": "C004109",
    "razaoSocial": "RDS ASSISTENCIA TECNICA E VENDA DE COMPRESSORES LT",
    "cnpj": "57.764.306/0001-31"
  },
  {
    "codigo": "C003618",
    "razaoSocial": "MS SOLUCOES INDUSTRIAIS LTDA",
    "cnpj": "45.828.261/0001-32"
  },
  {
    "codigo": "C003855",
    "razaoSocial": "PANIR EQUIPAMENTOS LTDA",
    "cnpj": "03.428.619/0001-90"
  },
  {
    "codigo": "C003445",
    "razaoSocial": "MAY COMPRESSORES EIRELI - EPP",
    "cnpj": "13.205.867/0001-25"
  },
  {
    "codigo": "C004239",
    "razaoSocial": "ROBERTO MACHADO RUSYCKI LTDA",
    "cnpj": "49.961.961/0001-51"
  },
  {
    "codigo": "C010354",
    "razaoSocial": "REDE TUBULACOES E CONEXOES LTDA",
    "cnpj": "18.686.660/0001-33"
  },
  {
    "codigo": "C002537",
    "razaoSocial": "J. FIGUEIRAS",
    "cnpj": "33.553.382/0001-30"
  },
  {
    "codigo": "C004156",
    "razaoSocial": "RENATA CRISTINA MARTINS NAVIA",
    "cnpj": "29.012.601/0001-04"
  },
  {
    "codigo": "C003160",
    "razaoSocial": "M R COMPRESSORES LTDA",
    "cnpj": "07.382.890/0001-92"
  },
  {
    "codigo": "C010629",
    "razaoSocial": "65.473.215 DOUGLAS EDUARDO DO NASCIMENTO",
    "cnpj": "65.473.215/0001-75"
  },
  {
    "codigo": "C0001271",
    "razaoSocial": "COMPREMACH SOLUCOES EM AR COMPRIMIDO LTDA.",
    "cnpj": "57.030.514/0001-07"
  },
  {
    "codigo": "C000041",
    "razaoSocial": "31.767.065 EVERTON SIEWERT NASCIMENTO",
    "cnpj": "31.767.065/0001-90"
  },
  {
    "codigo": "C000235",
    "razaoSocial": "59.758.269 EDIO BAUER",
    "cnpj": "59.758.269/0001-84"
  },
  {
    "codigo": "C004251",
    "razaoSocial": "ROBSON IZAQUEU PRESTES MEDEIROS",
    "cnpj": "43.967.194/0001-01"
  },
  {
    "codigo": "C001883",
    "razaoSocial": "FABIO FELIPE DUARTE 003757449-32 MEI",
    "cnpj": "27.109.906/0001-03"
  },
  {
    "codigo": "C002025",
    "razaoSocial": "FRANCIELI DALLASTRA 07789381903",
    "cnpj": "29.731.915/0001-59"
  },
  {
    "codigo": "C001278",
    "razaoSocial": "COMPRESSORES MAIA LTDA",
    "cnpj": "47.294.390/0001-13"
  },
  {
    "codigo": "C004006",
    "razaoSocial": "PUFF COMPRESSORES E EQUIPAMENTOS LTDA",
    "cnpj": "30.801.801/0001-17"
  },
  {
    "codigo": "C003692",
    "razaoSocial": "NERCI DE SOUZA JULIANI 06843621988",
    "cnpj": "25.305.309/0001-10"
  },
  {
    "codigo": "C001485",
    "razaoSocial": "DILLTEC INSTALAÇÕES ELÉTRICAS",
    "cnpj": "23.922.722/0001-07"
  },
  {
    "codigo": "C010422",
    "razaoSocial": "CELSO ANTONIO MAUAT",
    "cnpj": "27.545.083/0001-50"
  },
  {
    "codigo": "C001622",
    "razaoSocial": "EDUARDO HENRIQUE CLARO LTDA",
    "cnpj": "58.841.608/0001-29"
  },
  {
    "codigo": "C004122",
    "razaoSocial": "RECOMAQ MAQUINAS E FERRAMENTAS",
    "cnpj": "75.103.804/0001-15"
  },
  {
    "codigo": "C010431",
    "razaoSocial": "25.012.573 MARCOS ADELAR NOSCHANG",
    "cnpj": "25.012.573/0001-66"
  },
  {
    "codigo": "C000726",
    "razaoSocial": "ARMAX COMÉRCIO DE PEÇAS LTDA",
    "cnpj": "03.297.377/0001-42"
  },
  {
    "codigo": "C002002",
    "razaoSocial": "FLP COMPRESSORES LTDA",
    "cnpj": "44.907.493/0001-13"
  },
  {
    "codigo": "C002867",
    "razaoSocial": "KB COMERCIAL PNEUMATICA LTDA",
    "cnpj": "32.758.014/0001-65"
  },
  {
    "codigo": "C001048",
    "razaoSocial": "CASA DO GARIMPEIRO CLARON LTDA - EPP",
    "cnpj": "05.561.247/0001-09"
  },
  {
    "codigo": "C001355",
    "razaoSocial": "AIR SOLUTIONS COMPRESSORES LTD",
    "cnpj": "43.741.884/0001-48"
  },
  {
    "codigo": "C003928",
    "razaoSocial": "PIA DOS COMPRESSORES LTDA",
    "cnpj": "41.944.826/0001-96"
  },
  {
    "codigo": "C010264",
    "razaoSocial": "SULTECH AUTOMACAO LTDA",
    "cnpj": "64.595.607/0001-44"
  },
  {
    "codigo": "C004750",
    "razaoSocial": "TREEFER COMERCIO E MANUTENCAO DE MAQUINAS E FERRAM",
    "cnpj": "56.707.963/0001-84"
  },
  {
    "codigo": "C004024",
    "razaoSocial": "R D COMPRESSORES EIRELI",
    "cnpj": "C004024"
  },
  {
    "codigo": "C004878",
    "razaoSocial": "VERSÁTIL COMÉRCIO E DISTRIBUIDORA DE AÇO",
    "cnpj": "33.070.025/0001-10"
  },
  {
    "codigo": "C004546",
    "razaoSocial": "TECNOLOGIA HIDROELETROPNEUMÁTICOS LTDA",
    "cnpj": "08.879.591/0001-20"
  },
  {
    "codigo": "C000130",
    "razaoSocial": "51.457.685 ANTONIO CARLOS MARIAN",
    "cnpj": "51.457.685/0001-30"
  },
  {
    "codigo": "C002260",
    "razaoSocial": "GX EQUIPAMENTOS INDUSTRIAIS EIRELIE",
    "cnpj": "27.905.225/0001-43"
  },
  {
    "codigo": "C004337",
    "razaoSocial": "RS INSTALACOES ELETRICAS & AUTOMACAO LTDA",
    "cnpj": "39.442.107/0001-25"
  },
  {
    "codigo": "C000221",
    "razaoSocial": "58.769.098 ALEX SANDRO DE AMORIM",
    "cnpj": "58.769.098/0001-26"
  },
  {
    "codigo": "C003618",
    "razaoSocial": "MS SOLUCOES INDUSTRIAIS LTDA",
    "cnpj": "45.828.261/0001-32"
  },
  {
    "codigo": "C010818",
    "razaoSocial": "MHS SOLUÇOES",
    "cnpj": "11.065.314/0001-99"
  },
  {
    "codigo": "C001918",
    "razaoSocial": "SOLUCIONAR",
    "cnpj": "43.459.651/0001-57"
  },
  {
    "codigo": "C000750",
    "razaoSocial": "ARTECSUL LTDA",
    "cnpj": "16.692.074/0001-76"
  },
  {
    "codigo": "C001225",
    "razaoSocial": "CASA DAS MANGUEIRAS",
    "cnpj": "01.458.655/0001-70"
  },
  {
    "codigo": "C003887",
    "razaoSocial": "Inflar Redes de Ar e Compressores LTDA",
    "cnpj": "24.551.547/0001-43"
  },
  {
    "codigo": "C003295",
    "razaoSocial": "MP INSTALACOES ELETRICAS E REFRIGER",
    "cnpj": ""
  },
  {
    "codigo": "C004764",
    "razaoSocial": "UNIAR PNEUMATICA LTDA",
    "cnpj": "37.365.114/0001-45"
  },
  {
    "codigo": "C000879",
    "razaoSocial": "BORGES SOLUCOES EM AR COMPRIMIDO",
    "cnpj": "31.008.262/0001-26"
  },
  {
    "codigo": "C011474",
    "razaoSocial": "57.305.809 MARIZA MORAES ROSA DOS SANTOS",
    "cnpj": "57.305.809/0001-49"
  },
  {
    "codigo": "C011173",
    "razaoSocial": "58.635.945 CARLOS ALBERTO FERREIRA",
    "cnpj": "58.635.945/0001-60"
  },
  {
    "codigo": "C003421",
    "razaoSocial": "MAURI CUNHA",
    "cnpj": "31.874.708/0001-03"
  }
]

const RICARDO: LinhaSimples[] = [
  {
    "codigo": "C003158",
    "razaoSocial": "M P I MANUTENCAO DE EQUIPAMENTOS HIDRAULICOS ES"
  },
  {
    "codigo": "C000395",
    "razaoSocial": "AGILE ELETRICA E COMPRESSORES LTDA"
  },
  {
    "codigo": "C011123",
    "razaoSocial": "SARTINI MIROTTI COMPRESSORES LTDA"
  },
  {
    "codigo": "C001623",
    "razaoSocial": "EDUARDO HENRIQUE SIMIM 71479961604"
  },
  {
    "codigo": "C010178",
    "razaoSocial": "VITORIA COMPRESSORES LTDA"
  },
  {
    "codigo": "C003158",
    "razaoSocial": "M P I MANUTENCAO DE EQUIPAMENTOS HIDRAULICOS ES"
  },
  {
    "codigo": "C000395",
    "razaoSocial": "AGILE ELETRICA E COMPRESSORES LTDA"
  },
  {
    "codigo": "C011123",
    "razaoSocial": "SARTINI MIROTTI COMPRESSORES LTDA"
  },
  {
    "codigo": "C001623",
    "razaoSocial": "EDUARDO HENRIQUE SIMIM 71479961604"
  },
  {
    "codigo": "C010178",
    "razaoSocial": "VITORIA COMPRESSORES LTDA"
  },
  {
    "codigo": "C003723",
    "razaoSocial": "NIVALDO DE GÓES JUNIOR"
  },
  {
    "codigo": "C011466",
    "razaoSocial": "ACOFER PARAFUSOS E FERRAMENTAS LTDA"
  },
  {
    "codigo": "C011465",
    "razaoSocial": "H M Comercio Manutencao Locacao de Ferramentas e Obras de Alvenaria LTDA"
  },
  {
    "codigo": "C011181",
    "razaoSocial": "N.C.C. 1701 EQUIPAMENTOS INDUSTRIAIS LTDA"
  },
  {
    "codigo": "C002052",
    "razaoSocial": "SMARTEC COMPRESSORES LTDA"
  },
  {
    "codigo": "C010951",
    "razaoSocial": "AFERE ENGENHARIA CLINICA E REFRIGERACAO LTDA"
  },
  {
    "codigo": "C001338",
    "razaoSocial": "CORRÊA INSTALAÇÃO E MANUTENÇÃO"
  },
  {
    "codigo": "C000113",
    "razaoSocial": "50.275.862 GLAUCIO DE MOURA AVELAR"
  },
  {
    "codigo": "C004742",
    "razaoSocial": "TOTAL FLEX HIDRAULICA LTDA"
  },
  {
    "codigo": "C011415",
    "razaoSocial": "VALDEIR RIBEIRO MOURA SERVICOS LTDA"
  },
  {
    "codigo": "C004272",
    "razaoSocial": "RODRIGO SORIANO LOPES"
  },
  {
    "codigo": "C010951",
    "razaoSocial": "AFERE ENGENHARIA CLINICA E REFRIGERACAO LTDA"
  },
  {
    "codigo": "C002052",
    "razaoSocial": "SMARTEC COMPRESSORES LTDA"
  },
  {
    "codigo": "C004131",
    "razaoSocial": "REGES ANTONIO DA SILVA"
  },
  {
    "codigo": "C001599",
    "razaoSocial": "EDMAQ VEDACOES E MANUTENCOES INDUSTRIAIS LTDA"
  },
  {
    "codigo": "C010680",
    "razaoSocial": "ONE EQUIPAMENTOS E SERVICOS LTDA"
  },
  {
    "codigo": "C010353",
    "razaoSocial": "63.921.844 WAGNER LUCIANO DIAS DE SOUZA"
  },
  {
    "codigo": "C000565",
    "razaoSocial": "AMJ COMÉRCIO DE EQUIPAMENTOS INDUSTRIAIS LTDA"
  },
  {
    "codigo": "C004805",
    "razaoSocial": "VALDEIR RIBEIRO MOURA"
  },
  {
    "codigo": "C003158",
    "razaoSocial": "M P I MANUTENCAO DE EQUIPAMENTOS HIDRAULICOS ES"
  },
  {
    "codigo": "C002265",
    "razaoSocial": "H.A.S COMPRESSORES E FERRAMENTAS LTDA"
  },
  {
    "codigo": "C004755",
    "razaoSocial": "TRÊS FASES LTDA"
  },
  {
    "codigo": "C002403",
    "razaoSocial": "IDEAL MOTORES LTDA"
  },
  {
    "codigo": "C004634",
    "razaoSocial": "TAQUARI INDUSTRIA E COMERCIO DE PAPEIS LTDA"
  },
  {
    "codigo": "C004407",
    "razaoSocial": "SANTIAGO MANUTENÇOES ELETRICAS"
  },
  {
    "codigo": "C001440",
    "razaoSocial": "DEIWSON RODRIGO NUNES 33114602860"
  },
  {
    "codigo": "C002273",
    "razaoSocial": "HAUTOMA COMERCIAL E TECNICA LTDA"
  },
  {
    "codigo": "C003595",
    "razaoSocial": "MOTORES LIRA K - LTDA"
  },
  {
    "codigo": "C002103",
    "razaoSocial": "GABRIEL MOURA FERREIRA"
  }
]

const NOME_VENDEDOR_LUANA = 'LUANA APARECIDA'
const NOME_VENDEDOR_YASMIN_SALLES = 'YASMIN SALLES'
const NOME_VENDEDOR_RICARDO = 'RICARDO'

interface LinhaNormalizada {
  codigo: string
  codigoAntigo?: string
  razaoSocial: string
  estado?: string
  regiao: Regiao
  cnpj?: string
  observacoes?: string
}

// Estado às vezes vem com anotação colada ("PR -C000133", "SC - Maiollo",
// "BA- CF") — fica só a sigla de 2 letras.
function limparEstado(raw: string): string {
  const m = raw.trim().toUpperCase().match(/^([A-Z]{2})/)
  return m ? m[1] : raw.trim().toUpperCase()
}

function pareceCnpj(texto: string): boolean {
  return /^[\d.\/-]+$/.test(texto.trim())
}

// Dedup preferindo a ocorrência com nome de verdade (achado real na planilha
// da Luana: um cliente duplicado onde a 1ª linha tinha o CNPJ colado no
// campo de nome por engano, e a 2ª linha tinha o nome certo).
function dedupPreferindoNomeReal(linhas: LinhaNormalizada[]): { unicas: LinhaNormalizada[]; duplicadas: string[] } {
  const porCodigo = new Map<string, LinhaNormalizada>()
  const duplicadas: string[] = []
  for (const linha of linhas) {
    const existente = porCodigo.get(linha.codigo)
    if (!existente) {
      porCodigo.set(linha.codigo, linha)
      continue
    }
    duplicadas.push(`${linha.codigo} — ${linha.razaoSocial}`)
    if (pareceCnpj(existente.razaoSocial) && !pareceCnpj(linha.razaoSocial)) {
      porCodigo.set(linha.codigo, linha)
    }
  }
  return { unicas: [...porCodigo.values()], duplicadas }
}

interface ClienteExistente {
  id: number
  codigo: string
  cnpj: string | null
  vendedorAtualId: number | null
  vendedorAtual: { name: string } | null
}

interface ResultadoLote {
  vendedor: string
  criados: number
  atribuidos: number
  jaEram: number
  vazias: number
  duplicadas: string[]
  cnpjInvalidos: string[]
  conflitos: string[]
  codigoDivergente: string[]
}

async function importarLote(
  empresaId: number,
  adminId: number,
  nomeVendedorCrm: string,
  linhasRaw: LinhaNormalizada[],
  existentePorCodigo: Map<string, ClienteExistente>,
  existentePorCnpj: Map<string, ClienteExistente>,
  vendedores: { id: number; name: string }[]
): Promise<ResultadoLote> {
  const vendedor = vendedores.find((v) => v.name.trim().toUpperCase() === nomeVendedorCrm)
  if (!vendedor) {
    console.error(`❌ Vendedor "${nomeVendedorCrm}" não encontrado. Vendedores ativos na Odin Tubos e Conexões:`)
    for (const v of vendedores) console.error('   -', v.name)
    throw new Error(`Aborting: vendedor "${nomeVendedorCrm}" não encontrado`)
  }

  // Linhas em branco (sem nome nem CNPJ) — lixo de planilha, não viram
  // cliente nenhum.
  const semLixo = linhasRaw.filter((l) => l.razaoSocial.trim() || l.cnpj)
  const vazias = linhasRaw.length - semLixo.length

  const { unicas, duplicadas } = dedupPreferindoNomeReal(semLixo)

  let criados = 0
  let atribuidos = 0
  let jaEram = 0
  const conflitos: string[] = []
  const cnpjInvalidos: string[] = []
  const codigoDivergente: string[] = []

  for (const linha of unicas) {
    const cnpjLimpo = linha.cnpj ? limparCnpj(linha.cnpj) : ''
    // O "código" da planilha às vezes não bate com o código já cadastrado
    // pro MESMO cliente (achado real: SAP/METHOD renumerou vários — o CNPJ
    // é o identificador confiável aqui). Por isso o CNPJ é checado primeiro;
    // o código só decide quando não tem CNPJ pra comparar (caso do Ricardo).
    const existente = (cnpjLimpo.length === 14 ? existentePorCnpj.get(cnpjLimpo) : undefined) ?? existentePorCodigo.get(linha.codigo)
    if (existente) {
      if (existente.codigo !== linha.codigo) {
        codigoDivergente.push(`${linha.razaoSocial} — planilha: ${linha.codigo}, sistema: ${existente.codigo}`)
      }
      if (existente.vendedorAtualId === vendedor.id) {
        jaEram++
      } else if (existente.vendedorAtualId === null) {
        await transferirCliente(existente.id, vendedor.id, adminId)
        atribuidos++
      } else {
        conflitos.push(`${linha.codigo} — ${linha.razaoSocial} (hoje é de ${existente.vendedorAtual?.name ?? '?'})`)
      }
      continue
    }

    let cnpj: string | undefined
    if (linha.cnpj) {
      cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined
      if (!cnpj) cnpjInvalidos.push(`${linha.codigo} — ${linha.razaoSocial} (CNPJ na lista: ${linha.cnpj})`)
    }

    const result = await db.insert(clientes).values({
      empresaId,
      razaoSocial: linha.razaoSocial,
      cnpj,
      codigo: linha.codigo,
      codigoAntigo: linha.codigoAntigo,
      regiao: linha.regiao,
      estado: linha.estado,
      observacoes: linha.observacoes,
      vendedorAtualId: vendedor.id,
    })
    const clienteId = Number(result.lastInsertRowid)

    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedor.id })
    await db.insert(funilMensal).values({ clienteId, vendedorId: vendedor.id, mesReferencia: mesReferenciaAtual() })
    criados++

    // Mantém os mapas atualizados — evita criar duplicado se o mesmo
    // cliente aparecer de novo mais adiante (entre os 3 lotes).
    const novo: ClienteExistente = { id: clienteId, codigo: linha.codigo, cnpj: cnpj ?? null, vendedorAtualId: vendedor.id, vendedorAtual: { name: vendedor.name } }
    existentePorCodigo.set(linha.codigo, novo)
    if (cnpj) existentePorCnpj.set(cnpj, novo)
  }

  return { vendedor: vendedor.name, criados, atribuidos, jaEram, vazias, duplicadas, cnpjInvalidos, conflitos, codigoDivergente }
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada (slug "odin-tubos")')

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })

  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Nenhum admin encontrado na Odin Tubos e Conexões pra registrar as transferências')

  const existentes = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresa.id),
    columns: { id: true, codigo: true, cnpj: true, vendedorAtualId: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  const existentePorCodigo = new Map(existentes.map((c) => [c.codigo, c]))
  const existentePorCnpj = new Map(existentes.filter((c) => c.cnpj).map((c) => [c.cnpj as string, c]))

  const luanaNormalizada: LinhaNormalizada[] = LUANA.map((l) => {
    const estado = limparEstado(l.estado)
    const regiao = regiaoPorUf(estado)
    if (!regiao) throw new Error(`[Luana] Estado sem região mapeada: "${l.estado}" (cliente ${l.codigo})`)
    return { codigo: l.codigo, codigoAntigo: l.codigoAntigo, razaoSocial: l.razaoSocial, estado, regiao, cnpj: l.cnpj, observacoes: l.observacoes }
  })
  const yasminSallesNormalizada: LinhaNormalizada[] = YASMIN_SALLES.map((l) => ({
    codigo: l.codigo,
    razaoSocial: l.razaoSocial,
    regiao: 'sul',
    cnpj: l.cnpj,
  }))
  const ricardoNormalizada: LinhaNormalizada[] = RICARDO.map((l) => ({
    codigo: l.codigo,
    razaoSocial: l.razaoSocial,
    regiao: 'sudeste',
  }))

  const resultados = [
    await importarLote(empresa.id, admin.id, NOME_VENDEDOR_LUANA, luanaNormalizada, existentePorCodigo, existentePorCnpj, vendedores),
    await importarLote(empresa.id, admin.id, NOME_VENDEDOR_YASMIN_SALLES, yasminSallesNormalizada, existentePorCodigo, existentePorCnpj, vendedores),
    await importarLote(empresa.id, admin.id, NOME_VENDEDOR_RICARDO, ricardoNormalizada, existentePorCodigo, existentePorCnpj, vendedores),
  ]

  for (const r of resultados) {
    console.log(`\n📊 Resumo da importação — ${r.vendedor}:`)
    console.log('  Clientes criados:', r.criados)
    console.log('  Já existiam sem vendedor, atribuídos agora:', r.atribuidos)
    console.log('  Já eram dele(a) (sem mudança):', r.jaEram)
    console.log('  Linhas em branco na planilha (ignoradas):', r.vazias)
    console.log(`  Duplicados dentro da lista (${r.duplicadas.length}):`)
    for (const item of r.duplicadas) console.log('   -', item)
    console.log(`  Sem CNPJ válido (${r.cnpjInvalidos.length}):`)
    for (const item of r.cnpjInvalidos) console.log('   -', item)
    console.log(`  Conflitos — já de OUTRO vendedor, não mexidos (${r.conflitos.length}):`)
    for (const item of r.conflitos) console.log('   -', item)
    console.log(`  Código da planilha diferente do código já cadastrado (encontrado por CNPJ, código não foi alterado) (${r.codigoDivergente.length}):`)
    for (const item of r.codigoDivergente) console.log('   -', item)
  }
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})

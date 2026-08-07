// ⚠️ TEMPORÁRIO — cópia de server/scripts/importar-carteira-karinna-odin-tubos.ts
// só pra existir dentro de src/ (compilado pro dist/ da imagem Docker) e
// rodar em produção via `docker compose exec backend node dist/scriptsOnetime/importarCarteiraKarinna.js`,
// já que server/scripts/ não entra na imagem. Excluir este arquivo (e este
// diretório) depois de confirmar que rodou certo em produção — a versão de
// registro histórico permanente é a de server/scripts/.
//
// Script avulso — importa os 3 PDFs "Carteira de clientes Karinna - PR/SC/RS"
// (~/Downloads, mensagem do João de 07/08/2026) pra empresa Odin Tubos e
// Conexões (slug 'odin-tubos'), todos direto na carteira da KARINNA.
//
// Diferente da lista da Yasmin, aqui o estado é conhecido por planilha (cada
// PDF é de um estado só) — região sai direto de `regiaoPorUf`, sem precisar
// perguntar (os três são 'sul': PR, SC, RS).
//
// Mesma lógica de atribuição da importação da Yasmin: código que já existe
// sem vendedor -> atribui à Karinna via transferirCliente (preserva
// histórico/card do mês); código já da Karinna -> não mexe; código de OUTRO
// vendedor -> não mexe, fica logado como conflito pro João decidir à mão.
//
// Algumas linhas da SC/RS trazem uma observação solta na planilha ("lista de
// visita", "trabalha com a linha verde") — vira `observacoes` só nos
// clientes NOVOS (não sobrescreve observação de cliente que já existia).
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../db/schema.js'
import { cnpjValido, limparCnpj } from '../lib/cnpj.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { regiaoPorUf } from '../lib/regiao.js'
import { transferirCliente } from '../router/carteira.js'

const NOME_VENDEDOR = 'KARINNA'

// Colado verbatim dos PDFs (colunas: Código Portal, Código Method, Razão
// Social, CNPJ, observação opcional no final).
const PR = `
C001740    4105    Elivel - Mecanica para Veiculos    02.013.198/0001-73
C001490    512    Dinamica Manutencoes Industriais LTDA    12.838.771/0001-31
C002212    2151    Gold Ar Compressores LTDA    44.445.786/0001-26
C010128    5227 / 5747    Coneval Comercio e Manutenção    26.090.097/0001-64
C004729    2744    Topflow Tubos e Conexões    22.780.756/0001-33
C002020    4874 / 5154    Fortmaq Comercio de Maquinas    46.655.107/0001-79
C000808    4402 / 4737    Automaq Manutencoes e Equipamentos    56.042.776/0001-29
C001072    3714    Cavitech Automação Industrial    39.606.620/0001-04
C001442    4958 / 5266    Dejavu Engenharia LTDA    17.369.374/0001-81
C010136    Hidrautica Automação Industrial LTDA    65.255.950/0001-02
C002600    63    JB Gonsalves e Morales    02.610.559/0001-69
C004180    1241    Revipostos Comercio de Equip.    77.410.538/0001-07
C000351    4812 / 5097    Acquadel LTDA    48.407.161/0001-20
C002090    4019    G. L. Bonirski    11.434.794/0001-18
C002470    5145 / 5581    Isaque Bruch Materiais    26.746.616/0001-08
C003384    4570 / 4248    Mario Jorge Caobianco    40.536.957/0001-71
C003380    1271    Marinho Compressores LTDA    20.325.424/0001-33
C004743    1387    TR Comercio e Manutenção de Compressores    10.235.350/0001-90
C003539    620    MHP Mangueiras Hidraulicas    19.675.281/0001-00
C000101    3559    Luiz Henrique Correa    49.253.533/0001-74
C003100    4188 / 4568    Luis Fernando dos Reis    16.723.830/0001-87
C000552    2392    AM Mecanica Hidraulica LTDA    08.997.460/0001-48
C002071    4397 / 4730    Fusoair Automação LTDA    36.110.234/0001-39
C010140    5281 / 5845    Fusoair Compressores Maringa    58.016.844/0001-00
C003090    4699 / 4983    Lugo Pneumatica e Hidraulica    40.750.832/0001-40
C004943    4814 / 5099    W T M Dutra Instalação e Manutenção    52.755.479/0001-70
C001147    1784    Clarice Grolli    19.346.490/0001-00
C000240    4881 / 5160    Cleiton Marcelo Niclote    59.978.048/0001-11
C004927    4984 / 5316    VMA Manutenção e Automação    10.569.334/0001-34
C003034    4735 / 5017    Lourieverson Antonio    10.604.301/0001-88
C000125    3749    Edgar Mendonca de Sousa    50.823.094/0001-77
C000626    996    Antoninho J. da Veiga    10.569.681/0001-67
C001302    5165 / 5484    Conectair Comercio de Componentes    62.236.009/0001-53
C004601    4882 / 5161    Sul - Air Maquinas e Equipamentos    39.659.952/0001-57
C000603    5169 / 5620    Andrea de Fatima Bucola    59.544.315/0001-42
C004277    1889    Rogerio de Carvalho Junior LTDA    37.480.278/0001-13
C010280    5204 / 5701    Jefferson Luis de Lima    64.232.505/0001-64
C003510    1345    Messias Claro Junior    23.288.270/0001-45
C002858    1751    Karina Dias Pontes    39.855.637/0001-03
C003741    2187    Nova JK Compressores    38.179.646/0001-50
C002189    4085    GL Soluções Mecanicas    37.598.917/0001-40
C004524    4745 / 5028    Smart Hoses Comercio    49.835.866/0001-01
C002141    4343 / 4708    Geraldino Gelinski    48.311.324/0001-77
C000947    1027    C K de Souza    10.755.120/0001-52
C001691    1260    Eletrobarros - Materias Eletricos    82.462.250/0001-08
C006570    Fernando Munhoz Ribeiro    47.277.605/0001-98
C009718    1015    Bibig Contatto - Equipamentos    05.143.214/0001-30
C010017    1234 / 5836    Queiroz Casarin Comercio    07.243.856/0001-37
C002013    3801    Fort Automação Industrial    15.135.136/0001-86
C000789    4442/4514    Atualflex Comercio de Mangueiras    07.533.058/0001-40
C004323    2210    Rossetim Compressores    78.369.246/0001-22
C002329    2222    Hidrauq Brasil Comercio    14.080.494/0001-76
C004491    2261    Sifamaq Mangueiras Peças    02.001.435/0001-86
C011394    5316 / 5894    Valvicon Valvulas e Conexões    11.225.775/0001-81
C002937    1803    Leandro Alex Braun    21.056.727/0001-60
C000298    1928    A L Gomes da Costa    04.556.881/0001-82
C003009    1740    Line Ar Comercio e Manutenção    41.516.273/0001-70
C002962    1038    Leonardo Dubinski dos Santos    22.862.968/0001-60
C005047    3429    Édson Mosele Junior    48.035.052/0001-20
C003195    1929    Machado & Tortola    82.417.387/0001-40
C004857    2083    Vedana & Vedana    00.424.817/0001-97
C000363    3802    ADF Compressores LTDA    49.557.923/0001-38
C010571    5226 / 5746    Andrade Industria e Comercio    11.659.039/0001-31
C002088    5170 / 5622    G&T Steamline LTDA    61.385.833/0001-02
C000787    1222    Atlântico Sul Compressores    27.891.813/0001-75
C003997    4571/4600    Promathip Hidraulica e Pneumatica    38.024.262/0001-69
C000049    5308    Everton Giovanelli Balan    34.448.086/0001-31
C000814    2045    Azes Automação LTDA    09.554.001/0001-52
C003675    3886    Natanael Batista dos Santos    39.596.694/0001-07
C000375    2086    Adriano Henrique da Fonseca    12.252.287/0001-26
C001286    4473 / 4805    Comprime Comercio e Manutenção    23.480.972/0001-26
C010319    Lilian Christensen Bianchi    63.757.379/0001-07
C010772    Astral Curitiba Manutenção    24.068.220/0001-15
C010985    Guilherme Eduardo Dias Senna    47.006.356/0001-04
C001584    1512    Edevanio Barboza Eletrica    20.853.066/0001-31
C000523    2783    Alfredo Blan dos Santos    00.827.449/0001-28
C004586    2194    Stavinski Compressores    32.244.549/0001-18
C000331    1174    A.P. Dal Bó Comércio    30.658.699/0001-42
C009701    2380    Anéis RCS Retentores    81.062.952/0001-31
C001457    3908    Devanir Jose Cambito    33.510.360/0001-92
C000488    3894    Alessandro Bueno Compressores    30.171.596/0001-53
`

const SC = `
C001324    2829    Consuar Soluções em Ar Comprimido    12.654.553/0001-47
C000717    4523/4462    Jefferson Ariatti    37.625.577/0001-07
C002659    139    JKM Com. Assistencia Tecnica    01.880.712/0001-05
C004899    4427 / 4766    Videmang Comercio de Maquinas    02.641.349/0001-38
C001060    4295 / 4684    Casaflex Hidraulicos e Pneumaticos    32.480.921/0001-95
C010952    5237 / 5763    Neoacqua Saneamento    45.484.248/0001-03
C003817    4189 / 4567    Orstools Ferramentas Especiais    28.822.748/0001-99
C001305    4927/5211    Conextubo Soluções em Hidraulicas    56.989.111/0001-27
C002821    666    Juliano Compressores LTDA    30.216.051/0001-16
C000154    3999    Andre Luiz Paulo da Silva    53.380.355/0001-10
C000810    5184 / 5671    Automotiva Ferragens    53.420.260/0001-82
C003263    1309    Maquifrig Serviços e Equip.    05.243.123/0001-77
C003622    4900 / 5179    MT Comercio de Equipamentos    09.634.624/0001-35
C000535    4522/4322    ALN Comercio de Peças    54.967.812/0001-30
C000597    142    Andre Felipe Dias EPP    10.414.033/0001-31
C002985    4993 / 5333    LFG Hidraulica e Pneumatica    44.544.907/0001-97
C002369    1324    HRS Comercio Maquina    17.759.600/0001-30
C004303    581    Ronaldo Maragno    27.274.237/0001-17
C000745    5022/5396    Artec Comércio LTDA    10.349.536/0001-70
C004385    3571    Salete Aparecida Zago Fernandes    48.869.585/0001-07
C001037    104    Casa das Pistolas de Pintura    02.111.846/0001-24
C004466    4647/4920    Serve Comercio e Serviço de Compressores    72.074.651/0001-37
C002828    340    Juliercio Friedrich ME    12.978.107/0001-98
C003789    4272/4651    Oeste Parafusos Comercio de Parafusos    00.183.143/0001-86
C005037    5033/5430    Zanin Mangueiras e Conexões    35.985.766/0001-57
C002153    5016/5386    Gerson Máquinas e Equipamentos    26.947.180/0001-07
C001567    387    Ecetec Equipamentos e Serviços    05.315.993/0001-04
C002982    15    Leão Equipamentos LTDA    22.213.642/0001-01
C005088    Ana Paula Pereira    50.531.738/0001-53
C004505    3242    Silvano Compressores LTDA    37.084.525/0001-62
C003536    872    MGK Engenharia E Comercio    20.046.902/0001-76
C004944    2176    W-Jet Compressores LTDA    44.289.665/0001-32
C003545    358    Michel Ferragens LTDA    01.733.079/0001-22
C003508    16    Merz Compressores LTDA    13.801.839/0001-70
C000247    Lourdes Moser    60.894.197/0001-81
C000428    2793    Agtec Eletrotécnica    14.360.344/0001-16
C004501    1407    Silva Equipamentos LTDA    18.224.986/0001-49
C001791    1385    EPR Maquinas e Equipamentos    30.182.252/0001-40
C010327    MVM Soluções Industriais    22.181.609/0001-47
C001344    466    CPA Comercio de Equip    17.819.519/0001-07
C003225    3971    Manflex Mangueiras e Conexões    43.268.209/0001-43
C010238    5362    Chapeco Representações    53.522.508/0001-16
C001714    478    Eletrotecnica Balardin    10.521.951/0001-60
C010471    WL Montagem e Manutenção    46.943.042/0001-67
C001205    277    Coelho Compressores LTDA    10.644.802/0001-98
C002627    1837    Maqtop Assistencia Técnica    40.883.212/0001-89
C004875    4824/5111    Vergo Equipamentos Industrial    17.233.062/0001-46
C010130    Flavia dos Santos    63.324.000/0001-67
C002318    4532/4643    Hidrauflex Mangueiras e Conexões    38.336.428/0001-82
C003903    4678/4957    Pedro Paulo dos Santos    37.031.482/0001-57
C010426    Injeta Service LTDA    58.344.661/0001-14
C001314    Consermaqs Consertos de Maquinas    21.239.766/0001-01
C004427    428    Savi Assistencia Tecnica    95.851.549/0001-04
C002306    2072    Hidralsystem Manutenção    24.653.994/0001-03
C000609    1977    André Felipe Peretti    12.450.002/0001-61
C002859    28    Karla Christiane    03.008.156/0001-07
C005005    2438    Willian Valvassori    27.614.147/0001-28
C007660    2512    LF Manutenções    41.320.758/0001-94
C002669    55    JN Com. e Manut    12.080.389/0001-01
C004748    2181    Trap-Tec Comercio    14.773.666/0001-97
C002193    1839    GLC Máquinas e Ferramentas    81.390.619/0002-32
C010551    Jeferson Szymanski    61.436.003/0001-67
C001404    4529 / 4145    Daniel Hille Comercio    31.002.197/0001-21
C000329    884    A.M. Tec Automacao    30.054.172/0001-09
C002325    322    Hidraulicos Fenili Comercio    00.094.012/0001-22
C002165    390    Gilberto Siqueira Rodrigues    03.884.595/0001-83
C001365    4526    CTE Manutenções    56.687.473/0001-63
C002287    1456    Henrique Machado da Silva    37.932.036/0001-13
C002157    1421    GHBR Eirele    27.705.642/0001-42
C002794    3139    JP Comércio e Instalação    00.188.927/0001-05
C000253    4787 / 5069    Ricardo Souza Salvador    61.408.016/0001-22
C003810    3797    Onflex BR Soluções    35.060.226/0001-62
C001181    3245    Cleimaq Comercio    82.973.918/0001-81    lista de visita
C001203    3142    CMO Conserto    09.395.511/0001-24    lista de visita
C001268    1302    Comprear Compressores    14.741.427/0001-55
C000982    1716    Canale Maquinas e Representações    86.263.092/0001-18
C003255    93    Maqjet Máquinas e Equipamentos    01.370.202/0001-98
C002125    1086    Geison Renato Kruger    30.002.997/0001-80
C011515    Agrofio Refrigeração    44.008.094/0001-10
C003654    2005    MVTEC Eletrica e Assistencia    19.498.315/0001-39
C000099    3820    Daiana Iwanczuk    49.091.720/0001-07
C004819    4546    Valdrich Materiais Elétricos    15.754.347/0001-05
C004210    298    Riovalle Comercio de Compressores    16.961.643/0001-31
C000846    1432    Berenice Aparecida da Silva    31.651.356/0001-19
C004898    3985    Videdutos industria e Comercio    78.987.401/0001-74
C009725    3777    Brusfer Comercio de Ferragens    00.442.819/0001-09
C001423    2662    Datec Automação    14.790.897/0001-09
C002443    Instaladora Eletrica    75.289.157/0001-88
C004728    4907    Top Mangueiras    53.191.133/0001-59
C001187    1153    Clenoir da Rosa    35.239.728/0001-55
C004480    4545    Shelby Industrial    34.758.885/0001-04    trabalha com a linha verde
C001194    1838    Clodoaldo Bernardes    42.003.538/0001-08
C001269    9    Compleblu Comercio    20.852.276/0001-05    lista de visita
C001309    2002    Confiar Equipamentos    08.929.763/0001-23    lista de visita
`

const RS = `
C004991    2    Welter Eletro Motores    05.008.927/0001-91
C002666    4971/5292    JM Welter Comercio, Indústria    40.691.905/0001-70
C001281    5010/5372    Compresstech Services    36.992.582/0001-87
C001062    1245    Cassiano Velho da Rosa    27.584.983/0001-07
C000429    4946/5245    Agua e Luz Materiais para Construção    04.484.576/0001-22
C001499    966    Dirceu Ademar Cenci    88.509.849/0001-36
C004033    4979/5301    R&N Ferramentas LTDA    01.902.424/0001-04
C000839    4806 / 5091    Bel Air Pneumatica    02.276.695/0001-64
C000861    1859    Bilhalva Com e Tec de Compressores    03.272.776/0001-59
C001451    3206    Delvis Dias da Silva    47.180.603/0001-86
C001762    462    Emelson Paulo Weber    23.769.405/0001-94
C002473    1208    Isdrael Danielli    33.707.661/0001-00
C002911    2885    L. F. Brum    46.727.197/0001-66
C003231    4615 / 4881    Manguepeças Industria    68.824.473/0001-47
C001013    1464    Carlos Ricardo de Oliveira    36.282.278/0001-46
C003187    2287    M.T. Comercio Maquinas    06.233.851/0001-60
C000527    1908    Aline Mann Silveira    34.681.102/0001-31
C001582    1895    Ederson Flores da Silva    13.267.808/0001-81
C003455    1130    MC Assistencia Técnica    11.134.142/0001-68
C000390    2542    AFB Comercio de Compressores    31.167.613/0001-41
C010152    5325 / 5916    Sulfran Indústria Comércio    11.460.106/0001-94
C003738    4878/5158    Nova Automação Comercial de Equipamentos    36.094.189/0001-76
C010516    Cia dos Parafusos, Ferragens, Maquinas    04.611.811/0001-80
C001395    4755    Daner Eletro Motores    92.280.379/0001-59
C000714    1555    Arg Mangueiras LTDA    03.778.921/0001-78
C001023    4202    Casa Castor Material de Construção    90.258.088/0001-39    só trabalha com o verde
C003637    4355    Multiservice Eletrica e Pneumatica    05.390.147/0001-59
C004265    1968    Rodrigo Ferramentas Elétrica    32.173.001/0001-24
C004663    2228    Tecnoair Rental Ar    03.450.722/0001-36
C005012    2277    Wilson da Silva Souza    23.171.404/0001-43
C000887    1229    Bossardi Comércio e Industria    04.708.958/0001-92
C002388    4509 / 4813    I.R Soluções Industriais    59.517.576/0001-73
C001476    144    Diego Felipe Koelzer    24.778.950/0001-00
C004953    2174    W7 Comercio e Distribuidora    15.481.051/0001-50
C001746    3413    Eloivir Carlos Menosso    35.414.964/0001-60
C000705    3766    Arcomp Comercio e Manutenção    24.344.049/0001-20
C001146    4261/4636    Clarel dos Reis, Filho    72.441.926/0001-23
C000983    1156    Canane Equipamentos    93.309.250/0001-99
C001386    1246    Dagostini Atacado    10.654.993/0001-79
C001069    3623    Catia Regina    14.352.581/0001-35
C004151    1217    Reluz Materiais Elétricos    25.135.602/0001-87
C001283    1170    Compresul Assistencia Técnica    06.280.194/0001-02
C002845    5081 / 5485    K G Kirst LTDA    48.135.762/0001-21
C001570    1529    Ecomaq Assistencia Técnica    08.463.318/0001-10
C001393    2015    Dalri Comercio e Industria    93.972.339/0001-30
C001461    485    DHB Comercio de Maquinas    93.839.728/0001-92
C003101    1818    Luis Rodrigo Rista    28.110.718/0001-50
C003089    47    Luft Sul LTDA    01.038.136/0001-53
C001233    4653 / 4930    Comercial Hidrovil    03.727.736/0001-54
C000306    2776    A Meneguzzo & Cia    90.718.404/0001-08
C003251    1749    Maq Service Manutenção    24.312.799/0001-10
C000425    2371    Agroplan Maquinas    12.655.226/0001-00
C002853    3025    Kaleo Lone Matias    37.636.973/0001-21
C003839    1250    P.R.S. da Silva & Cia    01.766.517/0001-59
C004642    1927    Tec Jatos    20.044.289/0001-58
C000658    1805    Antônio Cesar dos Santos    07.605.130/0001-05
C009684    1723    Ana Cristina Alves    29.033.472/0001-22
C003620    4512    MSP    37.756.908/0001-30
C003750    2475    NTEC Manutenção    23.813.402/0001-00
C003848    3941    Palma Encanamentos    09.077.871/0001-88    só trabalha com o verde
C000035    4686    Guilherne Murinel    30.250.653/0001-90
C002510    155    J L da Silva Lessa    08.532.410/0001-95
`

interface LinhaParseada {
  codigo: string
  codigoAntigoRaw: string | undefined
  razaoSocial: string
  cnpjRaw: string
  observacoes: string | undefined
  estado: string
}

// Código Method é opcional (bem diferente da lista da Yasmin, aqui quando
// não tem código antigo a coluna vem simplesmente vazia, sem rótulo). Depois
// vem a razão social, o CNPJ, e opcionalmente uma observação solta no fim.
const LINHA_REGEX = /^(C\d{6})\s+(?:(\d+(?:\s*\/\s*\d+)?)\s+)?(.+?)\s+([\d.\/-]+)(?:\s+(.+))?$/

function parseLista(texto: string, estado: string): LinhaParseada[] {
  const linhas: LinhaParseada[] = []
  for (const linhaRaw of texto.split('\n')) {
    const linha = linhaRaw.trim()
    if (!linha) continue
    const m = linha.match(LINHA_REGEX)
    if (!m) {
      console.warn(`⚠️  [${estado}] Linha não reconhecida, pulando:`, linha)
      continue
    }
    const [, codigo, codigoAntigoRaw, razaoSocial, cnpjRaw, observacoes] = m
    linhas.push({ codigo, codigoAntigoRaw, razaoSocial: razaoSocial.trim(), cnpjRaw, observacoes: observacoes?.trim(), estado })
  }
  return linhas
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada (slug "odin-tubos")')

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const vendedora = vendedores.find((v) => v.name.trim().toUpperCase() === NOME_VENDEDOR)
  if (!vendedora) {
    console.error('❌ Vendedora "Karinna" não encontrada. Vendedores ativos na Odin Tubos e Conexões:')
    for (const v of vendedores) console.error('   -', v.name)
    throw new Error('Aborting: vendedora não encontrada')
  }

  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Nenhum admin encontrado na Odin Tubos e Conexões pra registrar as transferências')

  const existentes = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresa.id),
    columns: { id: true, codigo: true, vendedorAtualId: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  const existentePorCodigo = new Map(existentes.map((c) => [c.codigo, c]))

  const linhas = [...parseLista(PR, 'PR'), ...parseLista(SC, 'SC'), ...parseLista(RS, 'RS')]

  const codigosVistos = new Set<string>()
  let criados = 0
  let atribuidos = 0
  let jaEraDaKarinna = 0
  let duplicadosNaLista = 0
  const conflitos: string[] = []
  const cnpjInvalidos: string[] = []

  for (const linha of linhas) {
    if (codigosVistos.has(linha.codigo)) {
      duplicadosNaLista++
      continue
    }
    codigosVistos.add(linha.codigo)

    const existente = existentePorCodigo.get(linha.codigo)
    if (existente) {
      if (existente.vendedorAtualId === vendedora.id) {
        jaEraDaKarinna++
      } else if (existente.vendedorAtualId === null) {
        await transferirCliente(existente.id, vendedora.id, admin.id)
        atribuidos++
      } else {
        conflitos.push(`${linha.codigo} — ${linha.razaoSocial} (hoje é de ${existente.vendedorAtual?.name ?? '?'})`)
      }
      continue
    }

    const regiao = regiaoPorUf(linha.estado)
    if (!regiao) throw new Error(`Estado sem região mapeada: ${linha.estado}`) // não deve acontecer (PR/SC/RS são fixos)

    const cnpjLimpo = limparCnpj(linha.cnpjRaw)
    const cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined
    if (!cnpj) cnpjInvalidos.push(`${linha.codigo} — ${linha.razaoSocial} (CNPJ na lista: ${linha.cnpjRaw})`)

    const result = await db.insert(clientes).values({
      empresaId: empresa.id,
      razaoSocial: linha.razaoSocial,
      cnpj,
      codigo: linha.codigo,
      codigoAntigo: linha.codigoAntigoRaw,
      regiao,
      estado: linha.estado,
      observacoes: linha.observacoes,
      vendedorAtualId: vendedora.id,
    })
    const clienteId = Number(result.lastInsertRowid)

    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedora.id })
    await db.insert(funilMensal).values({ clienteId, vendedorId: vendedora.id, mesReferencia: mesReferenciaAtual() })
    criados++
  }

  console.log('\n📊 Resumo da importação (carteira Karinna — Odin Tubos e Conexões):')
  console.log('  Clientes criados:', criados)
  console.log('  Já existiam sem vendedor, atribuídos à Karinna agora:', atribuidos)
  console.log('  Já eram da Karinna (sem mudança):', jaEraDaKarinna)
  console.log('  Duplicados dentro da lista (pulados):', duplicadosNaLista)
  console.log('  Total de linhas nas 3 listas:', linhas.length)
  console.log(`\n  Sem CNPJ válido (${cnpjInvalidos.length}) — cadastrados mesmo assim, campo CNPJ em branco:`)
  for (const item of cnpjInvalidos) console.log('   -', item)
  console.log(`\n  Conflitos — já pertencem a OUTRO vendedor, não mexidos (${conflitos.length}):`)
  for (const item of conflitos) console.log('   -', item)
  process.exit(0)
}

run().catch((err) => {
  console.error('❌ Erro na importação:', err)
  process.exit(1)
})

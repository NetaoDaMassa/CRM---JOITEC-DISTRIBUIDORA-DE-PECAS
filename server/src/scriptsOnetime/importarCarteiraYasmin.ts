// ⚠️ TEMPORÁRIO — cópia de server/scripts/importar-carteira-yasmin-odin-tubos.ts
// só pra existir dentro de src/ (compilado pro dist/ da imagem Docker) e
// rodar em produção via `docker compose exec backend node dist/scriptsOnetime/importarCarteiraYasmin.js`,
// já que server/scripts/ não entra na imagem. Excluir este arquivo (e este
// diretório) depois de confirmar que rodou certo em produção — a versão de
// registro histórico permanente é a de server/scripts/.
//
// Script avulso — importa a lista de clientes colada pelo João (mensagem de
// 07/08/2026) pra empresa Odin Tubos e Conexões (slug 'odin-tubos'), todos
// direto na carteira da YASMIN RAMOS. Roda uma vez só.
//
// Boa parte dos códigos da lista já existe no banco (cadastrados sem
// vendedor, no Banco de Clientes) — pra esses, o script só atribui a Yasmin
// (via transferirCliente, mesma função usada na tela de Carteira, que já
// cuida do histórico e do card do mês). Um código já atribuído a OUTRO
// vendedor não é mexido — fica logado como conflito pro João decidir à mão.
//
// A lista não trouxe estado/cidade (região é campo obrigatório no cadastro),
// então por decisão do João todo o lote entra como 'sudeste' — a Yasmin
// completa estado/cidade depois, cliente por cliente, no cadastro normal.
//
// "Código Antigo" = "CLIENTE NOVO" / "CNPJ NOVO" são só rótulos da planilha
// de origem (não são códigos antigos de verdade) — viram null.
//
// O CNPJ da linha "Robert Rocha" (C010722) tem só 10 dígitos — não é CNPJ
// válido (provavelmente um telefone colado por engano). Por decisão do João,
// esse cliente é cadastrado sem CNPJ. Os demais passam pela validação normal
// de dígito verificador (cnpjValido) — o que não bater vira null também, e
// fica listado no resumo final pra conferência.
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { clientes, carteiraHistorico, funilMensal, users, empresas } from '../db/schema.js'
import { cnpjValido, limparCnpj } from '../lib/cnpj.js'
import { mesReferenciaAtual } from '../lib/dataBr.js'
import { transferirCliente } from '../router/carteira.js'

const NOME_VENDEDOR = 'YASMIN RAMOS'

// Colado verbatim da mensagem do João — cada linha: Código Novo, Código
// Antigo, Razão Social, CNPJ.
const DADOS = `
C000105    3751    49.854.382 ALESSANDRO JOSE GONCALVES FERREIRA    49.854.382/0001-00
C000132    3931    51.538.615 ALEXANDRE OLIVEIRA FERNANDES    51.538.615/0001-07
C000220    CLIENTE NOVO    58.730.605 GABRIEL PIRES DA SILVA    58.730.605/0001-18
C000404    368    AGRIJET ARUJA COMPRESSORES    07.799.185/0001-95
C000405    368 / 1504    AGRIJET MOGI COMPRESSORES    23.331.506/0001-89
C000433    4211    AILTON LOPES RODRIGUES HIDRAULICA    57.007.835/0001-90
C000437    1391    AIR COMP COMPRESSORES    06.813.833/0001-58
C000444    3990    AIR PRESS MEDICAL GROUP    44.912.777/0001-06
C000521    4132    ALFA PNEUMATICA & AUTOMACAO INDUSTRAL    53.610.179/0001-65
C000534    4994    ALMEIDA'S CONEXOES INDUSTRIAIS    61.532.681/0001-23
C000537    3719    ALPHA COMERCIO DE CONEXOES    03.729.617/0001-30
C000545    3710    ALTECS SOLUCOES EM AR COMPRIMIDO E GASES    26.230.970/0001-77
C000551    3720    ALYSSON MORANDI 20414663837    45.541.333/0001-66
C000559    5021    AMC HIDRAULICA    05.488.969/0001-77
C000674    2413    AR BRASIL COMPRESSORES    62.029.426/0001-25
C000679    2855    AR FUSION BRASIL    20.283.559/0001-83
C010503    CLIENTE NOVO    AR GLOBAL COMERCIO DE EQUIPAMENTOS LTDA    04.561.146/0001-67
C000792    162    AUGUSTO COMPRESSORES    62.733.332/0001-32
C000827    3051    BARO AR COMPRESSORES SOLUCOES    17.046.503/0001-09
C000845    4297    BENEVALDO BARBOSA DA SILVA    34.025.196/0001-90
C000874    248    BOECHAT COMPRESSORES EIRELI    14.665.654/0001-49
C000908    4298    BRITO SOLUCOES EM AR COMPRIMIDO    47.477.046/0001-60
C000969    4716    CACHOEIRO SOLUCOES PNEUMATICAS    42.069.487/0001-09
C010623    4184    COFERMETA SA    17.281.973/0003-00
C010623    4184    COFERMETA SA    17.281.973/0003-00
C001273    2066    COMPRESSORES E CIA PEÇAS    28.004.702/0001-62
C010383    CLIENTE NOVO    CRAVINHOS MATERIAIS ELETRICOS E CONSTRUCAO LTDA    20.189.252/0001-18
C001422    3786    DARCI ROBERTO DA SILVA    30.277.298/0001-42
C001516    3633    DM COMPRESSORES    46.480.831/0001-09
C001531    1173    DR. AIR MANUTENCAO E REPARACAO    33.375.356/0001-69
C010836    CLIENTE NOVO    ECOSOLUCOES AMBIENTAL LTDA    36.767.451/0001-04
C001577    1417    EDER APARECIDO DA SILVA    14.425.230/0001-07
C001594    795    EDISON GALENDE JUNIOR MECANICA -    06.973.918/0001-01
C001728    2702    ELIANE LIMA DE OLIVEIRA    35.559.776/0001-20
C001796    530    EQUIPAMENTOS A C LTDA    21.087.804/0001-40
C001825    4422    EVANDRO FERNANDO    15.671.452/0001-72
C001850    1842    F A P L Maia dos Santos Comercio    38.180.904/0001-19
C001856    2227    F P DOS SANTOS COMPRESSORES    34.699.273/0001-98
C001861    335    F. ANDRADE COMPRESSORES LTDA    28.136.448/0001-56
C011455    CLIENTE NOVO    FULLTEST INDUSTRIA E COMERCIO LTDA    24.931.892/0001-02
C002066    5134    FUNDITUDO EQUIPAMENTOS    61.639.913/0001-47
C002073    4161    FUZZO AR COMPRESSORES L    55.646.309/0001-45
C002107    CLIENTE NOVO    GADE COMERCIO E SERVICOS DE FERRAGENS E FERRAMENTA    54.341.205/0001-60
C002190    3862    GLAUBER LEANDRO ANDRADE DA SILVA    22.049.874/0001-76
C002200    3601    GM COMPRESSORES    42.708.280/0001-37
C002207    3147    GODOI E GODOI COMERCIO E SERVIÇOS DE MÁQUINAS    40.573.506/0001-04
C002234    4924    GROSSI ONLINE    60.794.143/0001-44
C002237    2419    GS SANTOS LTDA    44.519.294/0001-38
C002275    141    HC COMERCIO E SERVIÇOS DE FERRAMENTAS    08.889.336/0001-69
C002284    5182    HELPP COMPRESSORES    61.585.958/0001-86
C002320    1501    HIDRAULEV PEÇAS & MANUTENÇÃO    05.537.218/0001-01
C002331    192    HIDRAUSUPER COMERCIO E MANUT.    06.210.846/0001-32
C002337    3681    HIDRO SMART VP COMERCIAL    42.692.956/0001-41
C002345    949    HIDROCONEC COMÉRCIO DE CONEXÕES    07.339.309/0001-50
C002363    4378    HM BRASIL LTDA    25.267.009/0001-94
C002371    5113    HSL MATERIAIS ELETRICOS    63.160.843/0001-75
C002393    2779    IATEC FERRAMENTAS PNEUMATICAS LTDA-ME    05.938.678/0001-33
C002402    3260    IDAMAR FRANCISCO DA SILVA    46.754.459/0001-81
C002464    2024    ISA SILVA DE SOUSA MEI    27.085.829/0001-90
C002481    844    IVANIL DE SALES GOMES    24.365.616/0001-24
C002495    2911    J A A M TEIXEIRA COMERCIO    32.798.703/0001-01
C002543    1248    J.A DA SILVA COMPRESSORES    30.830.547/0001-85
C002637    2774    JF COMPRESSORES LTDA    34.354.646/0001-99
C002662    4974    JM CENTER COMÉRCIO DE MATERIAIS    00.003.252/0001-74
C002781    3701    JOSÉ ROBERTO DO NASCIMENTO    49.250.065/0001-84
C011395    CLIENTE NOVO    JS COMPRESSORES PECAS E SERVICOS LTDA    03.068.602/0001-79
C002806    4805    JSF COMPRESSORES LTDA    20.393.124/0001-91
C002866    3247    KATIA DRAGON CELINI NASCIMENTO    12.765.214/0001-38
C000001    2472    L M T BITENCOURT LOCAÇÃO PEÇAS    14.003.049/0001-02
C002944    2623    LEANDRO DO CARMO RODRIGUES COMÉRCIO    10.350.835/0001-25
C002950    3058    LEF MANUTENCAO E ALUGUEL DE COMPRESSORES    35.500.965/0001-28
C002958    2433    LEO COMPRESSORES    45.871.047/0001-69
C002987    697    LIDER MONTAGENS INDUSTRIAIS    19.724.065/0001-08
C003013    943    LINTEC COMERCIO DE COMPRESSORES    27.736.420/0001-97
C003022    2706    LOJA DO COMPRESSOR    46.379.773/0001-21
C003045    707    LUBRIAR COMPRESSORES    05.049.397/0001-20
C003058    3800    LUCAS MAUDONNET VOSSO    32.931.441/0001-01
C003092    3729    LUIS ANTONIO DA SILVA    47.699.726/0001-28
C003137    3461    M & G COMPRESSORES    37.759.690/0001-77
C003190    4222    MAC COMPRESSORES E REDES DE AR COMPRIMIDO    46.041.318/0001-11
C003208    4936    MAGSO ENGENHARIA E SOLUCOES    57.398.459/0001-02
C003208    4936    MAGSO ENGENHARIA E SOLUCOES    57.398.459/0001-02
C003228    4347    MANGHMON LTDA    15.091.320/0001-71
C003234    2494    MANOEL MIZAEL RAMOS    29.956.884/0001-34
C010330    CLIENTE NOVO    MAQUIFIL SERVICO E COMERCIO LTDA    23.439.081/0001-26
C003306    3609    MARCIO VIEIRA RIBEIRO    27.837.142/0001-64
C003326    2965    MARCOS DIAS MONTIEL    37.555.870/0001-37
C003480    1527    MEG TECNICA EQUIPAMENTOS ACESSÓRIOS    33.484.508/0001-61
C003500    2921    MERCADO DOS COMPRESSORES MANUTENCOES    36.825.251/0001-52
C003515    820    METAL COMPRESSORES LOCAÇÕES    05.042.615/0001-02
C003556    2687    MINAS DRILL SERVIÇOS DE AR COMPRIMIDO    03.790.611/0001-79
C010847    CLIENTE NOVO    MOC AUTOMACAO HIDRAULICA E PNEUMATICA LTDA    18.028.136/0001-75
C003643    4147    MUNDO AR EQUIPAMENTOS E SERVICOS    41.880.293/0001-26
C003656    3770    MWS SERVICE COMERCIO DE PECAS    12.516.062/0001-30
C003699    3205    NEWCOMP COMERCIO E MANUTENCAO    23.546.657/0001-54
C003802    2462    OLIVEIRA COMERCIO DE COMPRESSORES    38.299.710/0001-37
C003811    346    ONTEC COMPRESSORES L    10.582.275/0001-34
C003888    2956    PAULO ROBERTO MANOEL MOREIRA    21.234.621/0001-00
C010263    CNPJ NOVO    PCM AIR SYSTEM LTDA    65.834.771/0001-20
C010263    CLIENTE NOVO    PCM AIR SYSTEM LTDA    65.834.771/0001-20
C003920    3953    PERSPECTIVA CONSULTORIA E SERVICOS L    51.859.645/0001-15
C003969    3097    PRATICA COMERCIO E ASSISTENCIA    08.456.792/0001-15
C003975    1892    PRESSAORIO SERVIÇOS E EQUIPAMENTOS    30.861.529/0001-60
C003976    4943    PRESSUR COMÉRCIO DE PEÇAS E FERRAMENTAS    47.999.092/0001-29
C003993    2945    PROJETCOMP MANUTENCAO INDUSTRIA    26.911.755/0001-31
C011464    CLIENTE NOVO    QUATERNION CONSULTORIA E PROJETOS LTDA    10.314.917/0001-14
C004016    3400    R A DA SILVA PNEUMATICOS    17.660.890/0001-60
C004025    2613    R DE C C S M DUTRA COMPRESSORES    11.131.020/0001-18
C004038    3042    R. DE C. GARCIA COMPRESSORES    18.829.855/0001-95
C004046    1604    R.L COMPRESSORES E VALVULAS    37.975.917/0001-11
C010281    CLIENTE NOVO    REANNE MATERIAIS ELETRICOS E HIDRAULICOS    35.581.791/0001-75
C004132    5080    REGIANI SOUZA JASCINTO    39.574.164/0001-68
C004154    2801    REMCO - REPRESENTACAO, MOVIMENTACAO    19.471.646/0001-85
C004157    2823    RENATA ELIAS DOS SANTOS    18.261.398/0001-85
C004183    2451    REYES COMÉRCIO DE PEÇAS E SERVIÇOS L    08.648.698/0001-68
C010296    5274    RGP COMERCIO DE EQUIPAMENTOS    33.726.382/0001-94
C004224    4948    RM MANUTENCAO E SERVICOS DE MURIAE    50.436.031/0001-68
C010722    CLIENTE NOVO    Robert Rocha    6359382601
C004338    3168    RS SILVA COMÉRCIO E MANUTENÇÃO    19.571.563/0001-68
C004365    2345    S. DA SILVA MATIAS    09.108.585/0001-32
C004413    5011    SANTOS SIMOES COMERCIAL LTDA    03.200.562/0002-58
C004499    3713    SILVA AUTOMAÇÃO INDUSTRIAL LTDA    30.398.529/0001-76
C004543    4149    SOLUCAO 2007 EQUIPAMENTOS AUTOMOTIVOS    07.639.648/0001-51
C004688    3013    THAMIRIS ALESSANDRA    08.674.691/0001-10
C004689    4192    THAMYRIS FERNANDES SOUSA    50.671.763/0001-32
C004690    2388    THARSIS VALZACCHI    17.116.291/0001-80
C004734    2602    TORNADO SERVIÇO E COMÉRCIO DE EQUIPAMENTOS    30.573.311/0001-00
C004776    4005    UNIVERSO DOS COMPRESSORES    53.456.728/0001-99
C004860    582    VEIGA E SEBE COMPRESSORES E ACESSÓRIOS    26.903.722/0001-40
C004881    3158    VETORV ATACADISTA DE MÁQUINAS E EQUIPAMENTOS    15.870.631/0001-39
C010720    CLIENTE NOVO    VINICIUS JOSE SANCHES    61.364.918/0001-04
C004922    3308    VIX COMPRESSORES MULTIMARCAS    40.519.841/0001-24
C004937    3810    VWM COMERCIAL DE HIDRAULICAS E PLASTICOS    38.198.810/0001-77
C004950    4663    W.E MANUTENCAO    60.793.470/0001-81
C004960    3693    WAGNER SILVIO DOS SANTOS    27.327.438/0001-35
C004985    4867    WELLINGTON - WELL TEC LTDA    36.587.126/0001-51
C010732    CLIENTE NOVO    Z M BOMBAS ELETRO HIDRAULICA LTDA    12.254.067/0001-31
`.trim()

interface LinhaParseada {
  codigo: string
  codigoAntigoRaw: string
  razaoSocial: string
  cnpjRaw: string
}

// Cada linha: código novo, depois código antigo (dígitos, opcionalmente
// "123 / 456", ou os rótulos "CLIENTE NOVO"/"CNPJ NOVO"), depois a razão
// social (pode conter números soltos), e por fim o CNPJ/telefone no final da
// linha. O .+? não-guloso funciona pq só existe UM jeito de casar até o fim
// da linha — backtracking resolve mesmo quando a razão social tem números.
const LINHA_REGEX = /^(C\d{6})\s+(CLIENTE NOVO|CNPJ NOVO|\d+(?:\s*\/\s*\d+)?)\s+(.+?)\s+([\d.\/-]+)$/

function parseLinhas(texto: string): LinhaParseada[] {
  const linhas: LinhaParseada[] = []
  for (const linhaRaw of texto.split('\n')) {
    const linha = linhaRaw.trim()
    if (!linha) continue
    const m = linha.match(LINHA_REGEX)
    if (!m) {
      console.warn('⚠️  Linha não reconhecida, pulando:', linha)
      continue
    }
    const [, codigo, codigoAntigoRaw, razaoSocial, cnpjRaw] = m
    linhas.push({ codigo, codigoAntigoRaw, razaoSocial: razaoSocial.trim(), cnpjRaw })
  }
  return linhas
}

async function run() {
  const empresa = await db.query.empresas.findFirst({ where: eq(empresas.slug, 'odin-tubos') })
  if (!empresa) throw new Error('Empresa Odin Tubos e Conexões não encontrada (slug "odin-tubos")')

  const vendedores = await db.query.users.findMany({ where: and(eq(users.role, 'vendor'), eq(users.empresaId, empresa.id)) })
  const vendedora = vendedores.find((v) => v.name.trim().toUpperCase() === NOME_VENDEDOR)
  if (!vendedora) {
    console.error('❌ Vendedora "Yasmin Ramos" não encontrada. Vendedores ativos na Odin Tubos e Conexões:')
    for (const v of vendedores) console.error('   -', v.name)
    throw new Error('Aborting: vendedora não encontrada')
  }

  // Precisa do admin da empresa pra registrar quem fez a atribuição no log
  // de auditoria das transferências (transferirCliente exige um alteradoPor).
  const admin = await db.query.users.findFirst({ where: and(eq(users.empresaId, empresa.id), eq(users.role, 'admin')) })
  if (!admin) throw new Error('Nenhum admin encontrado na Odin Tubos e Conexões pra registrar as transferências')

  const existentes = await db.query.clientes.findMany({
    where: eq(clientes.empresaId, empresa.id),
    columns: { id: true, codigo: true, vendedorAtualId: true },
    with: { vendedorAtual: { columns: { name: true } } },
  })
  const existentePorCodigo = new Map(existentes.map((c) => [c.codigo, c]))

  const linhas = parseLinhas(DADOS)

  const codigosVistos = new Set<string>()
  let criados = 0
  let atribuidos = 0
  let jaEraDaYasmin = 0
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
        jaEraDaYasmin++
      } else if (existente.vendedorAtualId === null) {
        await transferirCliente(existente.id, vendedora.id, admin.id)
        atribuidos++
      } else {
        conflitos.push(`${linha.codigo} — ${linha.razaoSocial} (hoje é de ${existente.vendedorAtual?.name ?? '?'})`)
      }
      continue
    }

    const codigoAntigo = /^(CLIENTE NOVO|CNPJ NOVO)$/.test(linha.codigoAntigoRaw) ? undefined : linha.codigoAntigoRaw

    const cnpjLimpo = limparCnpj(linha.cnpjRaw)
    const cnpj = cnpjLimpo.length === 14 && cnpjValido(cnpjLimpo) ? cnpjLimpo : undefined
    if (!cnpj) cnpjInvalidos.push(`${linha.codigo} — ${linha.razaoSocial} (CNPJ na lista: ${linha.cnpjRaw})`)

    const result = await db.insert(clientes).values({
      empresaId: empresa.id,
      razaoSocial: linha.razaoSocial,
      cnpj,
      codigo: linha.codigo,
      codigoAntigo,
      regiao: 'sudeste',
      vendedorAtualId: vendedora.id,
    })
    const clienteId = Number(result.lastInsertRowid)

    await db.insert(carteiraHistorico).values({ clienteId, vendedorId: vendedora.id })
    await db.insert(funilMensal).values({ clienteId, vendedorId: vendedora.id, mesReferencia: mesReferenciaAtual() })
    criados++
  }

  console.log('\n📊 Resumo da importação (carteira Yasmin Ramos — Odin Tubos e Conexões):')
  console.log('  Clientes criados:', criados)
  console.log('  Já existiam sem vendedor, atribuídos à Yasmin agora:', atribuidos)
  console.log('  Já eram da Yasmin (sem mudança):', jaEraDaYasmin)
  console.log('  Duplicados dentro da lista (pulados):', duplicadosNaLista)
  console.log('  Total de linhas na lista:', linhas.length)
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

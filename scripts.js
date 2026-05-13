/* -------------------------------------------------------------
   AFLOR · Inteligência Aplicada
   scripts.js — IOA · Inteligência Operacional AFLOR
   -------------------------------------------------------------
   Blocos:
     1. Configuração  — constantes e registro de plugins
     2. Cálculo       — funções de custo e ROI
     3. Utilitários   — formatação e gráficos
     4. Motor IOA     — IOA · Inteligência Operacional AFLOR
     5. Interface     — KPIs, DOM e relatório
     6. Lead          — validação e formatação
     7. Persistência  — Apps Script + Google Sheets
     8. Impressão     — orquestra validação + save + print
     9. Inicialização — eventos
------------------------------------------------------------- */


/* -- 1. CONFIGURACAO ---------------------------------------- */

Chart.register(ChartDataLabels);

const DIAS_SEMANA             = 5;
const FATOR_DIAS              = DIAS_SEMANA * 4;  // 20 dias úteis/mês
const HORAS_MES               = 220;              // horas mensais totais

// CUSTO_SERVICOS_AFETADOS = 0 para V1.
// O custo de serviços/operações afetadas é real, mas não existe
// campo próprio no formulário ainda. Para evitar viés, não entra
// no cálculo principal da V1.
const CUSTO_SERVICOS_AFETADOS = 0;

const CUSTO_PAPEL_FIXO        = 1.30;             // custo unitário por formulário em papel (R$)

let charts = {};  // registro dos gráficos ativos para destruição/recriação

/**
 * Último payload calculado - atualizado em cada execução de calcularROI().
 * Usado por salvarDiagnostico() para evitar leitura de textContent do DOM.
 * Na migração para Apps Script, este objeto é o body do fetch().
 */
let ultimoPayloadDiagnostico = null;

/**
 * ID da linha criada no Google Sheets para este diagnóstico.
 * null  → linha ainda não criada (próximo save criará uma nova).
 * string → linha já existe; saves subsequentes apenas atualizam.
 */
let diagnosticoSheetId = null;


/* -- 2. CÁLCULO -------------------------------------------- */

/**
 * Retorna o custo mensal da Plataforma AFLOR por faixa de colaboradores.
 * Faixas fixas para 1-4; acima de 5: R$ 185/colaborador.
 */
function calcularCustoAFLOR(colaboradores) {
  if (colaboradores === 1) return 550;
  if (colaboradores === 2) return 650;
  if (colaboradores === 3) return 750;
  if (colaboradores === 4) return 850;
  if (colaboradores >= 5) return colaboradores * 185;
  return 0;
}

/**
 * Retorna o custo mensal total do processo sem automação.
 * Compõe: papel + tempo improdutivo + custo de serviços afetados (V1 = 0).
 * Fonte única de verdade — calcularROI() consome daqui, não recalcula.
 * @returns {{ total: number, _custoPapelMensal: number, _custoTempoMensal: number }}
 */
function calcularCustoManual(colaboradores, salario, minutos, formularios, custoPapel) {
  const _custoPapelMensal = (formularios * custoPapel * colaboradores) * FATOR_DIAS;
  const _custoTempoMensal = ((minutos / 60) * ((salario * 1.7) / HORAS_MES) * colaboradores) * FATOR_DIAS;
  const total             = _custoPapelMensal + _custoTempoMensal + CUSTO_SERVICOS_AFETADOS;
  return { total, _custoPapelMensal, _custoTempoMensal };
}


/* -- 3. UTILITÁRIOS ---------------------------------------- */

/** Formata número como moeda BRL (R$ X.XXX,XX). */
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style:                'currency',
    currency:             'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
}

/**
 * Converte valor mascarado em formato BRL para número.
 * "3.500,00" → 3500 | "12.500,00" → 12500 | "" → 0
 */
function parseMoedaBR(valor) {
  return Number(String(valor || '').replace(/\./g, '').replace(',', '.')) || 0;
}

/**
 * Aplica máscara monetária brasileira a um input de texto.
 * Ao digitar 350000 → exibe 3.500,00; campo vazio permanece vazio.
 */
function formatarInputMoedaBR(input) {
  const digits = input.value.replace(/\D/g, '');
  if (!digits) {
    input.value = '';
    return;
  }
  const numero = Number(digits) / 100;
  input.value = numero.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Cria ou atualiza um gráfico Chart.js no canvas identificado por `id`.
 * Destrói instancia anterior se existir para evitar leak de memória.
 */
function criarOuAtualizarChart(id, tipo, dados, opcoes = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: tipo,
    data: dados,
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:     { display: false },
        datalabels: { display: false },
      },
      ...opcoes,
    },
  });
}

/** Define textContent de um elemento pelo ID, sem erro se não existir. */
function setTextIfExists(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/** Define innerHTML de um elemento pelo ID, sem erro se não existir. */
function setHtmlIfExists(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}

/** Define style.width de um elemento pelo ID, sem erro se não existir. */
function setWidthIfExists(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = value;
}

function gerarProximoPasso({ icoScore, economiaMensal, horasRecuperadas }) {

  // Caminho 1 — Prioridade estratégica
  if (icoScore >= 80) {
    return {
      title: 'Priorizar implementação',
      body:  'Os indicadores sustentam decisão prioritária. O impacto identificado é relevante e o custo de postergar a implementação é mensurável.',
    };
  }

  // Caminho 2 — Baixa prioridade operacional
  if (economiaMensal <= 0 && horasRecuperadas < 20) {
    return {
      title: 'Ajustar antes de automatizar',
      body:  'Os indicadores apontam retorno limitado no escopo atual. Ajustes pontuais de processo tendem a gerar mais resultado do que uma implementação estruturada neste momento.',
    };
  }

  // Caminho 3 — Oportunidade operacional (demais casos)
  return {
    title: 'Avançar com escopo definido',
    body:  'Os indicadores apontam ganho operacional real. Avançar com escopo inicial focado nos processos de maior impacto identificado.',
  };
}

/* -- 4. MOTOR IOA — IOA · Inteligência Operacional AFLOR --- */

/**
 * Calcula o IOA · Índice de Eficiência Operacional.
 *
 * Pesos:
 *   Impacto financeiro relativo : 40%
 *   Carga de tempo operacional  : 40%
 *   Viabilidade de retorno      : 20%
 *
 * @param {number} economiaMensal     — economia mensal calculada (pode ser negativa)
 * @param {number} custoManualMensal  — custo total do processo sem automação
 * @param {number} horasRecuperadas   — horas mensais recuperáveis pela equipe
 * @param {number} colaboradores      — quantidade de colaboradores
 * @param {number|null} payback       — meses de payback (null se não aplicável)
 * @returns {Object} — icoScore, icoFaixa, icoTitulo, icoRecomendacao, icoTipo,
 *                     scoreFinanceiro, scoreTempo, scoreRetorno
 */
function calcularICO(economiaMensal, custoManualMensal, horasRecuperadas, colaboradores, payback) {

  // — Dimensão 1: Impacto financeiro relativo (0–100) —
  let scoreFinanceiro = 0;
  if (economiaMensal > 0 && custoManualMensal > 0) {
    const economiaRelativa = economiaMensal / custoManualMensal; // 0–1+
    scoreFinanceiro = Math.min(Math.round(economiaRelativa * 200), 100);
  }

  // — Dimensão 2: Carga de tempo operacional (0–100) —
  // V1.2: scoreTempo por faixas absolutas de horas recuperadas/mês.
  // Justificativa: evita diluir ganhos operacionais relevantes em empresas maiores.
  let scoreTempo = 0;
  if      (horasRecuperadas < 20)   scoreTempo = 5;
  else if (horasRecuperadas < 50)   scoreTempo = 15;
  else if (horasRecuperadas < 100)  scoreTempo = 35;
  else if (horasRecuperadas < 200)  scoreTempo = 45;
  else if (horasRecuperadas < 400)  scoreTempo = 60;
  else if (horasRecuperadas < 600)  scoreTempo = 75;
  else if (horasRecuperadas < 1000) scoreTempo = 88;
  else                              scoreTempo = 100;

  // — Dimensão 3: Viabilidade de retorno (0–100) —
  let scoreRetorno = 0;
  if (economiaMensal > 0 && payback !== null && payback > 0) {
    if      (payback <= 3)  scoreRetorno = 100;
    else if (payback <= 6)  scoreRetorno = 80;
    else if (payback <= 12) scoreRetorno = 60;
    else if (payback <= 18) scoreRetorno = 40;
    else                    scoreRetorno = 20;
  }

  // — Score final ponderado —
  const icoScore = Math.round(scoreFinanceiro * 0.4 + scoreTempo * 0.4 + scoreRetorno * 0.2);

  // — Faixa —
  let icoFaixa;
  if      (icoScore >= 85) icoFaixa = 'Prioridade estratégica';
  else if (icoScore >= 65) icoFaixa = 'Alta oportunidade operacional';
  else if (icoScore >= 45) icoFaixa = 'Potencial operacional moderado';
  else if (icoScore >= 25) icoFaixa = 'Atenção operacional';
  else                     icoFaixa = 'Baixa prioridade operacional';

  // — Limiares internos para lógica de recomendação —
  const tempoAlto      = scoreTempo >= 30;     // recuperação de tempo relevante
  const economiaPosi   = economiaMensal > 0;
  const economiaZero   = Math.abs(economiaMensal) <= 50; // próxima do zero (margem R$ 50)

  // — Recomendação condicional —
  let icoTitulo;
  let icoRecomendacao;
  let icoTipo;

  if (economiaPosi && tempoAlto) {
    // Caso 1: ganho financeiro + ganho de tempo
    icoTipo = 'financeiro_e_operacional';
    icoTitulo = 'Alta viabilidade operacional';
    icoRecomendacao = `Os dados indicam <strong>ganho financeiro e recuperação de capacidade operacional</strong>. 
      O custo atual do processo (${formatarMoeda(custoManualMensal)}/mês) supera o investimento na estrutura AFLOR, 
      e a equipe recuperaria aproximadamente <strong>${Math.round(horasRecuperadas)} horas/mês</strong> 
      antes ocupadas com atividades manuais. A análise aponta favorável à adoção.`;

  } else if (economiaPosi && !tempoAlto) {
    // Caso 2: ganho financeiro, impacto de tempo moderado
    icoTipo = 'financeiro_moderado';
    icoTitulo = 'Viabilidade financeira';
    icoRecomendacao = `Os dados indicam <strong>vantagem financeira na adoção da estrutura AFLOR</strong>. 
      O impacto sobre a carga de tempo da equipe é moderado neste cenário, 
      mas a diferença de custo mensal (${formatarMoeda(economiaMensal)}) sustenta a análise. 
      Indicado avaliar processos prioritários antes de avançar.`;

  } else if (!economiaPosi && economiaZero && tempoAlto) {
    // Caso 4: custo tende a empatar, mas há ganho operacional
    icoTipo = 'equilibrio_com_capacidade';
    icoTitulo = 'Equilíbrio financeiro com ganho de capacidade';
    icoRecomendacao = `O custo do processo atual e o investimento na estrutura AFLOR tendem a se equilibrar 
      no cenário informado. Ainda assim, há <strong>recuperação estimada de ${Math.round(horasRecuperadas)} horas/mês</strong>, 
      com redução de sobrecarga e possibilidade de redirecionar a equipe para atividades de maior valor. 
      A decisão depende da prioridade estratégica da operação.`;

  } else if (!economiaPosi && tempoAlto) {
    // Caso 3: sem economia direta, mas alta recuperação de capacidade
    icoTipo = 'operacional_sem_economia';
    icoTitulo = 'Viabilidade operacional sem economia direta';
    icoRecomendacao = `Nos parâmetros informados, <strong>não há economia financeira direta</strong> em relação ao custo atual. 
      No entanto, a análise identifica <strong>recuperação de capacidade operacional</strong> 
      — aproximadamente ${Math.round(horasRecuperadas)} horas/mês antes ocupadas com atividades manuais. 
      Essa capacidade pode ser redirecionada para atividades de maior valor ou redução de sobrecarga da equipe. 
      A viabilidade depende da relevância estratégica desse ganho para a operação.`;

  } else if (!economiaPosi && !tempoAlto) {
    // Caso 5: sem economia e sem ganho de tempo expressivo
    icoTipo = 'operacao_suficiente';
    icoTitulo = 'Operação atual suficiente';
    icoRecomendacao = `Com base nos dados informados, a adoção da estrutura AFLOR 
      <strong>não aparece como prioridade imediata</strong>. 
      O processo atual apresenta custo e carga de tempo compatíveis com o cenário descrito. 
      Recomenda-se revisitar esta análise caso o volume de formulários, colaboradores 
      ou tempo improdutivo se altere significativamente.`;

  } else {
    // Caso 6: misto / não enquadrado
    icoTipo = 'moderado';
    icoTitulo = 'Potencial operacional moderado';
    icoRecomendacao = `Os indicadores apresentam resultado <strong>misto</strong> no cenário informado. 
      Há elementos favoráveis, mas também limitações que reduzem a clareza da análise. 
      Recomenda-se avaliar processos prioritários e ajustar os parâmetros antes de avançar.`;
  }

  // — Ajuste narrativo estratégico (score >= 90) —
  if (icoScore >= 90) {
    icoRecomendacao = 'Os indicadores apontam impacto operacional e financeiro de alta relevância, com retorno mensurável e recuperação expressiva de capacidade operacional. Casos nesse nível de resultado justificam prioridade estratégica.';
  }

  return {
    icoScore,
    icoFaixa,
    icoTitulo,
    icoRecomendacao,
    icoTipo,
    scoreFinanceiro,
    scoreTempo,
    scoreRetorno,
  };
}


/* -- 5. INTERFACE (KPIs + RELATÓRIO) ------------------------ */

/**
 * Lê os inputs do formulário, recalcula todos os indicadores
 * e atualiza KPIs + gráficos + relatório executivo + layout PDF.
 * Chamada por: evento load, change/input nos campos, botão "Gerar Diagnóstico".
 */
function renderizarEstadoNeutro() {
  const neutro = '—';
  // KPIs principais
  setTextIfExists('ganhoAnual',          neutro);
  setTextIfExists('roiPercentual',       neutro);
  setTextIfExists('payback',             neutro);
  setTextIfExists('custoManual',         neutro);
  setTextIfExists('custoAFLOR',          neutro);
  setTextIfExists('horasRecuperadasKPI', neutro);
  // Relatório executivo
  setTextIfExists('reportInvestimento',  neutro);
  setTextIfExists('reportEconomia',      neutro);
  // Bloco IOA web
  setTextIfExists('icoScore',    neutro);
  setTextIfExists('icoFaixa',    neutro);
  setTextIfExists('icoTitulo',   neutro);
  setHtmlIfExists('icoRecomendacao', neutro);
  setWidthIfExists('icoBarFill', '0%');
  // Bloco IOA PDF
  setTextIfExists('pr_icoScore',    neutro);
  setTextIfExists('pr_icoFaixa',    neutro);
  setTextIfExists('pr_icoTitulo',   neutro);
  setHtmlIfExists('pr_icoRecomendacao', neutro);
  setWidthIfExists('pr_icoBarFill', '0%');
}

function calcularROI() {

  // - Leitura dos inputs -
  const colaboradores   = parseFloat(document.getElementById('colaboradores').value)   || 0;
  const salario         = parseMoedaBR(document.getElementById('salario').value);
  const minutosPerdidos = parseFloat(document.getElementById('minutosPerdidos').value) || 0;
  const formularios     = parseFloat(document.getElementById('formularios').value)     || 0;
  const custoPapel      = CUSTO_PAPEL_FIXO;

  // - Guard: campos mínimos obrigatórios -
  if (colaboradores <= 0 || salario <= 0 || minutosPerdidos <= 0 || formularios <= 0) {
    renderizarEstadoNeutro();
    ultimoPayloadDiagnostico = null;
    return;
  }

  // - Cálculos principais -
  const custoManual       = calcularCustoManual(colaboradores, salario, minutosPerdidos, formularios, custoPapel);
  const custoPapelMensal  = custoManual._custoPapelMensal;
  const custoTempoMensal  = custoManual._custoTempoMensal;
  const custoManualMensal = custoManual.total;
  const custoAFLORMensal  = calcularCustoAFLOR(colaboradores);
  const economiaMensal    = custoManualMensal - custoAFLORMensal;
  const ganhoAnual        = economiaMensal * 12;
  const roiPercentual     = (economiaMensal / custoAFLORMensal) * 100;

  // Payback: calculado apenas se economiaMensal > 0; nunca negativo.
  const paybackAplicavel  = economiaMensal > 0;
  const payback           = paybackAplicavel ? (custoAFLORMensal / economiaMensal) : null;

  // Horas recuperadas: usa FATOR_DIAS (20 dias úteis) — consistente com demais cálculos.
  const horasRecuperadas  = (minutosPerdidos / 60) * FATOR_DIAS * colaboradores;

  // - Motor IOA -
  const ico = calcularICO(economiaMensal, custoManualMensal, horasRecuperadas, colaboradores, payback);

  // - KPIs principais -
  document.getElementById('ganhoAnual').textContent          = formatarMoeda(ganhoAnual);
  document.getElementById('roiPercentual').textContent       = roiPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  document.getElementById('payback').textContent             = paybackAplicavel
    ? payback.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : 'N/A';
  document.getElementById('custoManual').textContent         = formatarMoeda(custoManualMensal);
  document.getElementById('custoAFLOR').textContent          = formatarMoeda(custoAFLORMensal);
  document.getElementById('horasRecuperadasKPI').textContent = horasRecuperadas.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' h/mês';

  // - Relatório executivo - campos de resultado -
  document.getElementById('reportInvestimento').textContent = formatarMoeda(custoAFLORMensal);
  document.getElementById('reportEconomia').textContent     = formatarMoeda(economiaMensal);
  document.getElementById('docDate').textContent            = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  document.getElementById('rp_ganhoAnual').textContent  = formatarMoeda(ganhoAnual);
  document.getElementById('rp_roi').textContent         = roiPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  document.getElementById('rp_payback').textContent     = paybackAplicavel
    ? payback.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' meses'
    : 'Não aplicável';
  document.getElementById('rp_colabs').textContent      = colaboradores + (colaboradores === 1 ? ' pessoa' : ' pessoas');
  document.getElementById('rp_pColabs').textContent     = colaboradores;
  document.getElementById('rp_pSalario').textContent    = formatarMoeda(salario);
  document.getElementById('rp_pMinutos').textContent    = minutosPerdidos + ' min/dia';
  document.getElementById('rp_pFormularios').textContent = formularios + '/dia';

  document.getElementById('rp_tCustoPapel').textContent  = formatarMoeda(custoPapelMensal);
  document.getElementById('rp_tCustoTempo').textContent  = formatarMoeda(custoTempoMensal);
  document.getElementById('rp_tCustoOp').textContent     = formatarMoeda(CUSTO_SERVICOS_AFETADOS);
  document.getElementById('rp_tDifPapel').textContent    = formatarMoeda(custoPapelMensal);
  document.getElementById('rp_tDifTempo').textContent    = formatarMoeda(custoTempoMensal);
  document.getElementById('rp_tDifOp').textContent       = formatarMoeda(CUSTO_SERVICOS_AFETADOS);
  document.getElementById('rp_tAFLOR').textContent       = formatarMoeda(custoAFLORMensal);
  document.getElementById('rp_tTotalManual').textContent = formatarMoeda(custoManualMensal);
  document.getElementById('rp_tTotalAFLOR').textContent  = formatarMoeda(custoAFLORMensal);
  document.getElementById('rp_tEconomia').textContent    = formatarMoeda(economiaMensal);

  // - Narrativa de análise (condicional) -
  const paybackTexto = paybackAplicavel
    ? `Tempo de recuperação estimado em <strong>${payback.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} meses</strong>.`
    : `Nos parâmetros informados, o investimento na estrutura AFLOR não gera economia financeira direta em relação ao custo atual.`;

  const economiaTexto = economiaMensal > 0
    ? `gerando uma <strong>diferença mensal de ${formatarMoeda(economiaMensal)}</strong> em relação ao custo do processo atual`
    : `apresentando um custo mensal de <strong>${formatarMoeda(custoAFLORMensal)}</strong>, enquanto o processo atual acumula <strong>${formatarMoeda(custoManualMensal)}</strong>`;

  const roiTexto = economiaMensal > 0
    ? `O indicador de retorno aponta <strong>${roiPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong> — para cada R$ 1,00 investido, a operação recupera R$ ${(economiaMensal / custoAFLORMensal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em eficiência.`
    : `O indicador de retorno é de <strong>${roiPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong> — o custo atual não supera o investimento na estrutura AFLOR no cenário descrito.`;

  document.getElementById('reportAnalysis').innerHTML = `
    <div class="doc-narrative">
      <div class="narrative-block">
        <div class="narrative-heading"> Cenário Atual — Processo Sem Automação</div>
        <div class="narrative-text">
          Com <strong>${colaboradores} colaborador${colaboradores > 1 ? 'es' : ''}</strong> realizando <strong>${formularios} formulário${formularios > 1 ? 's' : ''}/dia</strong>,
          o custo total mensal do processo sem automação chega a <strong>${formatarMoeda(custoManualMensal)}</strong>.
          Desse valor, <strong>${formatarMoeda(custoTempoMensal)}</strong> correspondem ao tempo improdutivo
          (<strong>${minutosPerdidos} min/dia/colaborador</strong>) e <strong>${formatarMoeda(custoPapelMensal)}</strong>
          ao consumo de materiais e formulários.
        </div>
      </div>
      <div class="narrative-block accent">
        <div class="narrative-heading"> Estrutura AFLOR — Automação e Padronização do Fluxo</div>
        <div class="narrative-text">
          O investimento mensal no ecossistema AFLOR de automação inteligente é de <strong>${formatarMoeda(custoAFLORMensal)}</strong>,
          ${economiaTexto}.
          ${paybackTexto}
        </div>
      </div>
      <div class="narrative-block accent-b">
        <div class="narrative-heading"> Análise de Eficiência Operacional</div>
        <div class="narrative-text">
          ${roiTexto}
          A equipe pode recuperar até <strong>${Math.round(horasRecuperadas)} horas/mês</strong>
          antes ocupadas com atividades manuais, com potencial de redução de sobrecarga e
          ganho de capacidade operacional para tarefas de maior valor.
        </div>
      </div>
      <div class="narrative-block">
        <div class="narrative-heading"> Benefícios Adicionais (não mensurados)</div>
        <div class="narrative-text">
          Além dos indicadores financeiros, a estrutura AFLOR contribui com
          <strong>rastreabilidade, padronização do fluxo, acesso em tempo real e redução de retrabalho</strong>,
          fortalecendo a tomada de decisão futura baseada em dados.
        </div>
      </div>
    </div>
  `;

  // - Recomendação condicional — usada na web e no PDF -
  // Texto vem do motor ICO; garante consistência entre ambas as visões.
  const proximoPasso = gerarProximoPasso({ icoScore: ico.icoScore, economiaMensal, horasRecuperadas });
  setTextIfExists('rp_recTitle',    proximoPasso.title);
  setTextIfExists('rp_recBody',     proximoPasso.body);
  setTextIfExists('pr_recTitlePdf', proximoPasso.title);
  setTextIfExists('pr_recBodyPdf',  proximoPasso.body);
  document.getElementById('pr_pdfRecText').innerHTML = ico.icoRecomendacao;

  // - Bloco IOA — web -
  setTextIfExists('icoScore',       ico.icoScore);
  setTextIfExists('icoFaixa',       ico.icoFaixa);
  setTextIfExists('icoTitulo',      ico.icoTitulo);
  setHtmlIfExists('icoRecomendacao', ico.icoRecomendacao);
  setWidthIfExists('icoBarFill',    ico.icoScore + '%');

  // - Bloco IOA — PDF/print -
  setTextIfExists('pr_icoScore',       ico.icoScore);
  setTextIfExists('pr_icoFaixa',       ico.icoFaixa);
  setTextIfExists('pr_icoTitulo',      ico.icoTitulo);
  setHtmlIfExists('pr_icoRecomendacao', ico.icoRecomendacao);
  setWidthIfExists('pr_icoBarFill',    ico.icoScore + '%');

  // - Layout PDF - campos de resultado -
  document.getElementById('pr_date').textContent       = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('pr_ganhoAnual').textContent = formatarMoeda(ganhoAnual);
  document.getElementById('pr_roi').textContent        = roiPercentual.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '%';
  document.getElementById('pr_payback').textContent    = paybackAplicavel
    ? payback.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' meses'
    : 'Não aplicável';
  document.getElementById('pr_horas').textContent      = horasRecuperadas.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' h/mês';

  // Parâmetros no layout PDF
  document.getElementById('pdf-empresa').textContent       = (document.getElementById('lead_empresa')?.value || '').trim() || '-';
  document.getElementById('pdf-colaboradores').textContent = colaboradores;
  document.getElementById('pdf-salario').textContent       = formatarMoeda(salario);
  document.getElementById('pdf-formularios').textContent   = formularios;
  document.getElementById('pdf-minutos').textContent       = minutosPerdidos + ' min';

  // Novos campos PDF — nome e investimento AFLOR
  setTextIfExists('pdf-nome',        (document.getElementById('lead_nome')?.value || '').trim() || '-');
  setTextIfExists('pr_investimento', formatarMoeda(custoAFLORMensal));

  // — Monta payload de persistência com valores numéricos brutos —
  // Atualizado a cada cálculo; consumido por salvarDiagnostico().
  // Os campos do índice ICO são adicionados sem remover campos existentes.
  ultimoPayloadDiagnostico = {
    data:       new Date().toISOString(),
    dataLocale: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    lead: {
      nome:    (document.getElementById('lead_nome')?.value    || '').trim(),
      cargo:   '',
      empresa: (document.getElementById('lead_empresa')?.value || '').trim(),
      email:   (document.getElementById('lead_email')?.value   || '').trim(),
      celular: (document.getElementById('lead_celular')?.value || '').trim(),
    },
    inputs: {
      colaboradores,
      salarioMedio:   salario,
      formulariosDia: formularios,
      minutosPerdidos,
    },
    resultado: {
      ganhoAnual,
      roiPercentual,
      payback,
      paybackAplicavel,
      custoManualMensal,
      custoAFLORMensal,
      economiaMensal,
      horasRecuperadas,
      custoPapelMensal,
      custoTempoMensal,
      custoServicosAfetados: CUSTO_SERVICOS_AFETADOS,
      indice: {
        metodologia:    'IOA',
        nome:           'IEO',
        titulo:         'Índice de Eficiência Operacional',
        icoScore:       ico.icoScore,
        icoFaixa:       ico.icoFaixa,
        icoTitulo:      ico.icoTitulo,
        icoTipo:        ico.icoTipo,
        recomendacao:   ico.icoRecomendacao,
        scoreFinanceiro: ico.scoreFinanceiro,
        scoreTempo:     ico.scoreTempo,
        scoreRetorno:   ico.scoreRetorno,
      },
    },
  };
}


function gerarDiagnostico() {
  if (!validarCamposLead()) {
    return;
  }

  const loadingEl = document.getElementById('diagnosis-loading');
  const reportEl  = document.querySelector('.exec-report');
  const contentEl = document.querySelector('.content');

  contentEl?.classList.remove('has-result');

  if (reportEl) {
    reportEl.style.display = 'none';
  }

  if (loadingEl) {
    loadingEl.classList.add('visible');
    loadingEl.setAttribute('aria-hidden', 'false');
  }

  calcularROI();

  // Persiste diagnóstico ao gerar — cria linha apenas se ainda não existe
  salvarDiagnostico('diagnostico').catch(e => {
    console.warn('[AFLOR] Falha silenciosa ao salvar diagnóstico:', e);
  });

  window.setTimeout(function () {
    if (loadingEl) {
      loadingEl.classList.remove('visible');
      loadingEl.setAttribute('aria-hidden', 'true');
    }

    contentEl?.classList.add('has-result');

    if (reportEl) {
      reportEl.style.display = '';
      reportEl.scrollIntoView({
        behavior: 'smooth',
        block:    'start',
      });
    }
  }, 4000);
}


/* -- 6. LEAD / VALIDAÇÃO ----------------------------------- */

function formatarCelularLead(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 7) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)} ${digitos.slice(7)}`;
}

/**
 * Valida os campos de lead antes de salvar / gerar PDF.
 * Regras: Nome + Empresa + E-mail + Celular obrigatórios; LGPD obrigatório.
 * Retorna true se válido, false caso contrário.
 */
function validarCamposLead() {
  // Limpa destaques anteriores
  ['lead_nome', 'lead_empresa', 'lead_email', 'lead_celular'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('input-error');
  });

  const nome    = (document.getElementById('lead_nome')?.value    || '').trim();
  const empresa = (document.getElementById('lead_empresa')?.value || '').trim();
  const email   = (document.getElementById('lead_email')?.value   || '').trim();
  const celular = (document.getElementById('lead_celular')?.value || '').trim();
  const lgpd    = document.getElementById('lead_lgpd')?.checked;
  const emailValido    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const celularDigitos = celular.replace(/\D/g, '');

  // Regra 1 - Nome e Empresa obrigatórios
  const erros = [];
  if (!nome) {
    document.getElementById('lead_nome').classList.add('input-error');
    erros.push('• Nome completo é obrigatório.');
  }
  if (!empresa) {
    document.getElementById('lead_empresa').classList.add('input-error');
    erros.push('• Empresa é obrigatória.');
  }
  if (erros.length > 0) {
    alert('Por favor, corrija os seguintes campos:\n\n' + erros.join('\n'));
    document.getElementById('lead_nome').focus();
    return false;
  }

  if (!email || !emailValido) {
    document.getElementById('lead_email').classList.add('input-error');
    erros.push('• E-mail corporativo válido é obrigatório.');
  }
  if (celularDigitos.length !== 11) {
    document.getElementById('lead_celular').classList.add('input-error');
    erros.push('• Celular (WhatsApp) deve conter 11 dígitos.');
  }
  if (erros.length > 0) {
    alert('Por favor, corrija os seguintes campos:\n\n' + erros.join('\n'));
    document.getElementById('lead_email').focus();
    return false;
  }

  // Regra 3 - Consentimento LGPD obrigatório
  if (!lgpd) {
    alert('É necessário autorizar o uso dos dados conforme a LGPD para continuar.');
    document.getElementById('lead_lgpd').focus();
    return false;
  }

  return true;
}


/* ── 7. PERSISTÊNCIA — APPS SCRIPT + GOOGLE SHEETS ───────── */

// URL /exec gerada no deploy do Web App (Apps Script)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8PlLvAcCWBp5eCq_p1uOwTH7ZwHfKWVisNRqNAvWXVO79kLrDNrz1dY34Y6TfIA/exec';

/**
 * Persiste o diagnóstico via Apps Script → Google Sheets.
 *
 * acao = 'diagnostico' → cria nova linha (apenas se diagnosticoSheetId === null).
 * acao = 'pdf'         → atualiza a linha existente marcando pdf_gerado.
 *                        Se não houver linha ainda, cria primeiro e em seguida
 *                        dispara a atualização de PDF.
 *
 * Não relê DOM — consome o payload montado em calcularROI().
 * fetch() simples sem headers customizados para evitar preflight CORS.
 */
async function salvarDiagnostico(acao) {

  // Garante payload disponível mesmo se calcularROI() ainda não foi chamado
  if (!ultimoPayloadDiagnostico) {
    calcularROI();
  }
  // Se após o cálculo o payload ainda for null, campos obrigatórios não foram preenchidos
  if (!ultimoPayloadDiagnostico) {
    console.warn('[AFLOR] salvarDiagnostico ignorado — campos obrigatórios não preenchidos.');
    return;
  }

  // Atualiza dados de lead no momento do salvamento (podem ter sido
  // preenchidos após o último calcularROI())
  ultimoPayloadDiagnostico.lead = {
    nome:    (document.getElementById('lead_nome')?.value    || '').trim(),
    cargo:   '',
    empresa: (document.getElementById('lead_empresa')?.value || '').trim(),
    email:   (document.getElementById('lead_email')?.value   || '').trim(),
    celular: (document.getElementById('lead_celular')?.value || '').trim(),
  };

  // ── Caso 1: atualização de PDF com linha já existente ──
  if (acao === 'pdf' && diagnosticoSheetId) {
    const payloadPdf = {
      id:   diagnosticoSheetId,
      acao: 'pdf',
    };
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body:   JSON.stringify(payloadPdf),
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.erro || 'Erro ao atualizar PDF.');
    }
    console.info('[AFLOR] PDF registrado. ID:', result.id, '| action:', result.action);
    return;
  }

  // ── Caso 2: criação de nova linha (diagnóstico ainda não salvo) ──
  if (!diagnosticoSheetId) {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body:   JSON.stringify(ultimoPayloadDiagnostico),
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.erro || 'Erro ao salvar diagnóstico.');
    }
    diagnosticoSheetId = result.id;
    console.info('[AFLOR] Diagnóstico salvo. ID:', diagnosticoSheetId, '| action:', result.action);

    // Se a ação era PDF, precisa marcar a linha recém-criada
    if (acao === 'pdf') {
      const payloadPdf = {
        id:   diagnosticoSheetId,
        acao: 'pdf',
      };
      const responsePdf = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body:   JSON.stringify(payloadPdf),
      });
      const resultPdf = await responsePdf.json();
      if (!resultPdf.ok) {
        throw new Error(resultPdf.erro || 'Erro ao marcar PDF após criação.');
      }
      console.info('[AFLOR] PDF registrado após criação. ID:', resultPdf.id, '| action:', resultPdf.action);
    }
    return;
  }

  // ── Caso 3: diagnóstico já salvo, ação = 'diagnostico' ──
  // Linha já existe; não cria duplicata. Apenas loga.
  console.info('[AFLOR] Diagnóstico já persistido. ID:', diagnosticoSheetId, '— criação ignorada.');
}


/* -- 8. IMPRESSÃO / PDF ------------------------------------ */

/**
 * Orquestra o fluxo completo antes de imprimir:
 *   1. Valida campos de lead (LGPD)
 *   2. Salva/atualiza no Google Sheets via Apps Script (não bloqueia se falhar)
 *   3. Dispara window.print()
 *
 * Chamada pelo botão "Gerar Relatório PDF" no HTML (onclick="imprimirRelatorio()").
 */
async function imprimirRelatorio() {
  if (!validarCamposLead()) return;

  try {
    await salvarDiagnostico('pdf');
  } catch (e) {
    // Falha silenciosa — o PDF é gerado mesmo sem salvar
    console.warn('[AFLOR] Erro ao registrar PDF:', e);
  }

  document.getElementById('pdf-empresa').textContent = (document.getElementById('lead_empresa')?.value || '').trim();
  const nomeEl = document.getElementById('pdf-nome');
  if (nomeEl) nomeEl.textContent = (document.getElementById('lead_nome')?.value || '').trim();
  window.print();
}


/* -- 9. INICIALIZAÇÃO E EVENTOS ---------------------------- */

// Calcula na carga inicial da página
window.addEventListener('load', calcularROI);

// Recalcula em tempo real a cada alteração nos campos
['colaboradores', 'minutosPerdidos', 'formularios'].forEach(id => {
  document.getElementById(id).addEventListener('change', calcularROI);
  document.getElementById(id).addEventListener('input',  calcularROI);
});

// Salário: aplica máscara BRL e recalcula (listener único para evitar duplo disparo)
const salarioInput = document.getElementById('salario');
if (salarioInput) {
  salarioInput.addEventListener('input', () => {
    formatarInputMoedaBR(salarioInput);
    calcularROI();
  });
  salarioInput.addEventListener('change', () => {
    formatarInputMoedaBR(salarioInput);
    calcularROI();
  });
}

document.getElementById('lead_celular').addEventListener('input', (event) => {
  event.target.value = formatarCelularLead(event.target.value);
});

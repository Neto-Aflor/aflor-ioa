/* -------------------------------------------------------------
   AFLOR · Diagnóstico Operacional
   scripts.js - versão organizada
   -------------------------------------------------------------
   Blocos:
     1. Configuração - constantes e registro de plugins
     2. Cálculo - funções de custo e ROI
     3. Utilitários - formatação e gráficos
     4. Atualização de Interface - KPIs e DOM
     5. Relatório - narrativa, tabela e PDF
     6. Lead / Formulário - validação LGPD
     7. Persistência Apps Script + Google Sheets
        ATENCAO Bloco isolado - substituir por Apps Script + Sheets
     8. Impressão / PDF - orquestra validação + save + print
     9. Inicialização e Eventos
------------------------------------------------------------- */


/* -- 1. CONFIGURACAO ---------------------------------------- */

Chart.register(ChartDataLabels);

const DIAS_SEMANA             = 5;
const FATOR_DIAS              = DIAS_SEMANA * 4;  // 20 dias úteis/mês
const HORAS_MES               = 220;              // horas mensais totais
const CUSTO_SERVICOS_AFETADOS = 200;              // custo fixo de serviços impactados (R$)
const CUSTO_PAPEL_FIXO        = 1.30;             // custo unitário por formulário em papel (R$)

let charts = {};  // registro dos gráficos ativos para destruição/recriação

/**
 * Último payload calculado - atualizado em cada execução de calcularROI().
 * Usado por salvarDiagnostico() para evitar leitura de textContent do DOM.
 * Na migração para Apps Script, este objeto é o body do fetch().
 */
let ultimoPayloadDiagnostico = null;


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
 * Compõe: papel + tempo improdutivo + custo de serviços afetados.
 */
function calcularCustoManual(colaboradores, salario, minutos, formularios, custoPapel) {
  const custoPapelMensal = (formularios * custoPapel * colaboradores) * FATOR_DIAS;
  const custoTempoMensal = ((minutos / 60) * ((salario * 1.7) / HORAS_MES) * colaboradores) * FATOR_DIAS;
  return custoPapelMensal + custoTempoMensal + CUSTO_SERVICOS_AFETADOS;
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


/* -- 4. ATUALIZACAO DE INTERFACE (KPIs) + 5. RELATÓRIO ------ */

/**
 * Lê os inputs do formulário, recalcula todos os indicadores
 * e atualiza KPIs + gráficos + relatório executivo + layout PDF.
 * Chamada por: evento load, change/input nos campos, botão "Gerar Diagnóstico".
 */
function calcularROI() {

  // - Leitura dos inputs -
  const colaboradores   = parseFloat(document.getElementById('colaboradores').value)   || 1;
  const salario         = parseFloat(document.getElementById('salario').value)         || 3242;
  const minutosPerdidos = parseFloat(document.getElementById('minutosPerdidos').value) || 150;
  const formularios     = parseFloat(document.getElementById('formularios').value)     || 3;
  const custoPapel      = CUSTO_PAPEL_FIXO;

  // - Cálculos principais -
  const custoPapelMensal  = (formularios * custoPapel * colaboradores) * FATOR_DIAS;
  const custoTempoMensal  = ((minutosPerdidos / 60) * ((salario * 1.7) / HORAS_MES) * colaboradores) * FATOR_DIAS;
  const custoManualMensal = calcularCustoManual(colaboradores, salario, minutosPerdidos, formularios, custoPapel);
  const custoAFLORMensal  = calcularCustoAFLOR(colaboradores);
  const economiaMensal    = custoManualMensal - custoAFLORMensal;
  const ganhoAnual        = economiaMensal * 12;
  const roiPercentual     = (economiaMensal / custoAFLORMensal) * 100;
  const payback           = custoAFLORMensal / economiaMensal;
  const retorno           = (economiaMensal / custoAFLORMensal).toFixed(2);
  // Média de 22 dias/mês para exibição visual no PDF (FATOR_DIAS + 2)
  const horasRecuperadas  = (minutosPerdidos / 60) * (FATOR_DIAS + 2) * colaboradores;

  // - KPIs principais -
  document.getElementById('ganhoAnual').textContent          = formatarMoeda(ganhoAnual);
  document.getElementById('roiPercentual').textContent       = roiPercentual.toFixed(1) + '%';
  document.getElementById('payback').textContent             = payback.toFixed(2);
  document.getElementById('custoManual').textContent         = formatarMoeda(custoManualMensal);
  document.getElementById('custoAFLOR').textContent          = formatarMoeda(custoAFLORMensal);
  document.getElementById('horasRecuperadasKPI').textContent = horasRecuperadas.toFixed(0) + ' h/mês';

  // - Gráfico comparativo (opções compartilhadas) -
  const fmtLabel = (value) => 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const chartBarOpcoes = {
    plugins: {
      legend:     { display: false },
      datalabels: { display: true, anchor: 'end', align: 'top', color: '#475569', font: { size: 9, weight: '600', family: 'JetBrains Mono' }, formatter: fmtLabel },
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: () => '', color: '#94a3b8', font: { size: 10 } }, grid: { color: '#F0F0F0' } },
      x: { grid: { display: false } },
    },
    layout: { padding: { top: 20 } },
  };

  criarOuAtualizarChart('comparisonMonthly', 'bar', {
    labels:   ['Atual (Sem Automação)', 'Com AFLOR'],
    datasets: [{ data: [custoManualMensal, custoAFLORMensal], backgroundColor: ['rgba(255,90,0,.85)', '#404045'], borderColor: ['#FF5A00', '#404045'], borderWidth: 2, borderRadius: 6 }],
  }, chartBarOpcoes);


  // - Relatório executivo - campos de resultado -
  document.getElementById('reportInvestimento').textContent = formatarMoeda(custoAFLORMensal);
  document.getElementById('reportEconomia').textContent     = formatarMoeda(economiaMensal);
  document.getElementById('docDate').textContent            = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  document.getElementById('rp_ganhoAnual').textContent  = formatarMoeda(ganhoAnual);
  document.getElementById('rp_roi').textContent         = roiPercentual.toFixed(1) + '%';
  document.getElementById('rp_payback').textContent     = payback.toFixed(1) + ' meses';
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

  // - Narrativa de análise -
  const percReducao = ((economiaMensal / custoManualMensal) * 100).toFixed(0);
  document.getElementById('reportAnalysis').innerHTML = `
    <div class="doc-narrative">
      <div class="narrative-block">
        <div class="narrative-heading"> Cenário Atual — Processo Sem Automação</div>
        <div class="narrative-text">
          Com <strong>${colaboradores} colaborador${colaboradores > 1 ? 'es' : ''}</strong> realizando <strong>${formularios} formulário${formularios > 1 ? 's' : ''}/dia</strong>,
          o custo total mensal do processo Sem Automação chega a <strong>${formatarMoeda(custoManualMensal)}</strong>.
          Desse valor, <strong>${formatarMoeda(custoTempoMensal)}</strong> correspondem ao tempo improdutivo
          (<strong>${minutosPerdidos} min/dia/colaborador</strong>) e <strong>${formatarMoeda(custoPapelMensal)}</strong>
          ao consumo de papel e materiais.
        </div>
      </div>
      <div class="narrative-block accent">
        <div class="narrative-heading"> Com a Plataforma AFLOR — Digital e Automatizado</div>
        <div class="narrative-text">
          O <strong>investimento mensal na Plataforma AFLOR é de apenas ${formatarMoeda(custoAFLORMensal)}</strong>,
          gerando uma <strong>economia de ${formatarMoeda(economiaMensal)} mensais</strong> — uma
          <strong>redução de ${percReducao}% nos custos operacionais</strong>.
          Ao longo de 12 meses, o <strong>ganho acumulado totaliza ${formatarMoeda(ganhoAnual)}</strong>,
          com <strong>Tempo de Recuperação em apenas ${payback.toFixed(1)} meses</strong>.
        </div>
      </div>
      <div class="narrative-block accent-b">
        <div class="narrative-heading"> Análise de Eficiência Operacional</div>
        <div class="narrative-text">
          O <strong>Potencial de Recuperação de ${roiPercentual.toFixed(1)}%</strong> indica que, <strong>para cada R$ 1,00 investido, a empresa obtém R$ ${retorno} em economia operacional</strong>. Trata-se de um índice elevado de retorno, com forte impacto em projetos e operações baseadas em dados.
        </div>
      </div>
      <div class="narrative-block">
        <div class="narrative-heading"> Benefícios Adicionais (não mensurados)</div>
        <div class="narrative-text">
          Além da economia direta, a <strong>AFLOR automatiza processos, reduz retrabalho, assegura rastreabilidade e acesso em tempo real</strong>, além de minimizar não conformidades — fortalecendo a gestão e a eficiência dos projetos.
        </div>
      </div>
    </div>
  `;

  // - Recomendação - usada na web e no PDF -
  const recomendacaoString = `Com <strong>Tempo de Recuperação inferior a ${payback.toFixed(1)} meses</strong> e <strong>Recuperação Mensal de ${formatarMoeda(economiaMensal)}</strong>, a iniciativa apresenta <strong>alta viabilidade financeira</strong>. A implementação é rápida e conta com suporte completo da AFLOR, garantindo uma transição segura e estruturada.`;
  document.getElementById('rp_recText').innerHTML    = recomendacaoString;
  document.getElementById('pr_pdfRecText').innerHTML = recomendacaoString;

  // - Layout PDF - campos de resultado -
  document.getElementById('pr_date').textContent       = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('pr_ganhoAnual').textContent = formatarMoeda(ganhoAnual);
  document.getElementById('pr_roi').textContent        = roiPercentual.toFixed(0) + '%';
  document.getElementById('pr_payback').textContent    = payback.toFixed(1) + ' meses';
  document.getElementById('pr_horas').textContent      = horasRecuperadas.toFixed(0) + ' h/mês';

  // Gráfico CSS puro para o PDF (não depende de canvas - sempre renderiza)
  const maxVal    = Math.max(custoManualMensal, custoAFLORMensal);
  const pctManual = Math.round((custoManualMensal / maxVal) * 92);
  const pctAflor  = Math.max(Math.round((custoAFLORMensal / maxVal) * 92), 6);
  const fmtShort  = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

  document.getElementById('pr_cssBarManual').style.height   = pctManual + '%';
  document.getElementById('pr_cssBarAflor').style.height    = pctAflor  + '%';
  document.getElementById('pr_cssBarValManual').textContent = fmtShort(custoManualMensal);
  document.getElementById('pr_cssBarValAflor').textContent  = fmtShort(custoAFLORMensal);

  // Parametros no layout PDF
  document.getElementById('pdf-empresa').textContent       = (document.getElementById('lead_empresa')?.value || '').trim() || '-';
  document.getElementById('pdf-colaboradores').textContent = colaboradores;
  document.getElementById('pdf-salario').textContent       = formatarMoeda(salario);
  document.getElementById('pdf-formularios').textContent   = formularios;
  document.getElementById('pdf-minutos').textContent       = minutosPerdidos + ' min';

  // — Monta payload de persistência com valores numéricos brutos —
  // Atualizado a cada cálculo; consumido por salvarDiagnostico().
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
      custoManualMensal,
      custoAFLORMensal,
      economiaMensal,
      horasRecuperadas,
    },
  };
}


function gerarDiagnostico() {
  if (!validarCamposLead()) {
    return;
  }

  const loadingEl = document.getElementById('diagnosis-loading');
  const reportEl = document.querySelector('.exec-report');
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

  window.setTimeout(function () {
    if (loadingEl) {
      loadingEl.classList.remove('visible');
      loadingEl.setAttribute('aria-hidden', 'true');
    }

    contentEl?.classList.add('has-result');

    if (reportEl) {
      reportEl.style.display = '';
      if (charts.comparisonMonthly) charts.comparisonMonthly.resize();
      reportEl.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, 4000);
}


/* -- 6. LEAD / FORMULÁRIO ---------------------------------- */

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
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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


/* ── 7. PERSISTÊNCIA APPS SCRIPT + GOOGLE SHEETS ────────── */

// ATENCAO Colar aqui a URL /exec gerada no deploy do Web App
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8PlLvAcCWBp5eCq_p1uOwTH7ZwHfKWVisNRqNAvWXVO79kLrDNrz1dY34Y6TfIA/exec';

/**
 * Persiste ultimoPayloadDiagnostico via Apps Script -> Google Sheets.
 * Não relê DOM - consome o payload montado em calcularROI().
 * fetch() simples sem headers customizados para evitar preflight CORS.
 */
async function salvarDiagnostico() {
  // Garante payload disponível mesmo se calcularROI() ainda não foi chamado
  if (!ultimoPayloadDiagnostico) {
    calcularROI();
  }

  // Atualiza os dados de lead no momento do salvamento (podem ter sido
  // preenchidos após o último calcularROI())
  ultimoPayloadDiagnostico.lead = {
    nome:    (document.getElementById('lead_nome')?.value    || '').trim(),
    cargo:   '',
    empresa: (document.getElementById('lead_empresa')?.value || '').trim(),
    email:   (document.getElementById('lead_email')?.value   || '').trim(),
    celular: (document.getElementById('lead_celular')?.value || '').trim(),
  };

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body:   JSON.stringify(ultimoPayloadDiagnostico),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.erro || 'Erro ao salvar diagnóstico.');
  }

  console.info('[AFLOR] Diagnóstico salvo com sucesso. ID:', result.id);
}


/* -- 8. IMPRESSAO / PDF ------------------------------------- */

/**
 * Orquestra o fluxo completo antes de imprimir:
 *   1. Valida campos de lead (LGPD)
 *   2. Salva no Google Sheets via Apps Script (não bloqueia se falhar)
 *   3. Dispara window.print()
 *
 * Chamada pelo botão "Gerar Relatório PDF" no HTML (onclick="imprimirRelatorio()").
 */
async function imprimirRelatorio() {
  if (!validarCamposLead()) return;

  try {
    await salvarDiagnostico();
  } catch (e) {
    // Falha silenciosa — o PDF é gerado mesmo sem salvar
    console.error('[AFLOR] Erro ao salvar diagnóstico:', e);
  }

  document.getElementById('pdf-empresa').textContent = (document.getElementById('lead_empresa')?.value || '').trim();
  window.print();
}


/* -- 9. INICIALIZACAO E EVENTOS ----------------------------- */

// Calcula na carga inicial da página
window.addEventListener('load', calcularROI);

// Recalcula em tempo real a cada alteração nos campos
['colaboradores', 'salario', 'minutosPerdidos', 'formularios'].forEach(id => {
  document.getElementById(id).addEventListener('change', calcularROI);
  document.getElementById(id).addEventListener('input',  calcularROI);
});

document.getElementById('lead_celular').addEventListener('input', (event) => {
  event.target.value = formatarCelularLead(event.target.value);
});

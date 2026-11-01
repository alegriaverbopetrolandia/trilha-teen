/**
 * TRILHA TEEN – Escola Bíblica para Pré-Adolescentes
 * Code.gs – ligação com a Planilha Google, a página do app e a IA (Gemini).
 *
 * COMO INSTALAR (resumo – veja o guia completo):
 *  1. Crie uma Planilha Google nova  →  Extensões  →  Apps Script.
 *  2. Crie os arquivos Code.gs, Core.gs, Seed.gs e Index.html e cole o conteúdo de cada um.
 *  3. Selecione a função "instalar" lá em cima e clique em Executar (autorize).
 *  4. Implantar → Nova implantação → App da Web → Executar como: Eu → Acesso: Qualquer pessoa.
 */

var _CACHE = {};

function doGet() {
  var c = {};
  try { c = _cfg(); } catch (e) { c = CONFIG_PADRAO; }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(c.nomeApp + ' – ' + c.igreja)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Execute UMA vez pelo editor do Apps Script. Cria as abas e carrega as 52 lições de 2027. */
function instalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Abra o Apps Script pela planilha (Extensões → Apps Script).');
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  ss.setSpreadsheetTimeZone('America/Sao_Paulo');
  Object.keys(TABELAS).forEach(function (nome) { _aba(nome); });
  if (DB.all('Licoes').length === 0) {
    var linhas = SEED_LICOES.map(function (l) {
      return TABELAS.Licoes.map(function (k) { return k === 'conteudo' ? JSON.stringify(l.conteudo || {}) : (l[k] == null ? '' : String(l[k])); });
    });
    var sh = _aba('Licoes');
    var rg = sh.getRange(2, 1, linhas.length, TABELAS.Licoes.length);
    rg.setNumberFormat('@');
    rg.setValues(linhas);
    _CACHE = {};
  }
  var padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1) ss.deleteSheet(padrao);
  Logger.log('Pronto! Agora faça: Implantar → Nova implantação → App da Web.');
}

/**
 * ATUALIZAÇÃO DAS LIÇÕES (rodar uma vez depois de colar o novo Seed.gs).
 * Preenche as lições que ainda estão "planejadas" com o conteúdo completo.
 * NÃO altera lições que você já editou ou gerou com a IA.
 */
function atualizarLicoes() {
  var atuais = DB.all('Licoes');
  var porId = {};
  atuais.forEach(function (l) { porId[l.id] = l; });
  var atualizadas = 0, preservadas = [], novas = 0;
  SEED_LICOES.forEach(function (s) {
    var ex = porId[s.id];
    if (!ex) {
      DB.insert('Licoes', { id: s.id, semana: s.semana, data: s.data, trimestre: s.trimestre, eixo: s.eixo, mes: s.mes, titulo: s.titulo,
        textoBase: s.textoBase, resumo: s.resumo, status: s.status, conteudo: JSON.stringify(s.conteudo || {}), atualizadoEm: '' });
      novas++;
      return;
    }
    if (s.status !== 'completa') return;
    if (ex.atualizadoEm) { preservadas.push(ex.semana + '. ' + ex.titulo); return; } // editada pelo app: não mexe
    DB.update('Licoes', ex.id, { status: 'completa', conteudo: JSON.stringify(s.conteudo), mes: ex.mes || s.mes });
    atualizadas++;
  });
  var msg = 'Pronto! ' + atualizadas + ' lições atualizadas' + (novas ? ', ' + novas + ' lições novas' : '') + '.';
  if (preservadas.length) msg += ' Mantidas como estavam (você já tinha editado): ' + preservadas.join('; ');
  Logger.log(msg);
  return msg;
}

function _planilha() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
    if (!id) throw new Error('Execute a função "instalar" primeiro.');
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function _aba(nome) {
  var ss = _planilha();
  var sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    var cols = TABELAS[nome];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#e0e7ff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  }
  return sh;
}

function _celula(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

var DB = {
  _ler: function (tabela) {
    if (_CACHE[tabela]) return _CACHE[tabela];
    var sh = _aba(tabela);
    var cols = TABELAS[tabela];
    var n = sh.getLastRow();
    var linhas = n > 1 ? sh.getRange(2, 1, n - 1, cols.length).getValues() : [];
    _CACHE[tabela] = linhas.map(function (r, i) {
      var o = { _linha: i + 2 };
      cols.forEach(function (k, j) { o[k] = _celula(r[j]); });
      return o;
    }).filter(function (o) { return o[cols[0]] !== ''; });
    return _CACHE[tabela];
  },
  all: function (tabela) {
    return DB._ler(tabela).map(function (o) { var c = {}; for (var k in o) if (k !== '_linha') c[k] = o[k]; return c; });
  },
  insert: function (tabela, obj) {
    var sh = _aba(tabela);
    var cols = TABELAS[tabela];
    var linha = sh.getLastRow() + 1;
    var rg = sh.getRange(linha, 1, 1, cols.length);
    rg.setNumberFormat('@');
    rg.setValues([cols.map(function (k) { return obj[k] == null ? '' : String(obj[k]); })]);
    delete _CACHE[tabela];
  },
  update: function (tabela, id, patch) {
    var chave = TABELAS[tabela][0];
    var reg = DB._ler(tabela).filter(function (o) { return o[chave] === id; })[0];
    if (!reg) throw new Error('Registro não encontrado.');
    var sh = _aba(tabela);
    var cols = TABELAS[tabela];
    var novo = cols.map(function (k) { return patch.hasOwnProperty(k) ? (patch[k] == null ? '' : String(patch[k])) : reg[k]; });
    var rg = sh.getRange(reg._linha, 1, 1, cols.length);
    rg.setNumberFormat('@');
    rg.setValues([novo]);
    delete _CACHE[tabela];
  },
  remove: function (tabela, id) {
    var chave = TABELAS[tabela][0];
    var reg = DB._ler(tabela).filter(function (o) { return o[chave] === id; })[0];
    if (reg) _aba(tabela).deleteRow(reg._linha);
    delete _CACHE[tabela];
  },
  setConfig: function (chave, valor) {
    var ex = DB._ler('Config').filter(function (o) { return o.chave === chave; })[0];
    if (ex) DB.update('Config', chave, { valor: valor }); else DB.insert('Config', { chave: chave, valor: valor });
  },
  appUrl: function () { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } },
  getSecret: function (k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; },
  setSecret: function (k, v) {
    if (v) PropertiesService.getScriptProperties().setProperty(k, v);
    else PropertiesService.getScriptProperties().deleteProperty(k);
  },
  comTrava: function (escrita, fn) {
    if (!escrita) return fn();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { return fn(); } finally { lock.releaseLock(); }
  },
  /** Chama o Gemini (Google AI Studio). A chave é cadastrada em Configurações no app. */
  ia: function (prompt, comoJson, modelo) {
    var chave = DB.getSecret('geminiChave');
    if (!chave) throw new Error('A IA ainda não foi ativada. A coordenação deve cadastrar a chave do Gemini em Configurações.');
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + (modelo || 'gemini-3.8-flash') + ':generateContent?key=' + encodeURIComponent(chave);
    var corpo = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } };
    if (comoJson) corpo.generationConfig.responseMimeType = 'application/json';
    var r, j, cod, esperas = [0, 3000, 7000, 15000];
    for (var t = 0; t < esperas.length; t++) {
      if (esperas[t]) Utilities.sleep(esperas[t]);
      r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true });
      cod = r.getResponseCode();
      try { j = JSON.parse(r.getContentText() || '{}'); } catch (e) { j = {}; }
      if (cod !== 429 && cod !== 500 && cod !== 503) break; // só repete quando o Google está sobrecarregado
    }
    if (cod !== 200) {
      var msg = (j.error && j.error.message) || ('erro ' + cod);
      if (cod === 503 || cod === 429 || /high demand|overloaded|quota|rate/i.test(msg))
        throw new Error('A IA do Google está sobrecarregada ou atingiu o limite gratuito neste momento. Tentei 4 vezes. Aguarde alguns minutos e tente de novo.');
      throw new Error('A IA respondeu com erro: ' + msg);
    }
    var partes = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    return partes.map(function (p) { return p.text || ''; }).join('');
  }
};

/** Chamado pelo app hospedado fora do Google (GitHub Pages / Cloudflare). */
function doPost(e) {
  var saida;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    saida = apiWeb(req.acao, JSON.stringify(req.dados || {}), JSON.stringify(req.cred || null));
  } catch (err) {
    saida = JSON.stringify({ ok: false, erro: String(err.message || err) });
  }
  return ContentService.createTextOutput(saida).setMimeType(ContentService.MimeType.JSON);
}

/** Chamado pela tela do app. */
function apiWeb(acao, dadosJson, credJson) {
  try {
    var r = api(acao, JSON.parse(dadosJson || '{}'), JSON.parse(credJson || 'null'));
    return JSON.stringify({ ok: true, r: r });
  } catch (e) {
    return JSON.stringify({ ok: false, erro: String(e.message || e) });
  }
}

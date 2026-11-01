/**
 * TRILHA TEEN – Escola Bíblica para Pré-Adolescentes
 * Core.gs – regras do sistema (funciona no Google Apps Script e no modo demonstração).
 * Não é preciso alterar este arquivo.
 */

var TABELAS = {
  Professores: ['id','nome','whatsapp','email','pin','perfil','ativo','criadoEm'],
  Alunos: ['id','nome','nascimento','turma','whatsapp','responsavel1','parentesco1','whatsResp1','responsavel2','parentesco2','whatsResp2','codigo','obs','ativo','criadoEm'],
  Licoes: ['id','semana','data','trimestre','eixo','mes','titulo','textoBase','resumo','status','conteudo','atualizadoEm'],
  Presenca: ['id','data','turma','alunoId','status','licaoId','professorId','registradoEm'],
  Entregas: ['id','alunoId','licaoId','respostas','acertos','total','situacao','enviadoEm','feedback','nota','corrigidoPor','corrigidoEm'],
  Mensagens: ['id','data','tipo','alunoId','destino','texto','por'],
  Config: ['chave','valor']
};

var CONFIG_PADRAO = {
  nomeApp: 'Trilha Teen',
  igreja: 'Nossa Igreja',
  subtitulo: 'Escola Bíblica para Pré-Adolescentes (11 a 14 anos)',
  turmas: 'Pré-Adolescentes',
  anoLetivo: '2027',
  corPrincipal: '#4f46e5',
  geminiModelo: 'gemini-3.8-flash',
  profEditaLicoes: 'nao',
  msgFaltaAluno: 'Oi, {aluno}! Aqui é {professor}, da Escola Bíblica. Sentimos muito a sua falta no último domingo! A aula foi sobre "{licao}". Está tudo bem com você? Estamos orando por você e esperamos você no próximo domingo! 💜',
  msgFaltaPais: 'Olá, {responsavel}! Aqui é {professor}, professor(a) da Escola Bíblica de {aluno} na {igreja}. Sentimos falta de {aluno} na aula do último domingo ({data}), sobre "{licao}". Está tudo bem com vocês? Se precisarem de algo, contem conosco. Deus abençoe!',
  msgTarefa: 'Oi, {aluno}! Já fez a tarefa de casa da lição "{licao}"? Entre no app com o seu código {codigo} e responda. Conto com você! 📖',
  msgAniversario: 'Feliz aniversário, {aluno}! 🎉 Toda a turma da Escola Bíblica agradece a Deus pela sua vida. "O SENHOR te abençoe e te guarde" (Números 6:24).',
  msgCodigo: 'Olá, {responsavel}! {aluno} já tem acesso ao app {nomeApp} da Escola Bíblica. Lá ele(a) revê as lições e faz a tarefa de casa.\n\n📲 Link: {link}\n🔑 Código de acesso: {codigo}',
  linkApp: ''
};

/* ---------------- utilidades ---------------- */
function _id(prefixo) {
  var s = '';
  var chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return (prefixo || '') + s;
}
function _agora() { return _fmtData(new Date()) + ' ' + _pad(new Date().getHours()) + ':' + _pad(new Date().getMinutes()); }
function _pad(n) { return (n < 10 ? '0' : '') + n; }
function _fmtData(d) { return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
function _hoje() { return _fmtData(new Date()); }
function _semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function _json(s, padrao) { try { return s ? JSON.parse(s) : padrao; } catch (e) { return padrao; } }
function _erro(msg) { throw new Error(msg); }

function _codigoAluno(nome) {
  var base = _semAcento(nome).replace(/[^a-z]/g, '').toUpperCase().slice(0, 3) || 'ALU';
  var existentes = DB.all('Alunos').map(function (a) { return a.codigo; });
  var c;
  do { c = base + '-' + (1000 + Math.floor(Math.random() * 9000)); } while (existentes.indexOf(c) >= 0);
  return c;
}

/** Interpreta o texto da tarefa.
 * DESAFIO: texto        → desafio prático
 * ? pergunta            → múltipla escolha (linhas seguintes: "* correta" ou "- errada")
 * ?? pergunta           → pergunta aberta
 */
function parseTarefa(txt) {
  var out = { desafio: '', questoes: [] };
  var atual = null;
  String(txt || '').split(/\r?\n/).forEach(function (linha) {
    var l = linha.trim();
    if (!l) return;
    if (/^DESAFIO:/i.test(l)) { out.desafio = l.replace(/^DESAFIO:\s*/i, ''); atual = null; return; }
    if (l.indexOf('??') === 0) { atual = { tipo: 'aberta', enunciado: l.slice(2).trim() }; out.questoes.push(atual); return; }
    if (l.charAt(0) === '?') { atual = { tipo: 'mc', enunciado: l.slice(1).trim(), opcoes: [], correta: -1 }; out.questoes.push(atual); return; }
    if (atual && atual.tipo === 'mc' && (l.charAt(0) === '*' || l.charAt(0) === '-')) {
      if (l.charAt(0) === '*') atual.correta = atual.opcoes.length;
      atual.opcoes.push(l.slice(1).trim());
      return;
    }
    if (atual) atual.enunciado += ' ' + l; else out.desafio += (out.desafio ? ' ' : '') + l;
  });
  return out;
}

/* ---------------- autenticação ---------------- */
function _cfg() {
  var c = {};
  for (var k in CONFIG_PADRAO) c[k] = CONFIG_PADRAO[k];
  DB.all('Config').forEach(function (r) { c[r.chave] = r.valor; });
  return c;
}

function _auth(cred, exigir) {
  if (!cred || !cred.tipo) _erro('Sessão expirada. Entre novamente.');
  if (cred.tipo === 'aluno') {
    var a = DB.all('Alunos').filter(function (x) { return x.id === cred.id && String(x.codigo).toUpperCase() === String(cred.pin).toUpperCase() && x.ativo !== 'nao'; })[0];
    if (!a) _erro('Código inválido. Entre novamente.');
    if (exigir && exigir !== 'aluno') _erro('Acesso permitido apenas para professores.');
    return { tipo: 'aluno', aluno: a };
  }
  var p = DB.all('Professores').filter(function (x) { return x.id === cred.id && String(x.pin) === String(cred.pin) && x.ativo !== 'nao'; })[0];
  if (!p) _erro('PIN inválido. Entre novamente.');
  if (exigir === 'aluno') _erro('Acesso apenas para alunos.');
  if (exigir === 'coord' && p.perfil !== 'coord') _erro('Somente a coordenação pode fazer isso.');
  return { tipo: 'prof', prof: p, coord: p.perfil === 'coord' };
}

function _semPin(p) { return { id: p.id, nome: p.nome, whatsapp: p.whatsapp, email: p.email, perfil: p.perfil, ativo: p.ativo, criadoEm: p.criadoEm }; }

/* ---------------- ações ---------------- */
var ACOES = {
  estado: function () {
    var profs = DB.all('Professores').filter(function (p) { return p.ativo !== 'nao'; });
    var c = _cfg();
    return { configurado: profs.length > 0, nomeApp: c.nomeApp, igreja: c.igreja, subtitulo: c.subtitulo, corPrincipal: c.corPrincipal,
             professores: profs.map(function (p) { return { id: p.id, nome: p.nome }; }).sort(function (a, b) { return a.nome.localeCompare(b.nome); }) };
  },

  setupInicial: function (d) {
    if (DB.all('Professores').length) _erro('O sistema já foi configurado.');
    if (!d.nome || !d.pin || String(d.pin).length < 4) _erro('Informe seu nome e um PIN com pelo menos 4 números.');
    if (d.igreja) DB.setConfig('igreja', d.igreja);
    var p = { id: _id('p'), nome: d.nome, whatsapp: d.whatsapp || '', email: d.email || '', pin: String(d.pin), perfil: 'coord', ativo: 'sim', criadoEm: _agora() };
    DB.insert('Professores', p);
    return { cred: { tipo: 'prof', id: p.id, pin: p.pin }, nome: p.nome };
  },

  login: function (d) {
    if (d.tipo === 'aluno') {
      var cod = String(d.codigo || '').toUpperCase().replace(/\s/g, '');
      var a = DB.all('Alunos').filter(function (x) { return String(x.codigo).toUpperCase() === cod && x.ativo !== 'nao'; })[0];
      if (!a) _erro('Código não encontrado. Confira com o seu professor.');
      return { cred: { tipo: 'aluno', id: a.id, pin: a.codigo }, nome: a.nome };
    }
    var p = DB.all('Professores').filter(function (x) { return x.id === d.id && x.ativo !== 'nao'; })[0];
    if (!p || String(p.pin) !== String(d.pin)) _erro('PIN incorreto.');
    return { cred: { tipo: 'prof', id: p.id, pin: p.pin }, nome: p.nome };
  },

  bootstrap: function (d, cred) {
    var u = _auth(cred);
    var c = _cfg();
    delete c.geminiChave;
    c.temIA = !!DB.getSecret('geminiChave');
    if (!c.linkApp) c.linkApp = DB.appUrl();
    if (u.tipo === 'aluno') return ACOES._bootstrapAluno(u.aluno, c);
    var mensagens = DB.all('Mensagens');
    return {
      perfil: u.coord ? 'coord' : 'prof',
      eu: _semPin(u.prof),
      config: c,
      professores: DB.all('Professores').map(_semPin),
      alunos: DB.all('Alunos'),
      licoes: DB.all('Licoes').map(function (l) { l.conteudo = _json(l.conteudo, {}); return l; }).sort(function (a, b) { return Number(a.semana) - Number(b.semana); }),
      presenca: DB.all('Presenca'),
      entregas: DB.all('Entregas').map(function (e) { e.respostas = _json(e.respostas, []); return e; }),
      mensagens: mensagens.slice(Math.max(0, mensagens.length - 800)),
      hoje: _hoje()
    };
  },

  _bootstrapAluno: function (a, c) {
    var hoje = _hoje();
    var licoes = DB.all('Licoes').filter(function (l) { return l.data <= hoje; }).map(function (l) {
      var ct = _json(l.conteudo, {});
      var t = parseTarefa(ct.tarefa || '');
      t.questoes.forEach(function (q) { delete q.correta; });
      return { id: l.id, semana: l.semana, data: l.data, trimestre: l.trimestre, eixo: l.eixo, mes: l.mes, titulo: l.titulo, textoBase: l.textoBase, resumo: l.resumo,
               versiculo: ct.versiculo || null, slides: ct.slides || '', tarefa: t };
    }).sort(function (x, y) { return Number(y.semana) - Number(x.semana); });
    var minhas = DB.all('Entregas').filter(function (e) { return e.alunoId === a.id; }).map(function (e) { e.respostas = _json(e.respostas, []); return e; });
    var pres = DB.all('Presenca').filter(function (p) { return p.alunoId === a.id; });
    return { perfil: 'aluno', eu: { id: a.id, nome: a.nome, turma: a.turma, codigo: a.codigo, nascimento: a.nascimento },
             config: { nomeApp: c.nomeApp, igreja: c.igreja, subtitulo: c.subtitulo, corPrincipal: c.corPrincipal },
             licoes: licoes, entregas: minhas, presenca: pres, hoje: hoje };
  },

  salvarProfessor: function (d, cred) {
    var u = _auth(cred, 'coord');
    if (!d.nome) _erro('Informe o nome.');
    if (d.id) {
      var patch = { nome: d.nome, whatsapp: d.whatsapp || '', email: d.email || '', perfil: d.perfil || 'prof', ativo: d.ativo || 'sim' };
      if (d.pin) patch.pin = String(d.pin);
      if (d.id === u.prof.id && patch.perfil !== 'coord') _erro('Você não pode tirar o seu próprio acesso de coordenação.');
      DB.update('Professores', d.id, patch);
      return { ok: true };
    }
    if (!d.pin || String(d.pin).length < 4) _erro('Crie um PIN com pelo menos 4 números para o professor.');
    var p = { id: _id('p'), nome: d.nome, whatsapp: d.whatsapp || '', email: d.email || '', pin: String(d.pin), perfil: d.perfil || 'prof', ativo: 'sim', criadoEm: _agora() };
    DB.insert('Professores', p);
    return { ok: true, id: p.id };
  },

  removerProfessor: function (d, cred) {
    var u = _auth(cred, 'coord');
    if (d.id === u.prof.id) _erro('Você não pode remover a si mesmo.');
    DB.update('Professores', d.id, { ativo: 'nao' });
    return { ok: true };
  },

  salvarAluno: function (d, cred) {
    _auth(cred, 'prof');
    if (!d.nome) _erro('Informe o nome do aluno.');
    var campos = ['nome','nascimento','turma','whatsapp','responsavel1','parentesco1','whatsResp1','responsavel2','parentesco2','whatsResp2','obs'];
    var obj = {};
    campos.forEach(function (k) { obj[k] = d[k] || ''; });
    if (d.id) { DB.update('Alunos', d.id, obj); return { ok: true, id: d.id }; }
    obj.id = _id('a'); obj.codigo = _codigoAluno(d.nome); obj.ativo = 'sim'; obj.criadoEm = _agora();
    if (!obj.turma) obj.turma = String(_cfg().turmas).split(',')[0].trim();
    DB.insert('Alunos', obj);
    return { ok: true, id: obj.id, codigo: obj.codigo };
  },

  removerAluno: function (d, cred) {
    _auth(cred, 'prof');
    DB.update('Alunos', d.id, { ativo: d.reativar ? 'sim' : 'nao' });
    return { ok: true };
  },

  novoCodigoAluno: function (d, cred) {
    _auth(cred, 'prof');
    var a = DB.all('Alunos').filter(function (x) { return x.id === d.id; })[0];
    if (!a) _erro('Aluno não encontrado.');
    var c = _codigoAluno(a.nome);
    DB.update('Alunos', d.id, { codigo: c });
    return { ok: true, codigo: c };
  },

  salvarChamada: function (d, cred) {
    var u = _auth(cred, 'prof');
    if (!d.data) _erro('Informe a data da aula.');
    var existentes = DB.all('Presenca').filter(function (p) { return p.data === d.data && p.turma === d.turma; });
    var porAluno = {};
    existentes.forEach(function (p) { porAluno[p.alunoId] = p; });
    (d.registros || []).forEach(function (r) {
      var ex = porAluno[r.alunoId];
      if (ex) {
        if (!r.status) DB.remove('Presenca', ex.id);
        else DB.update('Presenca', ex.id, { status: r.status, licaoId: d.licaoId || '', professorId: u.prof.id, registradoEm: _agora() });
      } else if (r.status) {
        DB.insert('Presenca', { id: _id('r'), data: d.data, turma: d.turma, alunoId: r.alunoId, status: r.status, licaoId: d.licaoId || '', professorId: u.prof.id, registradoEm: _agora() });
      }
    });
    return { ok: true };
  },

  registrarMensagem: function (d, cred) {
    var u = _auth(cred, 'prof');
    var m = { id: _id('m'), data: _agora(), tipo: d.tipo || 'livre', alunoId: d.alunoId || '', destino: d.destino || '', texto: String(d.texto || '').slice(0, 1500), por: u.prof.nome };
    DB.insert('Mensagens', m);
    return { ok: true, msg: m };
  },

  salvarLicao: function (d, cred) {
    var u = _auth(cred, 'prof');
    if (!u.coord && _cfg().profEditaLicoes !== 'sim') _erro('Somente a coordenação pode editar as lições.');
    var obj = { semana: d.semana, data: d.data, trimestre: d.trimestre, eixo: d.eixo, mes: d.mes || '', titulo: d.titulo, textoBase: d.textoBase || '', resumo: d.resumo || '',
                status: d.status || 'planejada', conteudo: JSON.stringify(d.conteudo || {}), atualizadoEm: _agora() };
    if (obj.conteudo.length > 48000) _erro('A lição ficou grande demais para uma célula da planilha. Reduza um pouco o texto do estudo.');
    if (d.id) { DB.update('Licoes', d.id, obj); return { ok: true, id: d.id }; }
    obj.id = _id('L');
    DB.insert('Licoes', obj);
    return { ok: true, id: obj.id };
  },

  removerLicao: function (d, cred) {
    _auth(cred, 'coord');
    DB.remove('Licoes', d.id);
    return { ok: true };
  },

  /** Reorganiza as datas de todas as lições para os domingos de um novo ano (ex.: 2028). */
  redatarAno: function (d, cred) {
    _auth(cred, 'coord');
    var ano = Number(d.ano);
    if (!ano || ano < 2020 || ano > 2100) _erro('Ano inválido.');
    var dt = new Date(ano, 0, 1, 12);
    while (dt.getDay() !== 0) dt.setDate(dt.getDate() + 1);
    var licoes = DB.all('Licoes').sort(function (a, b) { return Number(a.semana) - Number(b.semana); });
    licoes.forEach(function (l) {
      var x = new Date(dt.getTime());
      x.setDate(x.getDate() + (Number(l.semana) - 1) * 7);
      DB.update('Licoes', l.id, { data: _fmtData(x) });
    });
    DB.setConfig('anoLetivo', String(ano));
    return { ok: true };
  },

  enviarEntrega: function (d, cred) {
    var u = _auth(cred, 'aluno');
    var l = DB.all('Licoes').filter(function (x) { return x.id === d.licaoId; })[0];
    if (!l) _erro('Lição não encontrada.');
    var t = parseTarefa(_json(l.conteudo, {}).tarefa || '');
    var resp = d.respostas || [];
    var acertos = 0, total = 0, temAberta = false;
    t.questoes.forEach(function (q, i) {
      if (q.tipo === 'mc') { total++; if (Number(resp[i]) === q.correta) acertos++; }
      else temAberta = true;
    });
    var ja = DB.all('Entregas').filter(function (e) { return e.alunoId === u.aluno.id && e.licaoId === d.licaoId; })[0];
    var obj = { respostas: JSON.stringify(resp), acertos: acertos, total: total, situacao: temAberta ? 'aguardando' : 'corrigida', enviadoEm: _agora() };
    if (ja) {
      if (ja.situacao === 'corrigida' && ja.corrigidoPor) _erro('Esta tarefa já foi corrigida pelo professor.');
      DB.update('Entregas', ja.id, obj);
    } else {
      obj.id = _id('e'); obj.alunoId = u.aluno.id; obj.licaoId = d.licaoId; obj.feedback = ''; obj.nota = ''; obj.corrigidoPor = ''; obj.corrigidoEm = '';
      DB.insert('Entregas', obj);
    }
    return { ok: true, acertos: acertos, total: total, gabarito: t.questoes.map(function (q) { return q.tipo === 'mc' ? q.correta : null; }) };
  },

  corrigirEntrega: function (d, cred) {
    var u = _auth(cred, 'prof');
    DB.update('Entregas', d.id, { feedback: d.feedback || '', nota: d.nota || '', situacao: 'corrigida', corrigidoPor: u.prof.nome, corrigidoEm: _agora() });
    return { ok: true };
  },

  salvarConfig: function (d, cred) {
    _auth(cred, 'coord');
    for (var k in d) {
      if (k === 'geminiChave') { if (d[k]) DB.setSecret('geminiChave', String(d[k]).trim()); continue; }
      if (k === 'removerChave') { DB.setSecret('geminiChave', ''); continue; }
      if (CONFIG_PADRAO.hasOwnProperty(k)) DB.setConfig(k, String(d[k]));
    }
    return { ok: true };
  },

  pesquisaIA: function (d, cred) {
    _auth(cred, 'prof');
    var c = _cfg();
    var ctx = '';
    if (d.licaoId) {
      var l = DB.all('Licoes').filter(function (x) { return x.id === d.licaoId; })[0];
      if (l) ctx = '\nContexto: o professor está preparando a lição "' + l.titulo + '" (texto base: ' + l.textoBase + '). Resumo: ' + l.resumo;
    }
    var prompt = 'Você é um assistente de pesquisa bíblica e pedagógica para professores de Escola Bíblica de pré-adolescentes (11 a 14 anos) de uma igreja evangélica no Brasil. ' +
      'Responda em português do Brasil, com fidelidade às Escrituras, linguagem clara e prática. Use Markdown simples (## títulos, listas com -, **negrito**). ' +
      'Cite referências bíblicas. Quando houver diferentes interpretações entre cristãos, apresente-as com equilíbrio. Não invente fontes, datas ou números; se não tiver certeza, diga. ' +
      'Quando fizer sentido, inclua ideias de ilustrações, perguntas e dinâmicas adequadas à idade.' + ctx + '\n\nPergunta do professor: ' + d.pergunta;
    return { texto: DB.ia(prompt, false, c.geminiModelo) };
  },

  gerarLicaoIA: function (d, cred) {
    _auth(cred, 'prof');
    var c = _cfg();
    var l = DB.all('Licoes').filter(function (x) { return x.id === d.licaoId; })[0];
    if (!l) _erro('Lição não encontrada.');
    var prompt = 'Você é um redator de currículo de Escola Bíblica para pré-adolescentes (11 a 14 anos) de uma igreja evangélica no Brasil (' + c.igreja + '). ' +
      'Escreva uma lição COMPLETA em português do Brasil, fiel à Bíblia, com linguagem acessível, exemplos do dia a dia de adolescentes brasileiros e aplicação prática.\n' +
      'Título: ' + l.titulo + '\nTexto base: ' + l.textoBase + '\nData: ' + l.data + '\nEixo: ' + l.eixo + '\nResumo do planejamento: ' + l.resumo + '\n' +
      (d.instrucoes ? 'Instruções adicionais do professor: ' + d.instrucoes + '\n' : '') +
      'Responda SOMENTE com um JSON com estas chaves (todas texto, exceto versiculo):\n' +
      '- "versiculo": {"ref": "Livro cap:vers", "texto": "texto do versículo-chave na Almeida Revista e Corrigida"}\n' +
      '- "objetivo": 1 a 2 frases.\n- "materiais": lista simples separada por vírgulas.\n' +
      '- "estudo": Markdown com cerca de 900 palavras, seções "## Para começar" (quebra-gelo), "## ..." (2 a 4 seções explicando o texto e o contexto), "## Aplicação" e "## Para o professor ir mais fundo" (notas teológicas, referências cruzadas, cuidados pastorais).\n' +
      '- "perguntas": 5 perguntas de discussão numeradas (1. 2. ...), uma por linha.\n' +
      '- "dinamica": Markdown começando com "### Nome da dinâmica", depois linhas "**Objetivo:**", "**Tempo:**", "**Materiais:**" e passos numerados.\n' +
      '- "slides": 7 a 9 slides separados por uma linha contendo apenas ---. Cada slide começa com "# Título" e pode ter "## subtítulo" ou itens "- ". Para slide de versículo use "> texto" e na linha seguinte "— Referência (ARC)". Para slide de pergunta use "# ? pergunta".\n' +
      '- "tarefa": tarefa de casa, uma linha por item: "DESAFIO: desafio prático da semana"; perguntas de múltipla escolha começando com "? " seguidas de 3 ou 4 alternativas, a correta começando com "* " e as erradas com "- "; perguntas abertas começando com "?? ". Faça 4 de múltipla escolha e 2 abertas.\n' +
      '- "pais": mensagem curta de WhatsApp para os pais resumindo a lição e o desafio (até 60 palavras).';
    var txt = DB.ia(prompt, true, c.geminiModelo);
    var obj = _json(String(txt).replace(/^```json\s*|\s*```$/g, ''), null);
    if (!obj) _erro('A IA não retornou uma lição válida. Tente novamente.');
    return { conteudo: obj };
  }
};

/** Ponto de entrada único usado pela tela do app. */
function api(acao, dados, cred) {
  if (!ACOES.hasOwnProperty(acao) || acao.charAt(0) === '_') _erro('Ação desconhecida: ' + acao);
  var leitura = ['estado','bootstrap','login','pesquisaIA','gerarLicaoIA'].indexOf(acao) >= 0;
  return DB.comTrava(!leitura, function () { return ACOES[acao](dados || {}, cred); });
}

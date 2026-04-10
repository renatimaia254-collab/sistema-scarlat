const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Banco de dados em memória para teste (alternativa mais leve)
// Se quiser persistência, usar SQLite normal
const db = new sqlite3.Database(':memory:');

// Criar tabela
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS fichas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nomeCliente TEXT,
      telefoneCliente TEXT,
      assunto TEXT,
      nomeGerente TEXT,
      horarioAgendado TEXT,
      vulgo TEXT,
      zap TEXT,
      status TEXT,
      horarioChegada TEXT,
      observacao TEXT,
      atendidoPor TEXT,
      dataEncerramento TEXT
    )
  `);
});

// Para persistência no Render (usando disco temporário)
// const db = new sqlite3.Database('/tmp/atendimentos.db');

const clients = [];

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const clientId = Date.now();
  clients.push({ id: clientId, res });
  req.on('close', () => {
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) clients.splice(index, 1);
  });
});

function broadcastEvent(event, data) {
  clients.forEach(client => {
    client.res.write(`event: ${event}\n`);
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

app.get('/api/fichas', (req, res) => {
  db.all('SELECT * FROM fichas ORDER BY horarioAgendado ASC, id ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/fichas', (req, res) => {
  const { nomeCliente, telefoneCliente, assunto, nomeGerente, horarioAgendado, vulgo, zap } = req.body;
  const horarioChegada = new Date().toISOString();
  const status = 'aguardando';
  
  db.run(
    `INSERT INTO fichas (nomeCliente, telefoneCliente, assunto, nomeGerente, horarioAgendado, vulgo, zap, status, horarioChegada, observacao, atendidoPor, dataEncerramento)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nomeCliente, telefoneCliente || '', assunto, nomeGerente || 'Scarlat', horarioAgendado, vulgo, zap, status, horarioChegada, '', '', ''],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM fichas WHERE id = ?', [this.lastID], (err2, ficha) => {
        if (!err2 && ficha) broadcastEvent('nova-ficha', ficha);
      });
      res.json({ id: this.lastID, success: true });
    }
  );
});

app.put('/api/fichas/:id/iniciar', (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM fichas WHERE status = 'aguardando' ORDER BY horarioAgendado ASC, id ASC LIMIT 1`, (err, proximo) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!proximo || proximo.id != id) {
      return res.status(400).json({ error: 'Apenas o próximo da fila pode ser atendido!' });
    }
    db.run('UPDATE fichas SET status = "em_andamento", atendidoPor = "Scarlat" WHERE id = ?', [id], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      db.get('SELECT * FROM fichas WHERE id = ?', [id], (err3, ficha) => {
        if (!err3 && ficha) broadcastEvent('status-alterado', ficha);
      });
      res.json({ success: true });
    });
  });
});

app.put('/api/fichas/:id/encerrar', (req, res) => {
  const { id } = req.params;
  const { observacao } = req.body;
  const dataEncerramento = new Date().toISOString();
  db.run('UPDATE fichas SET status = "encerrado", observacao = ?, dataEncerramento = ? WHERE id = ?',
    [observacao, dataEncerramento, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      db.get('SELECT * FROM fichas WHERE id = ?', [id], (err2, ficha) => {
        if (!err2 && ficha) broadcastEvent('status-alterado', ficha);
      });
      res.json({ success: true });
    }
  );
});

app.delete('/api/fichas/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM fichas WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Ficha não encontrada' });
    broadcastEvent('ficha-excluida', { id: parseInt(id) });
    res.json({ success: true });
  });
});

app.get('/api/relatorio', (req, res) => {
  db.all(`
    SELECT vulgo, zap, COUNT(*) as total,
           GROUP_CONCAT(nomeCliente || '|' || COALESCE(telefoneCliente, '') || '|' || assunto || '|' || status || '|' || COALESCE(observacao, '-')) as fichas
    FROM fichas
    GROUP BY vulgo, zap
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
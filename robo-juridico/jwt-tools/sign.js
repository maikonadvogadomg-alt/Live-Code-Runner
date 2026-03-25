const fs  = require('fs');
const jwt = require('jsonwebtoken');

// ─── Uso: node sign.js [caminho/chave_privada.pem] [CPF] ──────────────────────
// Gera um JWT RS256 simples para autenticação no Swagger/Homologação PDPJ.
// Cole o token gerado no campo Authorization do Swagger.

const privateKeyPath = process.argv[2] || 'chave_privada.pem';
const cpf            = process.argv[3] || '00000000000';

if (!fs.existsSync(privateKeyPath)) {
  console.error('❌ Arquivo de chave privada não encontrado:', privateKeyPath);
  console.error('   Uso: node sign.js "C:/caminho/chave_privada.pem" 09494128648');
  process.exit(1);
}

// ─── Lê e sanitiza a chave PEM ────────────────────────────────────────────────
let rawKey = fs.readFileSync(privateKeyPath, 'utf8');

// Remove "Bag Attributes" que o OpenSSL às vezes adiciona antes do header PEM
const beginIdx = rawKey.indexOf('-----BEGIN');
if (beginIdx > 0) rawKey = rawKey.slice(beginIdx);

// Corrige chaves sem quebras de linha (exportadas em uma única linha)
if (!rawKey.includes('\n') && rawKey.includes('-----')) {
  const bm = rawKey.match(/-----BEGIN [^-]+-----/);
  const em = rawKey.match(/-----END [^-]+-----/);
  if (bm && em) {
    const body = rawKey.replace(bm[0], '').replace(em[0], '').replace(/\s+/g, '');
    rawKey = `${bm[0]}\n${body.replace(/(.{64})/g, '$1\n').trim()}\n${em[0]}`;
  }
}
const privateKey = rawKey.trim();

// ─── Payload padrão PDPJ ─────────────────────────────────────────────────────
const payload = {
  sub  : cpf.replace(/\D/g, ''),
  name : 'Maikon da Rocha Caldeira',
  iss  : 'pdpj-br',
  aud  : 'https://gateway.stg.cloud.pje.jus.br',
  iat  : Math.floor(Date.now() / 1000),
  jti  : `sign-${Date.now()}`,
};

// ─── Assina o token RS256 ─────────────────────────────────────────────────────
try {
  const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn: '1h' });
  console.log('\n✅ Token JWT gerado com sucesso!\n');
  console.log('── Cole no Swagger em "Authorization: Bearer <TOKEN>" ──');
  console.log(token);
  console.log('────────────────────────────────────────────────────────\n');
} catch (err) {
  console.error('❌ Erro ao assinar token:', err.message);
  console.error('   Verifique se a chave PEM está no formato correto (RSA PRIVATE KEY).');
  process.exit(1);
}

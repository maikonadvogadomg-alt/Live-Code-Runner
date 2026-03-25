const fs  = require('fs');
const jwt = require('jsonwebtoken');

// ─── Uso: node verify.js [maikon.pub.pem] [TOKEN] ────────────────────────────
// Verifica a assinatura e decodifica o payload de um JWT RS256.

const pubPath = process.argv[2] || 'maikon.pub.pem';
const token   = process.argv[3];

if (!fs.existsSync(pubPath)) {
  console.error('❌ Arquivo de chave pública não encontrado:', pubPath);
  console.error('   Gere com: node genpub.js "C:/caminho/chave_privada.pem"');
  process.exit(1);
}

if (!token) {
  console.error('❌ Informe o token como 2º argumento:');
  console.error('   node verify.js maikon.pub.pem "eyJ..."');
  process.exit(1);
}

const pub = fs.readFileSync(pubPath, 'utf8');

jwt.verify(token, pub, { algorithms: ['RS256'] }, (err, decoded) => {
  if (err) {
    console.error('❌ Token inválido:', err.message);
    if (err.name === 'TokenExpiredError') {
      console.error('   → Gere um novo token: node gen_pjud.js --key chave_privada.pem --sub 09494128648');
    }
    process.exit(1);
  }
  console.log('\n✅ Token válido! Payload decodificado:\n');
  console.log(JSON.stringify(decoded, null, 2));
});

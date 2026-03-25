const fs = require('fs');
const { createPublicKey } = require('crypto');

// ─── Uso: node genpub.js [caminho/chave_privada.pem] ─────────────────────────
// Gera a chave pública (.pub.pem) a partir da chave privada RSA.
// A chave pública deve ser enviada para o PDPJ no processo de registro.

const privPath = process.argv[2] || 'chave_privada.pem';

if (!fs.existsSync(privPath)) {
  console.error('❌ Arquivo de chave privada não encontrado:', privPath);
  console.error('   Passe o caminho como: node genpub.js "C:/caminho/chave_privada.pem"');
  process.exit(1);
}

try {
  const priv = fs.readFileSync(privPath, 'utf8');
  const pub  = createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  const outFile = 'maikon.pub.pem';
  fs.writeFileSync(outFile, pub);
  console.log(`✅ Chave pública gerada: ${outFile}`);
  console.log('   → Envie este arquivo ao PDPJ para registro da chave.');
} catch (err) {
  console.error('❌ Erro ao gerar chave pública:', err.message);
  process.exit(1);
}

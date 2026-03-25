const fs = require('fs');

// ─── Uso ──────────────────────────────────────────────────────────────────────
// node call_pjud.js --url <API_URL> [--tokenfile pjud_token.txt] [--method GET]
//
// Exemplos:
//   node call_pjud.js --url "https://gateway.stg.cloud.pje.jus.br/domicilio-eletronico/api/v1/representados"
//   node call_pjud.js --url "https://comunicaapi.pje.jus.br/api/v1/comunicacao" --tokenfile pjud_token.txt
//
// Requer Node.js 18+ (fetch global nativo).
// ─────────────────────────────────────────────────────────────────────────────

const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    argv[a.slice(2)] = process.argv[i + 1];
    i++;
  }
}

const url       = argv.url || argv.u;
const tokenFile = argv.tokenfile || argv.t || 'pjud_token.txt';
const method    = (argv.method || 'GET').toUpperCase();

if (!url) {
  console.error('❌ URL obrigatória. Uso:');
  console.error('   node call_pjud.js --url <API_URL> [--tokenfile pjud_token.txt] [--method GET|POST]');
  process.exit(1);
}

if (!fs.existsSync(tokenFile)) {
  console.error(`❌ Arquivo de token não encontrado: ${tokenFile}`);
  console.error('   Gere o token primeiro com:');
  console.error('   node gen_pjud.js --key chave_privada.pem --sub 09494128648');
  process.exit(1);
}

// Lê o token ignorando comentários e linhas extras
const raw   = fs.readFileSync(tokenFile, 'utf8');
const token = raw
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#') && !l.startsWith('curl') && !l.startsWith('-'))
  .join('')
  .trim();

if (!token || token.split('.').length !== 3) {
  console.error('❌ Token JWT inválido ou arquivo corrompido.');
  console.error('   Regenere com: node gen_pjud.js --key chave_privada.pem --sub 09494128648');
  console.error('   Token lido (60 chars):', token ? token.substring(0, 60) : '(vazio)');
  process.exit(1);
}

console.log(`\n📡 ${method} ${url}`);
console.log(`🔑 Token: ${token.substring(0, 40)}...\n`);

(async () => {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization' : `Bearer ${token}`,
        'Accept'        : 'application/json',
        'Content-Type'  : 'application/json',
      },
    });

    const text = await res.text();
    console.log('── Resposta ─────────────────────────────────────────');
    console.log(`Status: ${res.status} ${res.statusText}`);

    if (res.status === 401) {
      console.error('\n⚠️  401 Unauthorized');
      console.error('   → O token pode estar expirado ou a chave não está registrada no PDPJ.');
      console.error('   → Regenere: node gen_pjud.js --key chave_privada.pem --sub 09494128648');
    } else if (res.status === 403) {
      console.error('\n⚠️  403 Forbidden');
      console.error('   → Possível restrição de IP. Use um servidor brasileiro.');
    }

    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text);
    }
  } catch (err) {
    console.error('❌ Falha na requisição:', err.message || err);
    process.exit(1);
  }
})();

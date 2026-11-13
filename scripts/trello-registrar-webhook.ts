/**
 * Registra o webhook do Trello para o board configurado. AÇÃO MANUAL E EXPLÍCITA:
 * cria um recurso de webhook na conta do token (não altera o board, listas ou cards).
 * Executar somente com aprovação da responsável: `npm run trello:webhook -- --confirmar`.
 */
import { carregarConfig, trelloConfigurado } from '../src/config/index.js';

const config = carregarConfig();
if (!trelloConfigurado(config) || !config.TRELLO_WEBHOOK_URL) {
  console.error('Configure TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID e TRELLO_WEBHOOK_URL.');
  process.exit(1);
}
if (!process.argv.includes('--confirmar')) {
  console.error(`Vai registrar webhook do board ${config.TRELLO_BOARD_ID} → ${config.TRELLO_WEBHOOK_URL}. Repita com --confirmar.`);
  process.exit(1);
}
const resposta = await fetch('https://api.trello.com/1/webhooks', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `OAuth oauth_consumer_key="${config.TRELLO_API_KEY}", oauth_token="${config.TRELLO_TOKEN}"`,
  },
  body: JSON.stringify({ callbackURL: config.TRELLO_WEBHOOK_URL, idModel: config.TRELLO_BOARD_ID, description: 'NETT Licita Intelligence (leitura)' }),
});
console.log(resposta.status, (await resposta.text()).slice(0, 500));
